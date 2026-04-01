import type { Tab } from "./tab";
import { computePaneStatusLine, type TabState } from "./tab-state";
import { modLabel } from "./utils";
import { logger } from "./logger";

interface ChildRefs {
  header: HTMLElement;
  title: HTMLElement;
  hint: HTMLElement;
  branchBadge: HTMLElement;
  paneList: HTMLElement;
}

export interface TabRenderActions {
  closeTab(id: string): void;
  switchToTab(id: string): void;
  showTabContextMenu(e: MouseEvent, id: string): void;
  reorderTab(dragId: string, targetId: string, insertBefore: boolean): void;
  renameTab(id: string): void;
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
      if (tab.state.activity === "error") cls += " has-error";
      if (tab.pinned) cls += " pinned";
      if (tab.muted) cls += " muted";
      entry.className = cls;
      entry.setAttribute("aria-selected", id === activeTabId ? "true" : "false");

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

      // Branch badge removed — branch info is shown in per-pane status lines
      refs.branchBadge.style.display = "none";

      // Update per-pane status lines — every pane always gets a line.
      // Show branch prefix when panes are on different branches.
      const paneStates = tab.getPaneStates();
      const paneBranches = new Set(paneStates.map((ps) => ps.gitBranch).filter(Boolean));
      const showBranch = paneBranches.size > 1;
      const lines: { text: string; activity: string }[] = paneStates.map((ps) => ({
        text: computePaneStatusLine(ps, showBranch),
        activity: ps.activity,
      }));

      // Update pane list in place — reuse existing DOM nodes instead of
      // destroying and recreating with innerHTML on every change.
      // Remove excess nodes if pane count decreased
      while (refs.paneList.children.length > lines.length) {
        refs.paneList.lastChild!.remove();
      }
      for (let i = 0; i < lines.length; i++) {
        let lineEl = refs.paneList.children[i] as HTMLDivElement | undefined;
        let statusEl: HTMLSpanElement;
        if (!lineEl) {
          // Create new node only when pane count increased
          lineEl = document.createElement("div");
          statusEl = document.createElement("span");
          statusEl.className = "tab-pane-status";
          lineEl.appendChild(statusEl);
          refs.paneList.appendChild(lineEl);
        } else {
          statusEl = lineEl.querySelector(".tab-pane-status") as HTMLSpanElement;
        }
        const cls = `tab-pane-line pane-${lines[i].activity}`;
        if (lineEl.className !== cls) lineEl.className = cls;
        if (statusEl.textContent !== lines[i].text) statusEl.textContent = lines[i].text;
      }
      refs.paneList.style.display = lines.length > 0 ? "" : "none";

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

    // Header row: title + shortcut + close
    const header = document.createElement("div");
    header.className = "tab-header";

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

    header.appendChild(title);
    header.appendChild(hint);
    header.appendChild(close);

    // Branch badge — shows git branch name with status color
    const branchBadge = document.createElement("div");
    branchBadge.className = "tab-branch-badge";
    branchBadge.style.display = "none";

    // Pane status list
    const paneList = document.createElement("div");
    paneList.className = "tab-pane-list";
    paneList.style.display = "none";

    entry.appendChild(header);
    entry.appendChild(branchBadge);
    entry.appendChild(paneList);

    entry.addEventListener("click", () => this.actions.switchToTab(id));
    title.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.actions.renameTab(id);
    });
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
    this.tabChildRefs.set(id, { header, title, hint, branchBadge, paneList });
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
      if (state.gitBranch) {
        const gs = state.gitStatus;
        let text = state.gitBranch;
        if (gs) {
          const changes = gs.modified + gs.staged + gs.untracked;
          if (changes > 0) text += ` \u00b7${changes}`;
          if (gs.ahead > 0) text += ` \u2191${gs.ahead}`;
          if (gs.behind > 0) text += ` \u2193${gs.behind}`;
        }
        gitEl.textContent = text;
        // Color based on status
        if (gs && gs.staged > 0) {
          gitEl.className = "branch-icon status-git-staged";
        } else if (gs && (gs.modified > 0 || gs.untracked > 0)) {
          gitEl.className = "branch-icon status-git-modified";
        } else {
          gitEl.className = "branch-icon status-git-clean";
        }
      } else {
        gitEl.textContent = "";
        gitEl.className = "";
      }
    }

    // --- Context-adaptive fields ---
    const isAgent = !!state.agentName;
    const isServer = state.activity === "server-running" && !!state.serverPort;
    const hasError = state.activity === "error";

    if (isAgent) {
      // Agent mode: show agent name + status, elapsed time, current action
      const agentClass = state.activity === "agent-waiting" ? "status-waiting" : "status-active";
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
      // Include per-pane status in snapshot for change detection.
      // Use stable values only — exclude elapsed time (which changes every
      // second) to prevent false-positive snapshot diffs that trigger
      // unnecessary re-renders. The elapsed timer in updateStatusBar()
      // handles the 1-second display updates independently.
      const paneSnap = tab
        .getPaneStates()
        .map(
          (ps) =>
            `${ps.activity}:${ps.agentName}:${ps.serverPort}:${ps.processName}:${ps.folderName}:${ps.lastError}:${ps.agentStartedAt ?? ""}:${ps.waitingType}:${ps.actionCount}:${ps.agentJustStarted}:${ps.gitBranch}:${ps.lastAction ?? ""}`,
        )
        .join(",");
      const gs = s.gitStatus;
      const gitSnap = gs
        ? `${gs.modified}:${gs.staged}:${gs.untracked}:${gs.ahead}:${gs.behind}:${gs.is_worktree}`
        : "";
      parts.push(
        `${id}|${tab.title}|${s.activity}|${s.needsAttention}|${s.serverPort}|${s.agentName}|${s.lastError}|${s.gitBranch}|${gitSnap}|${s.folderName}|${s.notification}|${s.lastAction ?? ""}|${paneSnap}`,
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
