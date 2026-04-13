import type { Tab } from "./tab";
import type { TabState } from "./tab-state";
import { logger } from "./logger";

interface ChildRefs {
  header: HTMLElement;
  title: HTMLElement;
  hint: HTMLElement;
  detail: HTMLElement;
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
 * Manages the sidebar tab list DOM.
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
    _expandActiveTab = false,
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
      this.renderTabEntry(list, id, tab, activeTabId, index, index);
      index++;
    }
  }

  private renderTabEntry(
    list: HTMLElement,
    id: string,
    tab: Tab,
    activeTabId: string | null,
    domIndex: number,
    _tabIndex: number,
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
    if (tab.pinned) cls += " pinned";
    if (tab.muted) cls += " muted";
    entry.className = cls;
    entry.setAttribute("aria-selected", id === activeTabId ? "true" : "false");

    // Title
    refs.title.textContent = tab.title;
    refs.title.className = "tab-title";

    // Detail: branch name
    const primary = tab.getPaneStates()[0];
    refs.detail.textContent = primary?.gitBranch ?? "";
    refs.detail.className = "tab-detail";
    refs.detail.style.display = primary?.gitBranch ? "" : "none";

    refs.hint.textContent = "";
    refs.hint.style.display = "none";

    // Ensure correct order in DOM
    const refChild = domIndex < list.children.length ? list.children[domIndex] : null;
    if (entry !== refChild) {
      list.insertBefore(entry, refChild);
    }
  }

  private createTabEntry(id: string, list: HTMLElement): HTMLElement {
    const entry = document.createElement("div");
    entry.setAttribute("data-id", id);
    entry.setAttribute("role", "tab");

    // Header row: title + close
    const header = document.createElement("div");
    header.className = "tab-header";

    const title = document.createElement("span");
    title.className = "tab-title";

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

    header.appendChild(title);
    header.appendChild(hint);
    header.appendChild(close);

    // Detail line — branch name
    const detail = document.createElement("div");
    detail.className = "tab-detail";
    detail.style.display = "none";

    entry.appendChild(header);
    entry.appendChild(detail);

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
    this.tabChildRefs.set(id, { header, title, hint, detail });
    list.appendChild(entry);

    return entry;
  }

  /** Status bar removed — replaced by per-pane footers (#348). */
  updateStatusBar(_state: TabState | null) {}

  /** Build a snapshot string for change detection. */
  computeTabSnapshot(tabs: Map<string, Tab>, activeTabId: string | null): string {
    const parts: string[] = [];
    for (const [id, tab] of tabs) {
      const s = tab.state;
      const gs = s.gitStatus;
      const gitSnap = gs
        ? `${gs.modified}:${gs.staged}:${gs.untracked}:${gs.ahead}:${gs.behind}:${gs.is_worktree}`
        : "";
      parts.push(
        `${id}|${tab.title}|${s.needsAttention}|${s.serverPort}|${s.lastError}|${s.gitBranch}|${gitSnap}|${s.folderName}|${s.notification}|${tab.pinned}|${tab.muted}`,
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
