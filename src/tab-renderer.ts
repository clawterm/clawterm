import type { Tab } from "./tab";
import {
  computePaneStatusParts,
  formatElapsed,
  ACTIVITY_ICONS,
  type PaneStatusParts,
  type TabState,
} from "./tab-state";
import { logger } from "./logger";

interface ChildRefs {
  header: HTMLElement;
  stateIcon: HTMLElement;
  title: HTMLElement;
  elapsed: HTMLElement;
  hint: HTMLElement;
  detail: HTMLElement;
  context: HTMLElement;
  expandedDetail: HTMLElement;
  paneList: HTMLElement;
}

export interface TabRenderActions {
  closeTab(id: string): void;
  switchToTab(id: string): void;
  showTabContextMenu(e: MouseEvent, id: string): void;
  reorderTab(dragId: string, targetId: string, insertBefore: boolean): void;
  renameTab(id: string): void;
  splitTab?(id: string): void;
  killProcess?(id: string): void;
  muteTab?(id: string): void;
}

/**
 * Manages the sidebar tab list DOM and status bar updates.
 * Linear-inspired layout: agent name is the hero when active (#331).
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
  renderTabList(
    list: HTMLElement,
    tabs: Map<string, Tab>,
    activeTabId: string | null,
    _groupByState = true,
    expandActiveTab = false,
  ) {
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
      this.renderTabEntry(list, id, tab, activeTabId, index, index, expandActiveTab);
      index++;
    }
  }

  private renderTabEntry(
    list: HTMLElement,
    id: string,
    tab: Tab,
    activeTabId: string | null,
    domIndex: number,
    tabIndex: number,
    expandActiveTab = false,
  ) {
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

    // Determine layout mode: agent-first vs folder-first (#331)
    const paneStates = tab.getPaneStates();
    const isSinglePane = paneStates.length <= 1;
    const primary = paneStates[0];
    const hasAgent =
      !!primary?.agentName && (primary.activity === "running" || primary.activity === "agent-waiting");
    const hasServer = primary?.activity === "server-running" && !!primary.serverPort;

    // Icons only show in pane status lines, not in the tab header (#368)
    refs.stateIcon.style.display = "none";

    if (isSinglePane && hasAgent) {
      // --- Agent-first layout ---
      // Header: agent name + elapsed + close

      refs.title.textContent = tab.title;
      refs.title.className = "tab-title tab-title-agent";

      if (primary.agentStartedAt) {
        refs.elapsed.textContent = formatElapsed(primary.agentStartedAt);
        refs.elapsed.style.display = "";
      } else {
        refs.elapsed.style.display = "none";
      }
      refs.hint.style.display = "none";

      // Detail: current action
      const action =
        primary.activity === "agent-waiting"
          ? primary.waitingType === "user"
            ? "waiting for input"
            : "waiting"
          : (primary.lastAction ?? "working...");
      refs.detail.textContent = action;
      refs.detail.className =
        primary.activity === "agent-waiting" ? "tab-detail tab-detail-waiting" : "tab-detail";
      refs.detail.style.display = "";

      // Context: folder + branch
      const branch = primary.gitBranch;
      const contextParts: string[] = [tab.title];
      if (branch) contextParts.push(branch);
      refs.context.textContent = contextParts.join(" \u00b7 ");
      refs.context.style.display = "";

      // Expanded detail — recent actions + git status (#342)
      if (expandActiveTab && id === activeTabId && primary.recentActions.length > 0) {
        refs.expandedDetail.textContent = "";
        refs.expandedDetail.style.display = "";
        // Recent actions (skip the first — it's already shown in detail line)
        const recent = primary.recentActions.slice(1, 4);
        if (recent.length > 0) {
          const recentHeader = document.createElement("div");
          recentHeader.className = "expanded-label";
          recentHeader.textContent = "Recent:";
          refs.expandedDetail.appendChild(recentHeader);
          for (const a of recent) {
            const line = document.createElement("div");
            line.className = "expanded-action";
            line.textContent = `\u00b7 ${a}`;
            refs.expandedDetail.appendChild(line);
          }
        }
      } else {
        refs.expandedDetail.style.display = "none";
      }

      // Hide pane list (info is in header/detail/context)
      refs.paneList.style.display = "none";
    } else if (isSinglePane && hasServer) {
      // --- Server layout ---
      refs.title.textContent = tab.title;
      refs.title.className = "tab-title";
      refs.elapsed.style.display = "none";
      this.updateHint(refs, tabIndex);

      refs.detail.textContent = `:${primary.serverPort}`;
      refs.detail.className = "tab-detail tab-detail-server";
      refs.detail.style.display = "";

      refs.context.textContent = primary.gitBranch ?? "";
      refs.context.style.display = primary.gitBranch ? "" : "none";

      refs.expandedDetail.style.display = "none";
      refs.paneList.style.display = "none";
    } else if (isSinglePane && primary?.activity === "error") {
      // --- Error layout ---
      refs.title.textContent = tab.title;
      refs.title.className = "tab-title";
      refs.elapsed.style.display = "none";
      this.updateHint(refs, tabIndex);

      refs.detail.textContent = primary.lastError ?? "error";
      refs.detail.className = "tab-detail tab-detail-error";
      refs.detail.style.display = "";

      refs.context.style.display = "none";
      refs.expandedDetail.style.display = "none";
      refs.paneList.style.display = "none";
    } else if (isSinglePane && primary?.activity === "completed" && primary.agentName) {
      // --- Completed agent layout ---
      refs.title.textContent = tab.title;
      refs.title.className = "tab-title tab-title-completed";

      if (primary.agentStartedAt) {
        refs.elapsed.textContent = formatElapsed(primary.agentStartedAt);
        refs.elapsed.style.display = "";
      } else {
        refs.elapsed.style.display = "none";
      }
      refs.hint.style.display = "none";

      refs.detail.textContent = "completed";
      refs.detail.className = "tab-detail tab-detail-completed";
      refs.detail.style.display = "";

      refs.context.textContent = tab.title + (primary.gitBranch ? ` \u00b7 ${primary.gitBranch}` : "");
      refs.context.style.display = "";
      refs.expandedDetail.style.display = "none";
      refs.paneList.style.display = "none";
    } else if (isSinglePane) {
      // --- Idle shell layout ---
      refs.title.textContent = tab.title;
      refs.title.className = "tab-title";
      refs.elapsed.style.display = "none";
      this.updateHint(refs, tabIndex);

      refs.detail.textContent = primary?.gitBranch ?? "";
      refs.detail.className = "tab-detail";
      refs.detail.style.display = primary?.gitBranch ? "" : "none";

      refs.context.style.display = "none";
      refs.expandedDetail.style.display = "none";
      refs.paneList.style.display = "none";
    } else {
      // --- Multi-pane layout: folder header + per-pane status lines ---
      refs.title.textContent = tab.title;
      refs.title.className = "tab-title";
      refs.elapsed.style.display = "none";
      this.updateHint(refs, tabIndex);
      refs.detail.style.display = "none";
      refs.context.style.display = "none";
      refs.expandedDetail.style.display = "none";

      // Render per-pane status lines (existing behavior)
      const paneBranches = new Set(paneStates.map((ps) => ps.gitBranch).filter(Boolean));
      const showBranch = paneBranches.size > 1;
      const parts: PaneStatusParts[] = paneStates.map((ps) => computePaneStatusParts(ps, showBranch));

      while (refs.paneList.children.length > parts.length) {
        refs.paneList.lastChild!.remove();
      }
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        let lineEl = refs.paneList.children[i] as HTMLDivElement | undefined;
        if (!lineEl) {
          lineEl = document.createElement("div");
          refs.paneList.appendChild(lineEl);
        }
        const cls2 = `tab-pane-line pane-${p.activity}`;
        if (lineEl.className !== cls2) lineEl.className = cls2;
        this.renderPaneStatusParts(lineEl, p);
      }
      refs.paneList.style.display = parts.length > 0 ? "" : "none";
    }

    // Ensure correct order in DOM — guard index to avoid out-of-bounds access
    // during rapid re-renders where list.children may have shifted.
    const refChild = domIndex < list.children.length ? list.children[domIndex] : null;
    if (entry !== refChild) {
      list.insertBefore(entry, refChild);
    }
  }

  private updateHint(refs: ChildRefs, _tabIndex: number) {
    refs.hint.textContent = "";
    refs.hint.style.display = "none";
  }

  private createTabEntry(id: string, list: HTMLElement): HTMLElement {
    const entry = document.createElement("div");
    entry.setAttribute("data-id", id);
    entry.setAttribute("role", "tab");

    // Header row: icon + title + elapsed/shortcut + close
    const header = document.createElement("div");
    header.className = "tab-header";

    const stateIcon = document.createElement("span");
    stateIcon.className = "tab-state-icon";
    stateIcon.setAttribute("role", "img");
    stateIcon.style.display = "none";

    const title = document.createElement("span");
    title.className = "tab-title";

    const elapsed = document.createElement("span");
    elapsed.className = "tab-elapsed";
    elapsed.style.display = "none";

    const hint = document.createElement("span");
    hint.className = "tab-shortcut";
    hint.style.display = "none";

    const close = document.createElement("button");
    close.className = "tab-close";
    close.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2L8 8M8 2L2 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      this.actions.closeTab(id);
    });

    header.appendChild(stateIcon);
    header.appendChild(title);
    header.appendChild(elapsed);
    header.appendChild(hint);
    header.appendChild(close);

    // Detail line — action text or branch
    const detail = document.createElement("div");
    detail.className = "tab-detail";
    detail.style.display = "none";

    // Context line — folder + branch (tertiary)
    const context = document.createElement("div");
    context.className = "tab-context";
    context.style.display = "none";

    // Expanded detail — recent actions, shown in focus mode (#342)
    const expandedDetail = document.createElement("div");
    expandedDetail.className = "tab-expanded-detail";
    expandedDetail.style.display = "none";

    // Pane status list (multi-pane only)
    const paneList = document.createElement("div");
    paneList.className = "tab-pane-list";
    paneList.style.display = "none";

    entry.appendChild(header);
    entry.appendChild(detail);
    entry.appendChild(context);
    entry.appendChild(expandedDetail);
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
    this.tabChildRefs.set(id, {
      header,
      stateIcon,
      title,
      elapsed,
      hint,
      detail,
      context,
      expandedDetail,
      paneList,
    });
    list.appendChild(entry);

    return entry;
  }

  /** Render structured pane status into a line element (#350).
   *  Creates separate spans for agent name, action, and elapsed time
   *  so each can be styled independently. */
  private renderPaneStatusParts(lineEl: HTMLDivElement, p: PaneStatusParts) {
    // Structural cache key — excludes elapsed time which changes every second.
    // When only elapsed changes, we update the meta span directly without
    // destroying the DOM tree (which would reset SVG animateMotion animations).
    let structKey = `[${p.activity}]`;
    if (p.prefix) structKey += `${p.prefix} `;
    if (p.agent) {
      structKey += p.agent;
      if (p.action) structKey += `: ${p.action}`;
    } else if (p.fallback) {
      structKey += p.fallback;
    }
    if (p.actionCount > 0) structKey += ` #${p.actionCount}`;

    const needsRebuild = lineEl.getAttribute("data-status") !== structKey;

    if (!needsRebuild) {
      // Structure unchanged — fast-path: update only elapsed time in meta span
      const metaEl = lineEl.querySelector(".pane-status-meta") as HTMLSpanElement | null;
      if (p.actionCount > 0 || p.elapsed) {
        const parts: string[] = [];
        if (p.actionCount > 0) parts.push(String(p.actionCount));
        if (p.elapsed) parts.push(p.elapsed);
        const metaText = parts.join(" \u00b7 ");
        if (metaEl) {
          metaEl.textContent = metaText;
        }
      } else if (metaEl) {
        metaEl.textContent = "";
      }
      return;
    }

    lineEl.setAttribute("data-status", structKey);

    // Clear and rebuild
    lineEl.textContent = "";

    // State icon (#347)
    const iconInfo = ACTIVITY_ICONS[p.activity];
    const iconEl = document.createElement("span");
    iconEl.className = `pane-status-icon ${iconInfo.cssClass}`;
    iconEl.innerHTML = iconInfo.svg;
    iconEl.setAttribute("role", "img");
    iconEl.setAttribute("aria-label", iconInfo.label);
    lineEl.appendChild(iconEl);

    if (p.prefix) {
      const prefixEl = document.createElement("span");
      prefixEl.className = "pane-status-prefix";
      prefixEl.textContent = p.prefix + " ";
      lineEl.appendChild(prefixEl);
    }

    if (p.agent) {
      const agentEl = document.createElement("span");
      agentEl.className = "pane-status-agent";
      agentEl.textContent = p.agent;
      lineEl.appendChild(agentEl);

      if (p.action) {
        const sep = document.createElement("span");
        sep.className = "pane-status-sep";
        sep.textContent = ": ";
        lineEl.appendChild(sep);

        const actionEl = document.createElement("span");
        actionEl.className = "pane-status-action";
        actionEl.textContent = p.action;
        lineEl.appendChild(actionEl);
      }

      if (p.actionCount > 0 || p.elapsed) {
        const metaEl = document.createElement("span");
        metaEl.className = "pane-status-meta";
        const parts: string[] = [];
        if (p.actionCount > 0) parts.push(String(p.actionCount));
        if (p.elapsed) parts.push(p.elapsed);
        metaEl.textContent = parts.join(" \u00b7 ");
        lineEl.appendChild(metaEl);
      }
    } else if (p.fallback) {
      const fallbackEl = document.createElement("span");
      fallbackEl.className = "pane-status-fallback";
      fallbackEl.textContent = p.fallback;
      lineEl.appendChild(fallbackEl);
    }
  }

  /** Status bar removed — replaced by per-pane footers (#348). */
  updateStatusBar(_state: TabState | null) {}

  /** Build a snapshot string for change detection. */
  computeTabSnapshot(tabs: Map<string, Tab>, activeTabId: string | null): string {
    const parts: string[] = [];
    for (const [id, tab] of tabs) {
      const s = tab.state;
      const paneSnap = tab
        .getPaneStates()
        .map(
          (ps) =>
            `${ps.activity}:${ps.agentName}:${ps.serverPort}:${ps.processName}:${ps.folderName}:${ps.lastError}:${ps.agentStartedAt ?? ""}:${ps.waitingType}:${ps.actionCount}:${ps.agentJustStarted}:${ps.gitBranch}:${ps.lastAction ?? ""}:${ps.recentActions.length}`,
        )
        .join(",");
      const gs = s.gitStatus;
      const gitSnap = gs
        ? `${gs.modified}:${gs.staged}:${gs.untracked}:${gs.ahead}:${gs.behind}:${gs.is_worktree}`
        : "";
      parts.push(
        `${id}|${tab.title}|${s.activity}|${s.needsAttention}|${s.serverPort}|${s.agentName}|${s.lastError}|${s.gitBranch}|${gitSnap}|${s.folderName}|${s.notification}|${s.lastAction ?? ""}|${tab.pinned}|${tab.muted}|${paneSnap}`,
      );
    }
    parts.push(`active:${activeTabId}`);
    return parts.join(";");
  }

  /** Clean up all cached elements. */
  clear() {
    this.tabElements.clear();
    this.tabChildRefs.clear();
  }
}
