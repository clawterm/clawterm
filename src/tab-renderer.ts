import type { Tab } from "./tab";
import { ACTIVITY_ICONS, computePaneStatusLine, computeSubtitle, type TabState } from "./tab-state";
import { modLabel } from "./utils";
import { logger } from "./logger";

// Pre-parse SVG icons once at module load
const PARSED_ICONS: Record<string, HTMLElement> = {};
{
  const parser = new DOMParser();
  for (const [key, info] of Object.entries(ACTIVITY_ICONS)) {
    const doc = parser.parseFromString(info.svg, "image/svg+xml");
    PARSED_ICONS[key] = doc.documentElement as unknown as HTMLElement;
  }
}

interface ChildRefs {
  header: HTMLElement;
  icon: HTMLElement;
  title: HTMLElement;
  hint: HTMLElement;
  paneList: HTMLElement;
}

export interface TabRenderActions {
  closeTab(id: string): void;
  switchToTab(id: string): void;
  showTabContextMenu(e: MouseEvent, id: string): void;
  reorderTab(dragId: string, targetId: string, insertBefore: boolean): void;
}

/**
 * Manages the sidebar tab list DOM and status bar updates.
 * Renders folder-based tab titles with per-pane status lines.
 */
export class TabRenderer {
  private tabElements = new Map<string, HTMLElement>();
  private tabChildRefs = new Map<string, ChildRefs>();
  private dragTabId: string | null = null;

  constructor(private actions: TabRenderActions) {}

  /**
   * Render the tab list in the sidebar. Creates new DOM entries for new tabs,
   * updates existing entries, and removes entries for closed tabs.
   */
  renderTabList(list: HTMLElement, tabs: Map<string, Tab>, activeTabId: string | null) {
    // Remove elements for closed tabs
    for (const [id, el] of this.tabElements) {
      if (!tabs.has(id)) {
        logger.debug(`[renderTabList] removing tab DOM id=${id}`);
        el.remove();
        this.tabElements.delete(id);
        this.tabChildRefs.delete(id);
      }
    }

    let index = 0;
    for (const [id, tab] of tabs) {
      let entry = this.tabElements.get(id);

      if (!entry) {
        logger.debug(`[renderTabList] adding tab DOM id=${id} title=${tab.title}`);
        entry = this.createTabEntry(id, list);
      }

      const refs = this.tabChildRefs.get(id)!;

      // Update classes
      let cls = "tab-entry";
      if (id === activeTabId) cls += " active";
      if (tab.state.needsAttention) cls += " needs-attention";
      if (tab.state.notification) cls += ` notif-${tab.state.notification}`;
      if (tab.state.activity === "agent-waiting") cls += " agent-waiting";
      if (tab.state.activity === "agent-maybe-idle") cls += " agent-maybe-idle";
      if (tab.state.activity === "error") cls += " has-error";
      if (tab.pinned) cls += " pinned";
      if (tab.muted) cls += " muted";
      entry.className = cls;
      entry.setAttribute("aria-selected", id === activeTabId ? "true" : "false");

      // Update icon
      const activityInfo = ACTIVITY_ICONS[tab.state.activity];
      const newIconClass = `tab-icon ${activityInfo.cssClass}`;
      if (refs.icon.className !== newIconClass) {
        refs.icon.className = newIconClass;
        refs.icon.title = activityInfo.label;
        refs.icon.replaceChildren();
        const svgClone = PARSED_ICONS[tab.state.activity]?.cloneNode(true);
        if (svgClone) refs.icon.appendChild(svgClone);
      }

      // Update title (now shows /foldername)
      if (refs.title.textContent !== tab.title) {
        refs.title.textContent = tab.title;
      }

      // Update shortcut hint
      if (index < 9) {
        refs.hint.textContent = `${modLabel}${index + 1}`;
        refs.hint.style.display = "";
      } else {
        refs.hint.textContent = "";
        refs.hint.style.display = "none";
      }

      // Update per-pane status lines — every pane always gets a line
      const paneStates = tab.getPaneStates();
      const lines: { text: string; activity: string }[] = paneStates.map((ps) => ({
        text: computePaneStatusLine(ps),
        activity: ps.activity,
      }));

      // Rebuild pane list only if content changed
      const paneKey = lines.map((l) => `${l.activity}:${l.text}`).join("|");
      if (refs.paneList.getAttribute("data-key") !== paneKey) {
        refs.paneList.setAttribute("data-key", paneKey);
        refs.paneList.innerHTML = "";
        for (const line of lines) {
          const lineEl = document.createElement("div");
          lineEl.className = "tab-pane-line";

          const status = document.createElement("span");
          status.className = "tab-pane-status";
          status.textContent = line.text;

          lineEl.appendChild(status);
          refs.paneList.appendChild(lineEl);
        }
        refs.paneList.style.display = lines.length > 0 ? "" : "none";
      }

      // Ensure correct order in DOM
      if (entry !== list.children[index]) {
        list.insertBefore(entry, list.children[index] || null);
      }

      index++;
    }
  }

  private createTabEntry(id: string, list: HTMLElement): HTMLElement {
    const entry = document.createElement("div");
    entry.setAttribute("data-id", id);
    entry.setAttribute("role", "tab");

    // Header row: icon + title + shortcut + close
    const header = document.createElement("div");
    header.className = "tab-header";

    const icon = document.createElement("span");
    icon.className = "tab-icon";
    icon.setAttribute("data-role", "icon");

    const title = document.createElement("span");
    title.className = "tab-title";

    const hint = document.createElement("span");
    hint.className = "tab-shortcut";

    const close = document.createElement("button");
    close.className = "tab-close";
    close.textContent = "\u00d7";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      this.actions.closeTab(id);
    });

    header.appendChild(icon);
    header.appendChild(title);
    header.appendChild(hint);
    header.appendChild(close);

    // Pane status list
    const paneList = document.createElement("div");
    paneList.className = "tab-pane-list";
    paneList.style.display = "none";

    entry.appendChild(header);
    entry.appendChild(paneList);

    entry.addEventListener("click", () => this.actions.switchToTab(id));
    entry.addEventListener("contextmenu", (e) => {
      this.actions.showTabContextMenu(e as MouseEvent, id);
    });

    // Drag-and-drop reordering
    entry.setAttribute("draggable", "true");
    entry.addEventListener("dragstart", (e) => {
      this.dragTabId = id;
      entry.classList.add("dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
      }
    });
    entry.addEventListener("dragend", () => {
      this.dragTabId = null;
      entry.classList.remove("dragging");
      list.querySelectorAll(".tab-entry").forEach((node) => {
        node.classList.remove("drag-over-above", "drag-over-below");
      });
    });
    entry.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!this.dragTabId || this.dragTabId === id) return;
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      const rect = entry.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      entry.classList.toggle("drag-over-above", e.clientY < midY);
      entry.classList.toggle("drag-over-below", e.clientY >= midY);
    });
    entry.addEventListener("dragleave", () => {
      entry.classList.remove("drag-over-above", "drag-over-below");
    });
    entry.addEventListener("drop", (e) => {
      e.preventDefault();
      entry.classList.remove("drag-over-above", "drag-over-below");
      if (!this.dragTabId || this.dragTabId === id) return;
      const rect = entry.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const insertBefore = e.clientY < midY;
      this.actions.reorderTab(this.dragTabId, id, insertBefore);
    });

    this.tabElements.set(id, entry);
    this.tabChildRefs.set(id, { header, icon, title, hint, paneList });
    list.appendChild(entry);

    return entry;
  }

  /** Elapsed timer interval — ticks once per second when an agent is active */
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;
  private lastElapsedState: TabState | null = null;

  /** Update the status bar with the active tab's state.
   *  Context-adaptive: shows different fields depending on whether the
   *  active tab is running a shell, an agent, or a dev server. */
  updateStatusBar(state: TabState | null) {
    const cwdEl = document.getElementById("status-cwd");
    const gitEl = document.getElementById("status-git");
    const processEl = document.getElementById("status-process");
    const serverEl = document.getElementById("status-server");
    const agentEl = document.getElementById("status-agent");

    if (!state) return;

    this.lastElapsedState = state;

    // --- Always-visible: CWD and git branch ---
    if (cwdEl) cwdEl.textContent = state.folderName;
    if (gitEl) {
      gitEl.textContent = state.gitBranch ? `\u2387 ${state.gitBranch}` : "";
    }

    // --- Context-adaptive fields ---
    const isAgent = !!state.agentName;
    const isServer = state.activity === "server-running" && !!state.serverPort;
    const hasError = state.activity === "error";

    if (isAgent) {
      // Agent mode: show agent name + status, elapsed time, current action
      const agentClass =
        state.activity === "agent-waiting" || state.activity === "agent-maybe-idle"
          ? "status-waiting"
          : "status-active";
      this.setStatusField(processEl, this.formatAgentStatus(state), agentClass);
      this.setStatusField(serverEl, this.formatElapsedCompact(state.agentStartedAt), "status-elapsed");
      this.setStatusField(agentEl, state.lastAction ?? "", state.lastAction ? "status-action" : "");
      this.startElapsedTimer();
    } else if (isServer) {
      // Server mode: port + process
      this.setStatusField(processEl, state.processName && !state.isIdle ? state.processName : "");
      this.setStatusField(serverEl, `:${state.serverPort}`, "status-active");
      this.setStatusField(agentEl, "");
      this.stopElapsedTimer();
    } else if (hasError) {
      // Error mode: show error prominently
      this.setStatusField(processEl, state.processName && !state.isIdle ? state.processName : "");
      this.setStatusField(serverEl, "");
      this.setStatusField(agentEl, state.lastError ?? "error", "status-error");
      this.stopElapsedTimer();
    } else {
      // Shell mode: process name only
      this.setStatusField(processEl, state.isIdle ? "" : state.processName);
      this.setStatusField(serverEl, "");
      this.setStatusField(agentEl, "");
      this.stopElapsedTimer();
    }
  }

  private formatAgentStatus(state: TabState): string {
    const name = state.agentName ?? "agent";
    if (state.activity === "agent-waiting") return `${name} \u2022 waiting`;
    if (state.activity === "agent-maybe-idle") return `${name} \u2022 idle?`;
    if (state.activity === "completed") return `${name} \u2022 done`;
    return name;
  }

  private formatElapsedCompact(startMs: number | null): string {
    if (!startMs) return "";
    const secs = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    const mins = Math.floor(secs / 60);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) return `${hrs}:${String(mins % 60).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
    return `${mins}:${String(secs % 60).padStart(2, "0")}`;
  }

  private setStatusField(el: HTMLElement | null, text: string, className = "") {
    if (!el) return;
    if (el.textContent !== text) el.textContent = text;
    if (el.className !== className) el.className = className;
  }

  /** Start a 1-second timer to update the elapsed time display.
   *  No-ops if already running. */
  private startElapsedTimer() {
    if (this.elapsedTimer) return;
    this.elapsedTimer = setInterval(() => {
      const state = this.lastElapsedState;
      if (!state?.agentStartedAt) return;
      const serverEl = document.getElementById("status-server");
      if (serverEl) {
        const text = this.formatElapsedCompact(state.agentStartedAt);
        if (serverEl.textContent !== text) serverEl.textContent = text;
      }
    }, 1000);
  }

  /** Stop the elapsed timer. */
  private stopElapsedTimer() {
    if (this.elapsedTimer) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
  }

  /** Build a snapshot string for change detection. */
  computeTabSnapshot(tabs: Map<string, Tab>, activeTabId: string | null): string {
    const parts: string[] = [];
    for (const [id, tab] of tabs) {
      const s = tab.state;
      const subtitle = computeSubtitle(s) ?? "";
      // Include per-pane status in snapshot for change detection
      const paneSnap = tab
        .getPaneStates()
        .map(
          (ps) =>
            `${ps.activity}:${ps.agentName}:${ps.serverPort}:${ps.processName}:${ps.folderName}:${ps.lastError}:${ps.agentStartedAt ? Math.floor((Date.now() - ps.agentStartedAt) / 1000) : ""}:${ps.waitingType}:${ps.actionCount}:${ps.agentJustStarted}`,
        )
        .join(",");
      parts.push(
        `${id}|${tab.title}|${subtitle}|${s.activity}|${s.needsAttention}|${s.serverPort}|${s.agentName}|${s.lastError}|${s.gitBranch}|${s.folderName}|${s.notification}|${paneSnap}`,
      );
    }
    parts.push(`active:${activeTabId}`);
    return parts.join(";");
  }

  /** Clean up all cached elements. */
  clear() {
    this.stopElapsedTimer();
    this.tabElements.clear();
    this.tabChildRefs.clear();
  }
}
