import type { Tab } from "./tab";
import type { TabState, GitStatusInfo } from "./tab-state";

export interface WorkspaceEntry {
  tabId: string;
  branch: string | null;
  gitStatus: GitStatusInfo | null;
  agentName: string | null;
  activity: string;
  lastAction: string | null;
  isWorktree: boolean;
}

interface PanelCallbacks {
  switchToTab(id: string): void;
  openWorktreeDialog(): void;
}

/**
 * Workspace Overview Panel — shows all active worktrees with agent state.
 * Toggleable sidebar panel separate from the tab list.
 */
export class WorkspacePanel {
  private el: HTMLDivElement;
  private listEl: HTMLDivElement;
  private visible = false;
  private callbacks: PanelCallbacks;

  constructor(callbacks: PanelCallbacks) {
    this.callbacks = callbacks;

    this.el = document.createElement("div");
    this.el.className = "workspace-panel";
    this.el.style.display = "none";

    const header = document.createElement("div");
    header.className = "workspace-panel-header";

    const title = document.createElement("span");
    title.className = "workspace-panel-title";
    title.textContent = "Workspace";

    const addBtn = document.createElement("button");
    addBtn.className = "workspace-panel-add";
    addBtn.textContent = "+";
    addBtn.title = "New Agent Tab";
    addBtn.addEventListener("click", () => callbacks.openWorktreeDialog());

    header.appendChild(title);
    header.appendChild(addBtn);

    this.listEl = document.createElement("div");
    this.listEl.className = "workspace-panel-list";

    this.el.appendChild(header);
    this.el.appendChild(this.listEl);
  }

  get element(): HTMLDivElement {
    return this.el;
  }

  toggle() {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? "" : "none";
  }

  isVisible(): boolean {
    return this.visible;
  }

  update(tabs: Map<string, Tab>, activeTabId: string | null) {
    if (!this.visible) return;

    const entries: WorkspaceEntry[] = [];
    for (const [id, tab] of tabs) {
      const state: TabState = tab.state;
      entries.push({
        tabId: id,
        branch: state.gitBranch,
        gitStatus: state.gitStatus,
        agentName: state.agentName,
        activity: state.activity,
        lastAction: state.lastAction,
        isWorktree: state.gitStatus?.is_worktree ?? false,
      });
    }

    // Build a content key to skip unnecessary DOM updates
    const key = entries
      .map(
        (e) =>
          `${e.tabId}:${e.branch}:${e.activity}:${e.agentName}:${e.gitStatus?.modified ?? 0}:${e.lastAction ?? ""}`,
      )
      .join("|");

    if (this.listEl.getAttribute("data-key") === key) return;
    this.listEl.setAttribute("data-key", key);
    this.listEl.innerHTML = "";

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "workspace-panel-empty";
      empty.textContent = "No tabs open";
      this.listEl.appendChild(empty);
      return;
    }

    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "workspace-entry";
      if (entry.tabId === activeTabId) row.classList.add("active");

      // Branch line
      const branchLine = document.createElement("div");
      branchLine.className = "workspace-entry-branch";
      const dot = document.createElement("span");
      dot.className = "workspace-dot";
      if (entry.gitStatus) {
        if (entry.gitStatus.staged > 0) dot.classList.add("dot-staged");
        else if (entry.gitStatus.modified > 0 || entry.gitStatus.untracked > 0)
          dot.classList.add("dot-modified");
        else dot.classList.add("dot-clean");
      }
      branchLine.appendChild(dot);

      const branchName = document.createElement("span");
      branchName.className = "workspace-entry-name";
      branchName.textContent = entry.branch || "no branch";
      if (entry.isWorktree) branchName.classList.add("is-worktree");
      branchLine.appendChild(branchName);

      row.appendChild(branchLine);

      // Status line
      if (entry.gitStatus) {
        const statusLine = document.createElement("div");
        statusLine.className = "workspace-entry-status";
        const changes = entry.gitStatus.modified + entry.gitStatus.staged + entry.gitStatus.untracked;
        const parts: string[] = [];
        if (changes > 0) parts.push(`${changes} changes`);
        else parts.push("clean");
        if (entry.gitStatus.ahead > 0) parts.push(`${entry.gitStatus.ahead} ahead`);
        statusLine.textContent = parts.join(" \u00b7 ");
        row.appendChild(statusLine);
      }

      // Agent line
      if (entry.agentName) {
        const agentLine = document.createElement("div");
        agentLine.className = "workspace-entry-agent";
        const activityLabel =
          entry.activity === "agent-waiting"
            ? "waiting"
            : entry.activity === "running"
              ? "working"
              : entry.activity;
        agentLine.textContent = `${entry.agentName} (${activityLabel})`;
        row.appendChild(agentLine);

        if (entry.lastAction) {
          const actionLine = document.createElement("div");
          actionLine.className = "workspace-entry-action";
          actionLine.textContent = entry.lastAction;
          row.appendChild(actionLine);
        }
      }

      row.addEventListener("click", () => this.callbacks.switchToTab(entry.tabId));
      this.listEl.appendChild(row);
    }
  }
}
