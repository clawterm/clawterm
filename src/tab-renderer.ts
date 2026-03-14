import type { Tab } from "./tab";
import { ACTIVITY_ICONS, computePaneStatusLine, computeSubtitle, type TabState } from "./tab-state";
import { AGENT_COLORS } from "./matchers";
import { modLabel } from "./utils";

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
  indicator: HTMLElement;
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

/** Activity CSS class for pane dots */
const PANE_DOT_CLASS: Record<string, string> = {
  idle: "pane-idle",
  running: "pane-running",
  "agent-waiting": "pane-agent-waiting",
  "server-running": "pane-server",
  error: "pane-error",
  completed: "pane-running",
};

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
        el.remove();
        this.tabElements.delete(id);
        this.tabChildRefs.delete(id);
      }
    }

    let index = 0;
    for (const [id, tab] of tabs) {
      let entry = this.tabElements.get(id);

      if (!entry) {
        entry = this.createTabEntry(id, list);
      }

      const refs = this.tabChildRefs.get(id)!;

      // Update classes
      let cls = "tab-entry";
      if (id === activeTabId) cls += " active";
      if (tab.state.needsAttention) cls += " needs-attention";
      if (tab.state.activity === "agent-waiting") cls += " agent-waiting";
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

      // Update agent color indicator — show most relevant agent color
      const agentColor = tab.state.agentName ? (AGENT_COLORS[tab.state.agentName] ?? null) : null;
      if (agentColor) {
        refs.indicator.style.background = agentColor;
        refs.indicator.style.display = "";
      } else {
        refs.indicator.style.display = "none";
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

      // Update per-pane status lines
      const paneStates = tab.getPaneStates();
      const lines: { text: string; activity: string }[] = [];
      for (const ps of paneStates) {
        const text = computePaneStatusLine(ps);
        if (text) lines.push({ text, activity: ps.activity });
      }

      // Rebuild pane list only if content changed
      const paneKey = lines.map((l) => `${l.activity}:${l.text}`).join("|");
      if (refs.paneList.getAttribute("data-key") !== paneKey) {
        refs.paneList.setAttribute("data-key", paneKey);
        refs.paneList.innerHTML = "";
        for (const line of lines) {
          const lineEl = document.createElement("div");
          lineEl.className = `tab-pane-line ${line.activity === "agent-waiting" ? "pane-line-waiting" : line.activity === "error" ? "pane-line-error" : ""}`;

          const dot = document.createElement("span");
          dot.className = `tab-pane-dot ${PANE_DOT_CLASS[line.activity] ?? "pane-idle"}`;

          const status = document.createElement("span");
          status.className = "tab-pane-status";
          status.textContent = line.text;

          lineEl.appendChild(dot);
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

    const indicator = document.createElement("span");
    indicator.className = "tab-agent-indicator";
    indicator.style.display = "none";

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

    entry.appendChild(indicator);
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
    this.tabChildRefs.set(id, { indicator, header, icon, title, hint, paneList });
    list.appendChild(entry);

    return entry;
  }

  /** Update the status bar with the active tab's state. */
  updateStatusBar(state: TabState | null) {
    const cwdEl = document.getElementById("status-cwd");
    const gitEl = document.getElementById("status-git");
    const processEl = document.getElementById("status-process");
    const serverEl = document.getElementById("status-server");
    const agentEl = document.getElementById("status-agent");

    if (!state) return;

    if (cwdEl) cwdEl.textContent = state.folderName;
    if (gitEl) {
      gitEl.textContent = state.gitBranch ? `\u2387 ${state.gitBranch}` : "";
    }
    if (processEl) {
      processEl.textContent = state.isIdle ? "" : state.processName;
    }
    if (serverEl) {
      serverEl.textContent = state.serverPort ? `:${state.serverPort}` : "";
      serverEl.className = state.serverPort ? "status-active" : "";
    }
    if (agentEl) {
      if (state.activity === "agent-waiting") {
        agentEl.textContent = `${state.agentName ?? "agent"} — waiting`;
        agentEl.className = "status-waiting";
      } else if (state.agentName) {
        agentEl.textContent = state.agentName;
        agentEl.className = "status-active";
      } else if (state.lastError) {
        agentEl.textContent = state.lastError;
        agentEl.className = "status-error";
      } else {
        agentEl.textContent = "";
        agentEl.className = "";
      }
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
        .map((ps) => `${ps.activity}:${ps.agentName}:${ps.serverPort}:${ps.processName}:${ps.folderName}:${ps.lastError}:${ps.agentStartedAt ? Math.floor((Date.now() - ps.agentStartedAt) / 1000) : ""}`)
        .join(",");
      parts.push(
        `${id}|${tab.title}|${subtitle}|${s.activity}|${s.needsAttention}|${s.serverPort}|${s.agentName}|${s.lastError}|${s.gitBranch}|${s.folderName}|${paneSnap}`,
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
