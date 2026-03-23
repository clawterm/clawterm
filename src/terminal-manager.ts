import { Tab } from "./tab";
import { loadConfig, applyThemeToCSS, type Config } from "./config";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { invokeWithTimeout, trapFocus, isMac } from "./utils";
import { showWorktreeDialog, type WorktreeDialogResult } from "./worktree-dialog";
import { computeFolderTitle, createDefaultTabState, computeSubtitle } from "./tab-state";
import { NotificationManager } from "./notifications";
import { ServerTracker } from "./server-tracker";
import { showContextMenu, type ContextMenuItem } from "./context-menu";
import { TabSwitcher, type SwitcherTab } from "./tab-switcher";
import type { OutputEvent } from "./matchers";
import { logger } from "./logger";
import { showToast } from "./toast";
import { loadSession, saveSession, type SessionTab } from "./session";
import { createShortcutsPanel } from "./shortcuts-panel";
import { manualCheckForUpdates } from "./updater";
import { showCommandPalette, type PaletteCommand } from "./command-palette";
import { createKeyHandler } from "./keybinding-handler";
import { TabRenderer } from "./tab-renderer";

function el(tag: string, attrs?: Record<string, string>, ...children: (HTMLElement | string)[]): HTMLElement {
  const e = document.createElement(tag);
  if (attrs)
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "id") e.id = v;
      else e.setAttribute(k, v);
    }
  for (const c of children) e.append(typeof c === "string" ? document.createTextNode(c) : c);
  return e;
}

export class TerminalManager {
  private tabs: Map<string, Tab> = new Map();
  private activeTabId: string | null = null;
  private tabCounter = 0;
  config!: Config;
  private notifications!: NotificationManager;
  private serverTracker!: ServerTracker;
  private tabSwitcher = new TabSwitcher();
  private tabRenderer!: TabRenderer;
  private resizeObserver: ResizeObserver | null = null;
  private resizeRaf = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private unlistenFocus: (() => void) | null = null;
  private lastBackgroundPoll = 0;
  private lastTabSnapshot = "";
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;
  private shortcutsPanelEl: HTMLDivElement | null = null;
  private creatingTab = false;
  private quitting = false;
  private handleKey!: (e: KeyboardEvent) => boolean;
  private closedTabStack: { cwd: string; title?: string }[] = [];
  /** AbortController for document-level event listeners — aborted on dispose */
  private readonly ac = new AbortController();

  async init() {
    this.config = await loadConfig();
    this.notifications = new NotificationManager(this.config.notifications);
    this.notifications.onFocusTab = (tabId) => {
      if (this.tabs.has(tabId)) {
        getCurrentWindow().setFocus();
        this.switchToTab(tabId);
      }
    };
    this.serverTracker = new ServerTracker(
      this.config.advanced.healthCheckIntervalMs,
      this.config.advanced.ipcTimeoutMs,
    );
    applyThemeToCSS(this.config);

    this.tabRenderer = new TabRenderer({
      closeTab: (id) => this.closeTab(id),
      switchToTab: (id) => this.switchToTab(id),
      showTabContextMenu: (e, id) => this.showTabContextMenu(e, id),
      reorderTab: (dragId, targetId, insertBefore) => this.reorderTab(dragId, targetId, insertBefore),
      renameTab: (id) => this.startTabRename(id),
    });

    this.handleKey = createKeyHandler(() => this.config, {
      createTab: () => this.createTab(),
      closeActiveTab: () => {
        if (this.activeTabId) this.closeTab(this.activeTabId);
      },
      nextTab: () => this.nextTab(),
      prevTab: () => this.prevTab(),
      reloadConfig: () => this.reloadConfig(),
      cycleAttentionTabs: () => this.cycleAttentionTabs(),
      toggleSearch: () => {
        if (this.activeTabId) this.tabs.get(this.activeTabId)?.toggleSearch();
      },
      showQuickSwitch: () => this.showQuickSwitch(),
      openCommandPalette: () => this.openCommandPalette(),
      splitHorizontal: () => this.splitActiveTab("horizontal"),
      splitVertical: () => this.splitActiveTab("vertical"),
      closeActivePane: () => this.closeActivePane(),
      focusNextPane: () => {
        if (this.activeTabId) this.tabs.get(this.activeTabId)?.focusNextPane();
      },
      focusPrevPane: () => {
        if (this.activeTabId) this.tabs.get(this.activeTabId)?.focusPrevPane();
      },
      resizePane: (direction) => {
        if (this.activeTabId) this.tabs.get(this.activeTabId)?.resizeFocusedPane(direction);
      },
      focusPaneByIndex: (index) => {
        if (this.activeTabId) this.tabs.get(this.activeTabId)?.focusPaneByIndex(index);
      },
      switchToTabIndex: (index) => {
        const ids = Array.from(this.tabs.keys());
        if (index < ids.length) this.switchToTab(ids[index]);
      },
      writeToActivePty: (text) => this.writeToActivePty(text),
      zoomIn: () => this.adjustFontSize(1),
      zoomOut: () => this.adjustFontSize(-1),
      zoomReset: () => this.resetFontSize(),
      restoreClosedTab: () => this.restoreClosedTab(),
      openWorktreeDialog: () => this.openWorktreeDialog(),
    });

    this.renderShell();
    this.setupResize();
    this.setupServerTracker();
    this.setupStatusBarClicks();

    // Restore session or create a fresh tab.
    // Each tab is restored in isolation — a single failure doesn't cascade.
    const session = await loadSession();
    if (session && session.tabs.length > 0) {
      let restored = 0;
      for (const savedTab of session.tabs) {
        try {
          // Validate CWD exists before restoring — skip invalid dirs
          let cwd: string | undefined = savedTab.cwd || undefined;
          if (cwd) {
            try {
              const exists = await invokeWithTimeout<boolean>("validate_dir", { path: cwd }, 2000);
              if (!exists) {
                logger.warn(`Session restore: CWD "${cwd}" no longer exists, using home`);
                cwd = undefined;
              }
            } catch {
              // CWD validation failed — fall back to home dir
              cwd = undefined;
            }
          }
          await this.createTab(cwd);
          restored++;

          // Restore tab state from session
          if (this.activeTabId) {
            const tab = this.tabs.get(this.activeTabId);
            if (tab) {
              // Restore splits
              if (savedTab.splits) {
                try {
                  await tab.restoreSplits(savedTab.splits);
                } catch (e) {
                  logger.warn("Failed to restore splits for tab:", e);
                }
              }
              // Restore pin, mute, and manual title
              if (savedTab.pinned) tab.pinned = true;
              if (savedTab.muted) tab.muted = true;
              if (savedTab.manualTitle) tab.manualTitle = savedTab.manualTitle;
            }
          }
        } catch (e) {
          logger.warn("Failed to restore tab, skipping:", e);
        }
      }

      if (restored === 0) {
        // All tabs failed to restore — start fresh
        logger.warn("Session restore failed completely — starting fresh");
        showToast("Session restore failed — starting fresh", "warn");
        await this.createTab();
      } else {
        // Switch to the previously active tab
        const ids = Array.from(this.tabs.keys());
        const idx = Math.min(session.activeIndex, ids.length - 1);
        if (ids[idx]) this.switchToTab(ids[idx]);
      }
    } else {
      await this.createTab();
      this.showFirstRunWelcome();
    }

    // Start polling after session restore so PTY PIDs have time to resolve
    this.startCentralPoll();
  }

  private setupServerTracker() {
    this.serverTracker.onServerCrash((tabId, port) => {
      const tab = this.tabs.get(tabId);
      if (!tab) return;
      tab.state.activity = "error";
      tab.state.lastError = `Server on :${port} crashed`;
      this.renderTabList();
      this.updateStatusBar();

      const event: OutputEvent = {
        type: "server-crashed",
        detail: `Server on port ${port} stopped responding`,
        timestamp: Date.now(),
        port,
      };
      this.notifications.notify(event, tab.title, tabId, this.activeTabId === tabId);
    });
  }

  private renderShell() {
    const app = document.getElementById("app")!;
    if (this.config.sidebar.position === "right") {
      app.classList.add("sidebar-right");
    }
    app.append(
      el(
        "div",
        { id: "titlebar", class: isMac ? "titlebar-mac" : "titlebar-win" },
        // macOS: traffic lights on the left
        ...(isMac
          ? [
              el(
                "div",
                { id: "traffic-lights" },
                el("button", { class: "traffic-light close", id: "btn-close", "aria-label": "Close window" }),
                el("button", {
                  class: "traffic-light minimize",
                  id: "btn-minimize",
                  "aria-label": "Minimize window",
                }),
                el("button", {
                  class: "traffic-light maximize",
                  id: "btn-maximize",
                  "aria-label": "Maximize window",
                }),
              ),
            ]
          : []),
        // Spacer to push Windows controls to the right
        ...(!isMac ? [el("div", { style: "flex:1" })] : []),
        // Windows/Linux: window controls on the right
        ...(!isMac
          ? [
              el(
                "div",
                { id: "window-controls" },
                el(
                  "button",
                  { class: "win-ctrl minimize", id: "btn-minimize", "aria-label": "Minimize" },
                  "\u2500",
                ),
                el(
                  "button",
                  { class: "win-ctrl maximize", id: "btn-maximize", "aria-label": "Maximize" },
                  "\u25A1",
                ),
                el("button", { class: "win-ctrl close", id: "btn-close", "aria-label": "Close" }, "\u2715"),
              ),
            ]
          : []),
      ),
      el(
        "div",
        { id: "main-area" },
        el(
          "div",
          { id: "sidebar" },
          el("div", { id: "tab-list", role: "tablist", "aria-label": "Terminal tabs" }),
          el("div", { id: "sidebar-footer" }, el("button", { id: "new-tab-btn" }, "+ New Tab")),
        ),
        el("div", { id: "sidebar-divider" }),
        el(
          "div",
          { id: "terminal-area" },
          el("div", { id: "terminal-container" }),
          el(
            "div",
            { id: "status-bar" },
            el("span", { id: "status-cwd" }),
            el("span", { id: "status-git" }),
            el("span", { id: "status-process" }),
            el("span", { id: "status-server" }),
            el("span", { id: "status-agent" }),
          ),
          el(
            "div",
            { id: "utility-buttons" },
            el(
              "button",
              { id: "shortcuts-btn", "aria-label": "Keyboard shortcuts", title: "Keyboard Shortcuts" },
              "\u2328\uFE0E",
            ),
            el(
              "button",
              { id: "update-btn", "aria-label": "Check for updates", title: "Check for Updates" },
              "\u2193",
            ),
          ),
        ),
      ),
    );

    const win = getCurrentWindow();
    document.getElementById("btn-close")!.addEventListener("click", () => win.close());
    document.getElementById("btn-minimize")!.addEventListener("click", () => win.minimize());
    document.getElementById("btn-maximize")!.addEventListener("click", () => win.toggleMaximize());

    // Explicit drag handling for custom titlebar
    const titlebar = document.getElementById("titlebar")!;
    titlebar.addEventListener("mousedown", (e) => {
      // Only drag from the titlebar itself, not control buttons
      if ((e.target as HTMLElement).closest("#traffic-lights, #window-controls")) return;
      win.startDragging();
    });
    titlebar.addEventListener("dblclick", (e) => {
      if ((e.target as HTMLElement).closest("#traffic-lights, #window-controls")) return;
      win.toggleMaximize();
    });

    document.getElementById("new-tab-btn")!.addEventListener("click", () => {
      this.createTab();
    });

    // Right-click on new-tab button shows startup command options
    document.getElementById("new-tab-btn")!.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const items: ContextMenuItem[] = [{ label: "New Tab", action: () => this.createTab() }];
      const cmds = this.config.startupCommands;
      if (Object.keys(cmds).length > 0) {
        let first = true;
        for (const [name, cmd] of Object.entries(cmds)) {
          items.push({
            label: name,
            separator: first,
            action: () => this.createTab(undefined, cmd),
          });
          first = false;
        }
      }
      showContextMenu(e.clientX, e.clientY, items);
    });

    document.getElementById("shortcuts-btn")!.addEventListener("click", () => {
      this.toggleShortcutsPanel();
    });

    document.getElementById("update-btn")!.addEventListener("click", () => {
      manualCheckForUpdates();
    });

    // Re-focus terminal when window regains focus (fixes Cmd+Tab focus loss)
    // Also refresh pane viewports to recover from silent renderer failures
    // (WebGL context loss or canvas blanking while the window was unfocused).
    win
      .onFocusChanged(({ payload: focused }) => {
        if (focused && this.activeTabId) {
          const tab = this.tabs.get(this.activeTabId);
          if (tab) {
            requestAnimationFrame(() => {
              tab.refreshAllPanes();
              tab.focus();
            });
          }
        }
      })
      .then((unlisten) => {
        this.unlistenFocus = unlisten;
      });

    // Re-focus terminal when clicking on terminal area (e.g. wrapper padding)
    document.getElementById("terminal-container")!.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest(".search-bar")) return;
      if (this.activeTabId) {
        requestAnimationFrame(() => {
          const tab = this.tabs.get(this.activeTabId!);
          tab?.focus();
        });
      }
    });

    this.setupSidebarResize();
  }

  private setupSidebarResize() {
    const divider = document.getElementById("sidebar-divider")!;
    const isRight = this.config.sidebar.position === "right";
    let dragging = false;

    divider.addEventListener("mousedown", (e) => {
      e.preventDefault();
      dragging = true;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    });

    document.addEventListener(
      "mousemove",
      (e) => {
        if (!dragging) return;
        const width = isRight ? window.innerWidth - e.clientX : e.clientX;
        const clamped = Math.min(600, Math.max(100, width));
        document.documentElement.style.setProperty("--sidebar-width", `${clamped}px`);
      },
      { signal: this.ac.signal },
    );

    document.addEventListener(
      "mouseup",
      () => {
        if (!dragging) return;
        dragging = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";

        // Persist to config
        const width = parseInt(
          getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width"),
        );
        if (width && width !== this.config.sidebar.width) {
          this.config.sidebar.width = width;
          invoke("write_config", { contents: JSON.stringify(this.config, null, 2) }).catch(() => {
            showToast("Couldn't save sidebar width", "warn");
          });
        }

        // Refit active terminal
        if (this.activeTabId) {
          const tab = this.tabs.get(this.activeTabId);
          tab?.fit();
        }
      },
      { signal: this.ac.signal },
    );
  }

  async createTab(restoreCwd?: string, startupCommand?: string) {
    // Guard against concurrent tab creation (e.g. rapid button clicks)
    if (this.creatingTab) return;
    this.creatingTab = true;

    try {
      await this._createTab(restoreCwd, startupCommand);
    } finally {
      this.creatingTab = false;
    }
  }

  private async _createTab(restoreCwd?: string, startupCommand?: string) {
    if (this.tabs.size >= this.config.maxTabs) {
      const agentEl = document.getElementById("status-agent");
      if (agentEl) {
        agentEl.textContent = `Tab limit reached (${this.config.maxTabs})`;
        agentEl.className = "status-error";
        setTimeout(() => {
          if (agentEl.textContent?.startsWith("Tab limit")) {
            agentEl.textContent = "";
            agentEl.className = "";
          }
        }, 3000);
      }
      return;
    }

    this.tabCounter++;
    const id = `tab-${this.tabCounter}`;
    const title = computeFolderTitle(createDefaultTabState());

    // Use restored CWD, or inherit from active tab
    let cwd: string | undefined = restoreCwd;
    if (!cwd && this.activeTabId) {
      const activeTab = this.tabs.get(this.activeTabId);
      if (activeTab?.ptyPid) {
        try {
          const timeout = this.config.advanced.ipcTimeoutMs;
          const fg = await invokeWithTimeout<{ name: string; pid: number }>(
            "get_foreground_process",
            { pid: activeTab.ptyPid },
            timeout,
          );
          cwd = await invokeWithTimeout<string>("get_process_cwd_full", { pid: fg.pid }, timeout);
        } catch (e) {
          logger.debug("Failed to inherit CWD from active tab:", e);
        }
      }
    }

    logger.debug(`[createTab] id=${id} cwd=${cwd ?? "default"}`);
    const tab = new Tab(id, title, this.config, this.handleKey, cwd);

    tab.onExit = () => {
      this.serverTracker.removeServer(id);
      this.forceCloseTab(id);
    };

    tab.onTitleChange = () => {
      this.renderTabList();
      this.updateStatusBar();
    };

    tab.onNeedsAttention = () => {
      this.renderTabList();
      this.notifications.notifyCommandComplete(tab.title, tab.id, this.activeTabId === tab.id);
    };

    tab.onOutputEvent = (event: OutputEvent) => {
      this.handleTabOutputEvent(id, tab, event);
    };

    this.tabs.set(id, tab);
    this.renderTabList();

    // Start the PTY and open terminal in DOM first
    let started = false;
    try {
      started = await tab.start();
    } catch (e) {
      logger.warn(`Tab ${id}: PTY start threw:`, e);
    }

    if (!started) {
      // PTY failed to spawn — clean up and remove the tab
      logger.warn(`Tab ${id}: PTY failed to start, removing tab`);
      tab.dispose();
      this.tabs.delete(id);
      this.renderTabList();
      return;
    }

    // Now switch to it (show + focus) after terminal is ready
    this.switchToTab(id);

    // Extra focus after a frame to ensure terminal is interactive
    requestAnimationFrame(() => tab.focus());

    // Immediately poll process info so the tab title updates ASAP
    // (don't wait for the next interval tick)
    tab
      .pollProcessInfo()
      .then(() => {
        this.renderTabList();
        this.updateStatusBar();
      })
      .catch((e) => logger.debug("[createTab] initial poll failed:", e));

    // Send startup command after a brief delay for shell init
    if (startupCommand) {
      const cmd = startupCommand.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
      setTimeout(() => tab.writeToPty(cmd.endsWith("\n") ? cmd : cmd + "\n"), 300);
    }

    this.persistSession();
  }

  /** Build the current session snapshot from live tab state. */
  private buildSessionSnapshot(): { tabs: SessionTab[]; activeIndex: number } {
    const tabs: SessionTab[] = [];
    for (const tab of this.tabs.values()) {
      // Only save tabs that have a resolved CWD — skip tabs that haven't
      // been polled yet to avoid saving empty entries that can't be restored
      const cwd = tab.lastFullCwd;
      if (!cwd) continue;
      tabs.push({
        title: tab.manualTitle,
        cwd,
        splits: tab.serializeSplits(),
        pinned: tab.pinned || undefined,
        muted: tab.muted || undefined,
        manualTitle: tab.manualTitle,
      });
    }
    const ids = Array.from(this.tabs.keys());
    const activeIndex = this.activeTabId ? ids.indexOf(this.activeTabId) : 0;
    return { tabs, activeIndex: Math.max(0, activeIndex) };
  }

  /** Start inline tab rename — replaces tab title with an input field. */
  private startTabRename(tabId: string) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    const entry = document.querySelector(`.tab-entry[data-id="${tabId}"]`);
    if (!entry) return;

    const titleEl = entry.querySelector(".tab-title") as HTMLElement;
    if (!titleEl) return;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "tab-rename-input";
    input.value = tab.manualTitle || tab.title;

    const finish = () => {
      const newTitle = input.value.trim();
      tab.manualTitle = newTitle || null;
      this.renderTabList();
      this.persistSession();
    };

    input.addEventListener("blur", finish);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
      if (e.key === "Escape") {
        input.value = "";
        input.blur();
      }
    });

    titleEl.textContent = "";
    titleEl.appendChild(input);
    input.focus();
    input.select();
  }

  /** Show a one-time welcome message for first-run users. */
  private showFirstRunWelcome() {
    const key = "clawterm_welcomed";
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");

    const tab = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
    if (!tab) return;

    const mod = isMac ? "Cmd" : "Ctrl";
    // Write welcome text after a brief delay for the shell to initialize
    setTimeout(() => {
      const msg = [
        "",
        "\x1b[1m  Welcome to Clawterm\x1b[0m",
        "",
        `  \x1b[36m${mod}+T\x1b[0m  New tab        \x1b[36m${mod}+D\x1b[0m  Split pane`,
        `  \x1b[36m${mod}+P\x1b[0m  Quick switch   \x1b[36m${mod}+Shift+P\x1b[0m  Commands`,
        `  \x1b[36m${mod}+K\x1b[0m  Clear          \x1b[36m${mod}+Shift+A\x1b[0m  Attention tabs`,
        "",
      ].join("\r\n");
      tab.writeToTerminal(msg);
    }, 500);
  }

  private persistSession() {
    if (this.quitting) return;
    // Debounce: multiple rapid calls (tab switch, create, close) coalesce
    // into a single write after 500ms of quiet
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    this.sessionTimer = setTimeout(() => {
      if (this.quitting) return;
      const { tabs, activeIndex } = this.buildSessionSnapshot();
      saveSession(tabs, activeIndex);
    }, 500);
  }

  /** Flush any pending debounced session save immediately. Call before dispose(). */
  async flushSession() {
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
    }
    const { tabs, activeIndex } = this.buildSessionSnapshot();
    if (tabs.length > 0) {
      await saveSession(tabs, activeIndex);
    }
  }

  private handleTabOutputEvent(tabId: string, tab: Tab, event: OutputEvent) {
    // Track servers
    if (event.type === "server-started" && event.port) {
      this.serverTracker.addServer(tabId, event.port);
    }

    // Forward to notifications (skip if tab is muted)
    if (!tab.muted) {
      this.notifications.notify(event, tab.title, tabId, this.activeTabId === tabId);
    }

    // Re-render UI
    this.renderTabList();
    this.updateStatusBar();
  }

  private switchToTab(id: string) {
    if (this.activeTabId === id) return;
    logger.debug(`[switchToTab] from=${this.activeTabId} to=${id}`);

    if (this.activeTabId) {
      const current = this.tabs.get(this.activeTabId);
      if (current) current.hide();
    }

    // Dismiss any stuck overlays (paste confirm, close confirm) so they can't block input
    document.querySelectorAll(".close-confirm-overlay").forEach((el) => el.remove());

    // Dismiss shortcuts panel if open
    if (this.shortcutsPanelEl) {
      this.shortcutsPanelEl.remove();
      this.shortcutsPanelEl = null;
      document.getElementById("shortcuts-btn")?.classList.remove("active");
    }

    this.activeTabId = id;
    const tab = this.tabs.get(id);
    if (tab) tab.show();

    this.renderTabList();
    this.updateStatusBar();
    this.persistSession();
  }

  private nextTab() {
    if (!this.activeTabId) return;
    const ids = Array.from(this.tabs.keys());
    if (ids.length <= 1) return;
    const currentIndex = ids.indexOf(this.activeTabId);
    const nextIndex = (currentIndex + 1) % ids.length;
    this.switchToTab(ids[nextIndex]);
  }

  private prevTab() {
    if (!this.activeTabId) return;
    const ids = Array.from(this.tabs.keys());
    if (ids.length <= 1) return;
    const currentIndex = ids.indexOf(this.activeTabId);
    const prevIndex = (currentIndex - 1 + ids.length) % ids.length;
    this.switchToTab(ids[prevIndex]);
  }

  private cycleAttentionTabs() {
    const attentionIds = Array.from(this.tabs.entries())
      .filter(([, tab]) => tab.state.needsAttention)
      .map(([id]) => id);

    if (attentionIds.length === 0) return;

    const currentIndex = attentionIds.indexOf(this.activeTabId!);
    const nextIndex = (currentIndex + 1) % attentionIds.length;
    this.switchToTab(attentionIds[nextIndex]);
  }

  private showQuickSwitch() {
    const switcherTabs: SwitcherTab[] = Array.from(this.tabs.entries()).map(([id, tab]) => ({
      id,
      title: tab.title,
      subtitle: computeSubtitle(tab.state),
      activity: tab.state.activity,
    }));

    this.tabSwitcher.show(switcherTabs, (id) => {
      this.switchToTab(id);
      const tab = this.tabs.get(id);
      tab?.focus();
    });
  }

  private writeToActivePty(text: string) {
    if (!this.activeTabId) return;
    const tab = this.tabs.get(this.activeTabId);
    if (!tab) return;
    // Interpret escape sequences like \n
    const resolved = text.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
    tab.writeToPty(resolved);
  }

  private toggleShortcutsPanel() {
    const container = document.getElementById("terminal-container")!;

    // If panel is showing, remove it and restore the active tab
    if (this.shortcutsPanelEl) {
      this.shortcutsPanelEl.remove();
      this.shortcutsPanelEl = null;
      document.getElementById("shortcuts-btn")?.classList.remove("active");
      if (this.activeTabId) {
        const tab = this.tabs.get(this.activeTabId);
        tab?.show();
      }
      return;
    }

    // Hide the active tab and show the shortcuts panel
    if (this.activeTabId) {
      const tab = this.tabs.get(this.activeTabId);
      tab?.hide();
    }

    this.shortcutsPanelEl = createShortcutsPanel(this.config);
    container.appendChild(this.shortcutsPanelEl);
    document.getElementById("shortcuts-btn")?.classList.add("active");
  }

  private openCommandPalette() {
    const commands: PaletteCommand[] = [
      { id: "new-tab", label: "New Tab", category: "Tabs", action: () => this.createTab() },
      {
        id: "new-worktree-tab",
        label: "New Agent Tab on Branch\u2026",
        category: "Worktree",
        action: () => this.openWorktreeDialog(),
      },
      {
        id: "close-tab",
        label: "Close Tab",
        category: "Tabs",
        action: () => {
          if (this.activeTabId) this.closeTab(this.activeTabId);
        },
      },
      {
        id: "restore-tab",
        label: "Restore Closed Tab",
        category: "Tabs",
        action: () => this.restoreClosedTab(),
      },
      { id: "next-tab", label: "Next Tab", category: "Tabs", action: () => this.nextTab() },
      { id: "prev-tab", label: "Previous Tab", category: "Tabs", action: () => this.prevTab() },
      {
        id: "split-right",
        label: "Split Right",
        category: "Panes",
        action: () => this.splitActiveTab("horizontal"),
      },
      {
        id: "split-down",
        label: "Split Down",
        category: "Panes",
        action: () => this.splitActiveTab("vertical"),
      },
      { id: "close-pane", label: "Close Pane", category: "Panes", action: () => this.closeActivePane() },
      {
        id: "focus-next-pane",
        label: "Focus Next Pane",
        category: "Panes",
        action: () => this.tabs.get(this.activeTabId!)?.focusNextPane(),
      },
      {
        id: "balance-splits",
        label: "Balance Split Panes",
        category: "Panes",
        action: () => this.tabs.get(this.activeTabId!)?.balanceSplits(),
      },
      {
        id: "search",
        label: "Find in Terminal",
        category: "Terminal",
        action: () => this.tabs.get(this.activeTabId!)?.toggleSearch(),
      },
      {
        id: "reload-config",
        label: "Reload Config",
        category: "Terminal",
        action: () => this.reloadConfig(),
      },
      { id: "zoom-in", label: "Zoom In", category: "Terminal", action: () => this.adjustFontSize(1) },
      { id: "zoom-out", label: "Zoom Out", category: "Terminal", action: () => this.adjustFontSize(-1) },
      { id: "zoom-reset", label: "Reset Zoom", category: "Terminal", action: () => this.resetFontSize() },
      {
        id: "shortcuts",
        label: "Keyboard Shortcuts",
        category: "Terminal",
        action: () => this.toggleShortcutsPanel(),
      },
      {
        id: "cycle-attention",
        label: "Cycle Attention Tabs",
        category: "Tabs",
        action: () => this.cycleAttentionTabs(),
      },
      { id: "quick-switch", label: "Quick Switch", category: "Tabs", action: () => this.showQuickSwitch() },
    ];

    // Add pinning for active tab
    if (this.activeTabId) {
      const tab = this.tabs.get(this.activeTabId);
      if (tab) {
        commands.push({
          id: "toggle-pin",
          label: tab.pinned ? "Unpin Tab" : "Pin Tab",
          category: "Tabs",
          action: () => {
            tab.pinned = !tab.pinned;
            this.renderTabList();
          },
        });
        commands.push({
          id: "kill-process",
          label: "Kill Process",
          category: "Terminal",
          action: () => tab.sendInterrupt(),
        });
        commands.push({
          id: "restart-shell",
          label: "Restart Shell",
          category: "Terminal",
          action: () => tab.restartShell(),
        });
      }
    }

    // Add startup commands
    for (const [name, cmd] of Object.entries(this.config.startupCommands)) {
      commands.push({
        id: `startup-${name}`,
        label: `New Tab: ${name}`,
        category: "Tabs",
        action: () => this.createTab(undefined, cmd),
      });
    }

    commands.push({
      id: "copy-debug-log",
      label: `Copy Debug Log (${logger.getBufferSize()} entries)`,
      category: "Debug",
      action: () => {
        const logs = logger.getBufferedLogs();
        navigator.clipboard.writeText(logs).then(
          () => showToast("Debug log copied to clipboard", "info"),
          () => showToast("Failed to copy debug log", "error"),
        );
      },
    });

    showCommandPalette(commands);
  }

  private async splitActiveTab(direction: "horizontal" | "vertical") {
    if (!this.activeTabId) return;
    const tab = this.tabs.get(this.activeTabId);
    if (!tab) return;
    try {
      await tab.split(direction);
    } catch (e) {
      logger.warn("Split failed:", e);
      showToast("Failed to split terminal", "error");
    }
  }

  private closeActivePane() {
    if (!this.activeTabId) return;
    const tab = this.tabs.get(this.activeTabId);
    if (!tab) return;
    // If only one pane, fall through to close tab
    if (!tab.closeFocusedPane()) {
      this.closeTab(this.activeTabId);
    }
  }

  /** Close multiple tabs, confirming if any have running processes. */
  private bulkClose(ids: string[]) {
    if (ids.length === 0) return;
    const running = ids.filter((id) => {
      const t = this.tabs.get(id);
      return t && !t.state.isIdle && t.state.processName;
    });
    if (running.length > 0) {
      const names = running.map((id) => this.tabs.get(id)!.state.processName).join(", ");
      this.showCloseConfirm(running[0], `${running.length} tab(s) have running processes (${names})`, () => {
        for (const id of ids) this.forceCloseTab(id);
      });
    } else {
      for (const id of ids) this.forceCloseTab(id);
    }
  }

  private closeTab(id: string, force = false) {
    logger.debug(`[closeTab] id=${id} force=${force}`);
    const tab = this.tabs.get(id);
    if (!tab) return;

    // Pinned tabs can't be closed unless forced
    if (tab.pinned && !force) {
      showToast("Unpin the tab first to close it", "warn", 2000);
      return;
    }

    // Confirm if a process is running (not idle) and not forced
    if (!force && !tab.state.isIdle && tab.state.processName) {
      this.showCloseConfirm(id, tab.state.processName);
      return;
    }

    this.forceCloseTab(id);
  }

  private forceCloseTab(id: string) {
    const tab = this.tabs.get(id);
    if (!tab) return;

    // Save CWD for restore-closed-tab feature (keep last 10)
    const cwd = tab.lastFullCwd;
    if (cwd) {
      this.closedTabStack.push({ cwd, title: tab.manualTitle ?? undefined });
      const MAX_CLOSED_TABS = 10;
      if (this.closedTabStack.length > MAX_CLOSED_TABS) this.closedTabStack.shift();
    }

    // Clean up worktree if configured
    const wtTab = tab as Tab & { worktreePath?: string; repoRoot?: string };
    if (wtTab.worktreePath && wtTab.repoRoot && this.config.worktree.autoCleanup) {
      invoke("remove_worktree", {
        repoDir: wtTab.repoRoot,
        worktreePath: wtTab.worktreePath,
        force: false,
      }).catch((e) => {
        logger.debug("Auto-cleanup worktree failed (may have uncommitted changes):", e);
      });
    }

    this.serverTracker.removeServer(id);
    try {
      tab.dispose();
    } catch (e) {
      logger.warn(`Tab ${id} dispose failed:`, e);
    }
    this.tabs.delete(id);

    if (this.activeTabId === id) {
      this.activeTabId = null;
      const remaining = Array.from(this.tabs.keys());
      if (remaining.length > 0) {
        this.switchToTab(remaining[remaining.length - 1]);
      } else {
        this.createTab();
        return;
      }
    }

    this.renderTabList();
    this.updateStatusBar();
    this.persistSession();
  }

  private restoreClosedTab() {
    const entry = this.closedTabStack.pop();
    if (!entry) {
      showToast("No recently closed tabs", "warn", 2000);
      return;
    }
    this.createTab(entry.cwd);
  }

  private async openWorktreeDialog() {
    // Find repo root from active tab's CWD
    const activeTab = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
    const cwd = activeTab?.lastFullCwd;
    if (!cwd) {
      showToast("No working directory — open a tab first", "warn");
      return;
    }

    let repoRoot: string;
    try {
      repoRoot = await invokeWithTimeout<string>("find_repo_root", { dir: cwd }, 3000);
    } catch {
      showToast("Not in a git repository", "warn");
      return;
    }

    const worktreeDir = this.config.worktree.directory;
    const defaultAgent = this.config.worktree.defaultAgent;

    showWorktreeDialog(repoRoot, worktreeDir, defaultAgent, (result) => {
      this.createAgentTab(repoRoot, result);
    });
  }

  private async createAgentTab(repoRoot: string, result: WorktreeDialogResult) {
    try {
      // Create the worktree
      await invokeWithTimeout<string>(
        "create_worktree",
        {
          repoDir: repoRoot,
          worktreeDir: result.worktreeDir,
          branch: result.branch,
          baseBranch: result.baseBranch,
          createBranch: result.createBranch,
        },
        10000,
      );

      // Create tab with CWD = worktree path
      await this.createTab(result.worktreeDir);

      // Store worktree metadata on the tab
      const tab = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
      if (tab) {
        (tab as Tab & { worktreePath?: string; repoRoot?: string }).worktreePath = result.worktreeDir;
        (tab as Tab & { worktreePath?: string; repoRoot?: string }).repoRoot = repoRoot;
      }

      // Run post-create hooks
      for (const hook of this.config.worktree.postCreateHooks) {
        this.writeToActivePty(hook + "\n");
        // Small delay between hooks
        await new Promise((r) => setTimeout(r, 500));
      }

      // Launch agent if configured
      if (result.launchAgent) {
        // Wait a moment for shell to initialize
        await new Promise((r) => setTimeout(r, 300));
        this.writeToActivePty(result.launchAgent + "\n");
      }

      showToast(`Worktree created: ${result.branch}`, "info", 3000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Failed to create worktree: ${msg}`, "error");
      logger.warn("createAgentTab failed:", e);
    }
  }

  private showCloseConfirm(tabId: string, processName: string, onConfirm?: () => void) {
    // Remove existing confirm if any
    document.querySelector(".close-confirm-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "close-confirm-overlay";

    const dialog = document.createElement("div");
    dialog.className = "close-confirm-dialog";
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "close-confirm-title");
    dialog.setAttribute("aria-describedby", "close-confirm-body");

    const titleEl = document.createElement("div");
    titleEl.className = "close-confirm-title";
    titleEl.id = "close-confirm-title";
    titleEl.textContent = "Close tab?";

    const bodyEl = document.createElement("div");
    bodyEl.className = "close-confirm-body";
    bodyEl.id = "close-confirm-body";
    bodyEl.textContent = `"${processName}" is still running.`;

    const actionsEl = document.createElement("div");
    actionsEl.className = "close-confirm-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "close-confirm-btn cancel";
    cancelBtn.textContent = "Cancel";

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "close-confirm-btn confirm";
    confirmBtn.textContent = "Close Anyway";

    actionsEl.appendChild(cancelBtn);
    actionsEl.appendChild(confirmBtn);
    dialog.appendChild(titleEl);
    dialog.appendChild(bodyEl);
    dialog.appendChild(actionsEl);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const removeTrap = trapFocus(dialog);
    const dismiss = () => {
      removeTrap();
      overlay.remove();
    };

    cancelBtn.addEventListener("click", dismiss);
    confirmBtn.addEventListener("click", () => {
      dismiss();
      if (onConfirm) {
        onConfirm();
      } else {
        this.forceCloseTab(tabId);
      }
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) dismiss();
    });
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") dismiss();
    });

    cancelBtn.focus();
  }

  private showTabContextMenu(e: MouseEvent, tabId: string) {
    e.preventDefault();
    e.stopPropagation();

    const tab = this.tabs.get(tabId);
    if (!tab) return;

    const items: ContextMenuItem[] = [
      {
        label: "Rename Tab",
        action: () => this.startTabRename(tabId),
      },
      {
        label: tab.pinned ? "Unpin Tab" : "Pin Tab",
        action: () => {
          tab.pinned = !tab.pinned;
          this.renderTabList();
        },
      },
      {
        label: tab.muted ? "Unmute Notifications" : "Mute Notifications",
        action: () => {
          tab.muted = !tab.muted;
          this.renderTabList();
        },
      },
      {
        label: "Close",
        separator: true,
        disabled: tab.pinned,
        action: () => this.closeTab(tabId),
      },
      {
        label: "Split Right",
        separator: true,
        action: () => {
          this.switchToTab(tabId);
          tab.split("horizontal").catch((e) => {
            logger.warn("Split failed:", e);
            showToast("Failed to split terminal", "error");
          });
        },
      },
      {
        label: "Split Down",
        action: () => {
          this.switchToTab(tabId);
          tab.split("vertical").catch((e) => {
            logger.warn("Split failed:", e);
            showToast("Failed to split terminal", "error");
          });
        },
      },
      {
        label: "Close Others",
        separator: true,
        action: () => {
          const ids = Array.from(this.tabs.keys()).filter((id) => id !== tabId && !this.tabs.get(id)?.pinned);
          this.bulkClose(ids);
        },
      },
      {
        label: "Close to Right",
        action: () => {
          const ids = Array.from(this.tabs.keys());
          const idx = ids.indexOf(tabId);
          const targets = ids.slice(idx + 1).filter((id) => !this.tabs.get(id)?.pinned);
          this.bulkClose(targets);
        },
      },
    ];

    // Open in browser if server tab
    const server = this.serverTracker.getServer(tabId);
    if (server) {
      items.push({
        label: `Open localhost:${server.port} in Browser`,
        separator: true,
        action: () => {
          try {
            window.open(`http://localhost:${server.port}`, "_blank");
          } catch {
            showToast(`Failed to open localhost:${server.port}`, "error");
          }
        },
      });
    }

    // Process control
    items.push({
      label: "Kill Process",
      separator: true,
      disabled: tab.state.isIdle,
      action: () => {
        tab.sendInterrupt();
      },
    });

    items.push({
      label: "Restart Shell",
      action: () => {
        tab.restartShell();
      },
    });

    // Copy CWD
    items.push({
      label: "Copy Working Directory",
      separator: true,
      action: () => {
        const fullCwd = tab.lastFullCwd;
        if (fullCwd) {
          navigator.clipboard.writeText(fullCwd).catch(() => {
            showToast("Failed to copy to clipboard", "error");
          });
        }
      },
    });

    showContextMenu(e.clientX, e.clientY, items);
  }

  private renderTabList() {
    const list = document.getElementById("tab-list")!;
    this.tabRenderer.renderTabList(list, this.tabs, this.activeTabId);
  }

  private reorderTab(dragId: string, targetId: string, insertBefore: boolean) {
    const keys = [...this.tabs.keys()];
    const dragIdx = keys.indexOf(dragId);
    if (dragIdx === -1) return;

    // Remove dragged key
    keys.splice(dragIdx, 1);

    // Find target position (after removal of dragId)
    let targetIdx = keys.indexOf(targetId);
    if (targetIdx === -1) return;

    if (!insertBefore) targetIdx += 1;
    keys.splice(targetIdx, 0, dragId);

    // Rebuild the Map in new order
    const reordered = new Map<string, Tab>();
    for (const key of keys) {
      const tab = this.tabs.get(key);
      if (tab) reordered.set(key, tab);
    }
    this.tabs = reordered;

    this.renderTabList();
    this.persistSession();
  }

  private setupStatusBarClicks() {
    document.getElementById("status-cwd")?.addEventListener("click", () => {
      if (!this.activeTabId) return;
      const tab = this.tabs.get(this.activeTabId);
      const cwd = tab?.lastFullCwd;
      if (cwd) {
        navigator.clipboard.writeText(cwd).then(
          () => showToast(`Copied: ${cwd}`, "info", 2000),
          () => {},
        );
      }
    });

    document.getElementById("status-git")?.addEventListener("click", () => {
      if (!this.activeTabId) return;
      const tab = this.tabs.get(this.activeTabId);
      const branch = tab?.state.gitBranch;
      if (branch) {
        navigator.clipboard.writeText(branch).then(
          () => showToast(`Copied: ${branch}`, "info", 2000),
          () => {},
        );
      }
    });

    document.getElementById("status-server")?.addEventListener("click", () => {
      if (!this.activeTabId) return;
      const tab = this.tabs.get(this.activeTabId);
      const port = tab?.state.serverPort;
      if (port) {
        try {
          window.open(`http://localhost:${port}`, "_blank");
        } catch {
          showToast(`Failed to open localhost:${port}`, "error");
        }
      }
    });
  }

  private updateStatusBar() {
    const tab = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
    this.tabRenderer.updateStatusBar(tab?.state ?? null);
  }

  private adjustFontSize(delta: number) {
    const current = this.config.font.size;
    const newSize = Math.max(8, Math.min(32, current + delta));
    if (newSize === current) return;
    this.config.font.size = newSize;
    for (const tab of this.tabs.values()) {
      tab.applyConfig(this.config);
    }
    invoke("write_config", { contents: JSON.stringify(this.config, null, 2) }).catch(() => {
      showToast("Couldn't save font size", "warn");
    });
  }

  private resetFontSize() {
    this.config.font.size = 14; // default
    for (const tab of this.tabs.values()) {
      tab.applyConfig(this.config);
    }
    invoke("write_config", { contents: JSON.stringify(this.config, null, 2) }).catch(() => {
      showToast("Couldn't save font size", "warn");
    });
  }

  private async reloadConfig() {
    this.config = await loadConfig();
    this.notifications.updateConfig(this.config.notifications);
    applyThemeToCSS(this.config);

    for (const tab of this.tabs.values()) {
      tab.applyConfig(this.config);
    }

    // Restart poll timer with potentially new interval values
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.startCentralPoll();

    this.renderTabList();
  }

  private startCentralPoll() {
    const fgInterval = this.config.advanced.pollIntervalMs;
    const bgInterval = this.config.advanced.backgroundPollIntervalMs;
    let pollCycleCount = 0;

    this.pollTimer = setInterval(async () => {
      if (this.quitting) return;
      pollCycleCount++;
      const now = Date.now();
      const pollBackground = now - this.lastBackgroundPoll >= bgInterval;
      if (pollBackground) this.lastBackgroundPoll = now;

      // Snapshot active tab ID to avoid race if user switches mid-loop
      const activeId = this.activeTabId;

      logger.debug(
        `[centralPoll] cycle=${pollCycleCount} tabs=${this.tabs.size} bg=${pollBackground} active=${activeId}`,
      );

      // Poll tabs concurrently so one stuck IPC call can't block everything
      const polls: Promise<void>[] = [];
      for (const [id, tab] of this.tabs) {
        if (id === activeId || pollBackground) {
          polls.push(tab.pollProcessInfo().catch((e) => logger.debug("[poll] tab error:", e)));
        }
      }
      await Promise.all(polls);

      // Periodic recovery refresh for the active tab — catches silent WebGL
      // context loss or canvas blanking under heavy multi-tab load (#170).
      // Runs every 10 poll cycles (~10s) to avoid unnecessary work.
      if (activeId && pollCycleCount % 10 === 0) {
        const tab = this.tabs.get(activeId);
        if (tab) tab.refreshAllPanes();
      }

      const snapshot = this.computeTabSnapshot();
      if (snapshot !== this.lastTabSnapshot) {
        this.lastTabSnapshot = snapshot;
        this.renderTabList();
      }
      this.updateStatusBar();
    }, fgInterval);
  }

  private computeTabSnapshot(): string {
    return this.tabRenderer.computeTabSnapshot(this.tabs, this.activeTabId);
  }

  private setupResize() {
    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeRaf) cancelAnimationFrame(this.resizeRaf);
      this.resizeRaf = requestAnimationFrame(() => {
        this.resizeRaf = 0;
        if (this.quitting) return;
        if (this.activeTabId) {
          const tab = this.tabs.get(this.activeTabId);
          // Skip resize during tab show/hide transitions — show() already
          // calls forceFit(), and a concurrent fit() from the ResizeObserver
          // creates a double-fit race that can corrupt scroll position (#177).
          if (tab && !tab.transitioning) tab.fit();
        }
      });
    });
    this.resizeObserver.observe(document.getElementById("terminal-container")!);
  }

  dispose() {
    this.quitting = true;
    // Remove all document-level event listeners registered with AbortController
    this.ac.abort();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
    }
    if (this.resizeRaf) {
      cancelAnimationFrame(this.resizeRaf);
      this.resizeRaf = 0;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.unlistenFocus?.();
    this.unlistenFocus = null;
    this.serverTracker.dispose();
    this.notifications.dispose();
    for (const tab of this.tabs.values()) {
      tab.dispose();
    }
    this.tabs.clear();
    this.tabRenderer.clear();
  }
}
