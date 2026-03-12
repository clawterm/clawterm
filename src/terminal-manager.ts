import { Tab } from "./tab";
import { loadConfig, matchesKeybinding, applyThemeToCSS, type Config } from "./config";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invokeWithTimeout } from "./utils";
import { ACTIVITY_ICONS, computeSubtitle } from "./tab-state";
import { NotificationManager } from "./notifications";
import { ServerTracker } from "./server-tracker";
import { showContextMenu, type ContextMenuItem } from "./context-menu";
import { TabSwitcher, type SwitcherTab } from "./tab-switcher";
import type { OutputEvent } from "./matchers";
import { logger } from "./logger";
import { modLabel } from "./utils";

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

const PARSED_ICONS: Record<string, HTMLElement> = {};
{
  const parser = new DOMParser();
  for (const [key, info] of Object.entries(ACTIVITY_ICONS)) {
    const doc = parser.parseFromString(info.svg, "image/svg+xml");
    PARSED_ICONS[key] = doc.documentElement as unknown as HTMLElement;
  }
}

export class TerminalManager {
  private tabs: Map<string, Tab> = new Map();
  private activeTabId: string | null = null;
  private tabCounter = 0;
  private config!: Config;
  private notifications!: NotificationManager;
  private serverTracker!: ServerTracker;
  private tabSwitcher = new TabSwitcher();
  private resizeObserver: ResizeObserver | null = null;
  // @ts-expect-error stored for lifecycle management
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastBackgroundPoll = 0;
  private tabElements: Map<string, HTMLElement> = new Map();

  async init() {
    this.config = await loadConfig();
    this.notifications = new NotificationManager(this.config.notifications);
    this.serverTracker = new ServerTracker(
      this.config.advanced.healthCheckIntervalMs,
      this.config.advanced.ipcTimeoutMs,
    );
    applyThemeToCSS(this.config);
    this.renderShell();
    this.setupResize();
    this.setupServerTracker();
    this.startCentralPoll();
    await this.createTab();
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
      this.notifications.notify(event, tab.title, this.activeTabId === tabId);
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
        { id: "titlebar" },
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
        el(
          "div",
          { id: "terminal-area" },
          el("div", { id: "terminal-container" }),
          el(
            "div",
            { id: "status-bar" },
            el("span", { id: "status-cwd" }),
            el("span", { id: "status-process" }),
            el("span", { id: "status-server" }),
            el("span", { id: "status-agent" }),
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
      // Only drag from the titlebar itself, not buttons
      if ((e.target as HTMLElement).closest("#traffic-lights")) return;
      win.startDragging();
    });
    titlebar.addEventListener("dblclick", (e) => {
      if ((e.target as HTMLElement).closest("#traffic-lights")) return;
      win.toggleMaximize();
    });

    document.getElementById("new-tab-btn")!.addEventListener("click", () => {
      this.createTab();
    });
  }

  // Returns true if the key event should be passed through to xterm,
  // false if the manager handled it
  private handleKey = (e: KeyboardEvent): boolean => {
    if (e.type !== "keydown") return true;

    const kb = this.config.keybindings;

    if (matchesKeybinding(e, kb.newTab)) {
      e.preventDefault();
      this.createTab();
      return false;
    }

    if (matchesKeybinding(e, kb.closeTab)) {
      e.preventDefault();
      if (this.activeTabId) this.closeTab(this.activeTabId);
      return false;
    }

    if (matchesKeybinding(e, kb.nextTab)) {
      e.preventDefault();
      this.nextTab();
      return false;
    }

    if (matchesKeybinding(e, kb.prevTab)) {
      e.preventDefault();
      this.prevTab();
      return false;
    }

    if (matchesKeybinding(e, kb.reloadConfig)) {
      e.preventDefault();
      this.reloadConfig();
      return false;
    }

    if (matchesKeybinding(e, kb.cycleAttention)) {
      e.preventDefault();
      this.cycleAttentionTabs();
      return false;
    }

    if (matchesKeybinding(e, kb.search)) {
      e.preventDefault();
      if (this.activeTabId) {
        const tab = this.tabs.get(this.activeTabId);
        tab?.toggleSearch();
      }
      return false;
    }

    if (matchesKeybinding(e, kb.quickSwitch)) {
      e.preventDefault();
      this.showQuickSwitch();
      return false;
    }

    // Cmd+1-9: switch to tab by index
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key >= "1" && e.key <= "9") {
      e.preventDefault();
      const index = parseInt(e.key) - 1;
      const ids = Array.from(this.tabs.keys());
      if (index < ids.length) {
        this.switchToTab(ids[index]);
      }
      return false;
    }

    return true; // not handled, pass to xterm
  };

  async createTab() {
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
    const title = `Terminal ${this.tabCounter}`;

    // Grab CWD from active tab synchronously before anything else
    let cwd: string | undefined;
    if (this.activeTabId) {
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
      this.notifications.notifyCommandComplete(tab.title, this.activeTabId === tab.id);
    };

    tab.onOutputEvent = (event: OutputEvent) => {
      this.handleTabOutputEvent(id, tab, event);
    };

    this.tabs.set(id, tab);
    this.renderTabList();

    // Start the PTY and open terminal in DOM first
    await tab.start();

    // Now switch to it (show + focus) after terminal is ready
    this.switchToTab(id);

    // Extra focus after a frame to ensure terminal is interactive
    requestAnimationFrame(() => tab.focus());
  }

  private handleTabOutputEvent(tabId: string, tab: Tab, event: OutputEvent) {
    // Track servers
    if (event.type === "server-started" && event.port) {
      this.serverTracker.addServer(tabId, event.port);
    }

    // Forward to notifications
    this.notifications.notify(event, tab.title, this.activeTabId === tabId);

    // Re-render UI
    this.renderTabList();
    this.updateStatusBar();
  }

  private switchToTab(id: string) {
    if (this.activeTabId === id) return;

    if (this.activeTabId) {
      const current = this.tabs.get(this.activeTabId);
      if (current) current.hide();
    }

    this.activeTabId = id;
    const tab = this.tabs.get(id);
    if (tab) tab.show();

    this.renderTabList();
    this.updateStatusBar();
  }

  private nextTab() {
    const ids = Array.from(this.tabs.keys());
    if (ids.length <= 1) return;
    const currentIndex = ids.indexOf(this.activeTabId!);
    const nextIndex = (currentIndex + 1) % ids.length;
    this.switchToTab(ids[nextIndex]);
  }

  private prevTab() {
    const ids = Array.from(this.tabs.keys());
    if (ids.length <= 1) return;
    const currentIndex = ids.indexOf(this.activeTabId!);
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

  private closeTab(id: string, force = false) {
    const tab = this.tabs.get(id);
    if (!tab) return;

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

    this.serverTracker.removeServer(id);
    tab.dispose();
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
  }

  private showCloseConfirm(tabId: string, processName: string) {
    // Remove existing confirm if any
    document.querySelector(".close-confirm-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "close-confirm-overlay";

    const dialog = document.createElement("div");
    dialog.className = "close-confirm-dialog";
    dialog.innerHTML = `
      <div class="close-confirm-title">Close tab?</div>
      <div class="close-confirm-body">"${processName}" is still running.</div>
      <div class="close-confirm-actions">
        <button class="close-confirm-btn cancel">Cancel</button>
        <button class="close-confirm-btn confirm">Close Anyway</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const dismiss = () => overlay.remove();

    dialog.querySelector(".cancel")!.addEventListener("click", dismiss);
    dialog.querySelector(".confirm")!.addEventListener("click", () => {
      dismiss();
      this.forceCloseTab(tabId);
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) dismiss();
    });

    // Focus the cancel button
    (dialog.querySelector(".cancel") as HTMLButtonElement).focus();
  }

  private startRenameTab(id: string) {
    const tab = this.tabs.get(id);
    if (!tab) return;

    const entry = document.querySelector(`.tab-entry[data-id="${id}"]`);
    if (!entry) return;

    const titleEl = entry.querySelector(".tab-title") as HTMLElement;
    if (!titleEl) return;

    const input = document.createElement("input");
    input.className = "tab-title-input";
    input.value = tab.title;

    const commit = () => {
      const newTitle = input.value.trim() || tab.title;
      tab.title = newTitle;
      tab.manualTitle = newTitle;
      this.renderTabList();
    };

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      }
      if (e.key === "Escape") {
        this.renderTabList();
      }
    });

    titleEl.replaceWith(input);
    input.focus();
    input.select();
  }

  private showTabContextMenu(e: MouseEvent, tabId: string) {
    e.preventDefault();
    e.stopPropagation();

    const tab = this.tabs.get(tabId);
    if (!tab) return;

    const items: ContextMenuItem[] = [
      {
        label: "Rename",
        action: () => this.startRenameTab(tabId),
      },
      {
        label: "Close",
        action: () => this.closeTab(tabId),
      },
      {
        label: "Close Others",
        separator: true,
        action: () => {
          const ids = Array.from(this.tabs.keys()).filter((id) => id !== tabId);
          for (const id of ids) this.closeTab(id);
        },
      },
      {
        label: "Close to Right",
        action: () => {
          const ids = Array.from(this.tabs.keys());
          const idx = ids.indexOf(tabId);
          for (let i = ids.length - 1; i > idx; i--) {
            this.closeTab(ids[i]);
          }
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
          window.open(`http://localhost:${server.port}`, "_blank");
        },
      });
    }

    // Copy CWD
    items.push({
      label: "Copy Working Directory",
      separator: !server,
      action: () => {
        navigator.clipboard.writeText(tab.state.folderName);
      },
    });

    showContextMenu(e.clientX, e.clientY, items);
  }

  private renderTabList() {
    const list = document.getElementById("tab-list")!;

    // Remove elements for closed tabs
    for (const [id, el] of this.tabElements) {
      if (!this.tabs.has(id)) {
        el.remove();
        this.tabElements.delete(id);
      }
    }

    let index = 0;
    for (const [id, tab] of this.tabs) {
      let entry = this.tabElements.get(id);

      if (!entry) {
        // Create new tab entry
        entry = document.createElement("div");
        entry.setAttribute("data-id", id);
        entry.setAttribute("role", "tab");

        const icon = document.createElement("span");
        icon.className = "tab-icon";
        icon.setAttribute("data-role", "icon");

        const titleWrap = document.createElement("div");
        titleWrap.className = "tab-title-wrap";

        const title = document.createElement("span");
        title.className = "tab-title";
        titleWrap.appendChild(title);

        const sub = document.createElement("span");
        sub.className = "tab-subtitle";
        titleWrap.appendChild(sub);

        const hint = document.createElement("span");
        hint.className = "tab-shortcut";

        const close = document.createElement("button");
        close.className = "tab-close";
        close.textContent = "\u00d7";
        close.addEventListener("click", (e) => {
          e.stopPropagation();
          this.closeTab(id);
        });

        entry.appendChild(icon);
        entry.appendChild(titleWrap);
        entry.appendChild(hint);
        entry.appendChild(close);

        entry.addEventListener("click", () => this.switchToTab(id));
        entry.addEventListener("dblclick", (e) => {
          e.preventDefault();
          this.startRenameTab(id);
        });
        entry.addEventListener("contextmenu", (e) => {
          this.showTabContextMenu(e, id);
        });

        this.tabElements.set(id, entry);
        list.appendChild(entry);
      }

      // Update classes
      let cls = "tab-entry";
      if (id === this.activeTabId) cls += " active";
      if (tab.state.needsAttention) cls += " needs-attention";
      if (tab.state.activity === "agent-waiting") cls += " agent-waiting";
      if (tab.state.activity === "error") cls += " has-error";
      entry.className = cls;
      entry.setAttribute("aria-selected", id === this.activeTabId ? "true" : "false");

      // Update icon
      const icon = entry.querySelector("[data-role='icon']") as HTMLElement;
      const activityInfo = ACTIVITY_ICONS[tab.state.activity];
      const newIconClass = `tab-icon ${activityInfo.cssClass}`;
      if (icon.className !== newIconClass) {
        icon.className = newIconClass;
        icon.replaceChildren();
        const svgClone = PARSED_ICONS[tab.state.activity]?.cloneNode(true);
        if (svgClone) icon.appendChild(svgClone);
      }

      // Update title
      const titleEl = entry.querySelector(".tab-title") as HTMLElement;
      if (titleEl.textContent !== tab.title) {
        titleEl.textContent = tab.title;
      }

      // Update subtitle
      const subEl = entry.querySelector(".tab-subtitle") as HTMLElement;
      const subtitle = computeSubtitle(tab.state);
      subEl.textContent = subtitle ?? "";
      subEl.style.display = subtitle ? "" : "none";

      // Update shortcut hint
      const hintEl = entry.querySelector(".tab-shortcut") as HTMLElement;
      if (index < 9) {
        hintEl.textContent = `${modLabel}${index + 1}`;
        hintEl.style.display = "";
      } else {
        hintEl.textContent = "";
        hintEl.style.display = "none";
      }

      // Ensure correct order in DOM
      if (entry !== list.children[index]) {
        list.insertBefore(entry, list.children[index] || null);
      }

      index++;
    }
  }

  private updateStatusBar() {
    if (!this.activeTabId) return;
    const tab = this.tabs.get(this.activeTabId);
    if (!tab) return;

    const cwdEl = document.getElementById("status-cwd");
    const processEl = document.getElementById("status-process");
    const serverEl = document.getElementById("status-server");
    const agentEl = document.getElementById("status-agent");

    if (cwdEl) cwdEl.textContent = tab.state.folderName;
    if (processEl) {
      processEl.textContent = tab.state.isIdle ? "" : tab.state.processName;
    }
    if (serverEl) {
      serverEl.textContent = tab.state.serverPort ? `:${tab.state.serverPort}` : "";
      serverEl.className = tab.state.serverPort ? "status-active" : "";
    }
    if (agentEl) {
      if (tab.state.activity === "agent-waiting") {
        agentEl.textContent = `${tab.state.agentName ?? "agent"} — waiting`;
        agentEl.className = "status-waiting";
      } else if (tab.state.agentName) {
        agentEl.textContent = tab.state.agentName;
        agentEl.className = "status-active";
      } else if (tab.state.lastError) {
        agentEl.textContent = tab.state.lastError;
        agentEl.className = "status-error";
      } else {
        agentEl.textContent = "";
        agentEl.className = "";
      }
    }
  }

  private async reloadConfig() {
    this.config = await loadConfig();
    this.notifications.updateConfig(this.config.notifications);
    applyThemeToCSS(this.config);

    for (const tab of this.tabs.values()) {
      tab.applyConfig(this.config);
    }

    this.renderTabList();
  }

  private startCentralPoll() {
    const fgInterval = this.config.advanced.pollIntervalMs;
    const bgInterval = this.config.advanced.backgroundPollIntervalMs;

    this.pollTimer = setInterval(async () => {
      const now = Date.now();
      const pollBackground = now - this.lastBackgroundPoll >= bgInterval;
      if (pollBackground) this.lastBackgroundPoll = now;

      for (const [id, tab] of this.tabs) {
        if (id === this.activeTabId) {
          // Always poll active tab
          await tab.pollProcessInfo();
        } else if (pollBackground) {
          // Poll background tabs at slower rate
          await tab.pollProcessInfo();
        }
      }

      this.renderTabList();
      this.updateStatusBar();
    }, fgInterval);
  }

  private setupResize() {
    this.resizeObserver = new ResizeObserver(() => {
      if (this.activeTabId) {
        const tab = this.tabs.get(this.activeTabId);
        if (tab) tab.fit();
      }
    });
    this.resizeObserver.observe(document.getElementById("terminal-container")!);
  }
}
