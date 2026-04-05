import { invoke } from "@tauri-apps/api/core";
import { logger } from "./logger";

export interface SessionSplitLeaf {
  type: "leaf";
  cwd: string;
  /** If this pane is in a git worktree, the worktree directory path */
  worktreePath?: string;
  /** The repo root this worktree belongs to */
  repoRoot?: string;
}

export interface SessionSplitBranch {
  type: "split";
  direction: "horizontal" | "vertical";
  ratio: number;
  children: [SessionSplitNode, SessionSplitNode];
}

export type SessionSplitNode = SessionSplitLeaf | SessionSplitBranch;

export interface SessionTab {
  title: string | null;
  cwd: string;
  /** Split tree layout — if undefined, single pane */
  splits?: SessionSplitNode;
  /** Whether the tab is pinned */
  pinned?: boolean;
  /** Whether the tab is muted */
  muted?: boolean;
  /** User-assigned tab title (overrides auto-derived title) */
  manualTitle?: string | null;
  /** If this tab is in a worktree, the worktree path */
  worktreePath?: string;
  /** The repo root this worktree belongs to */
  repoRoot?: string;
}

/** A project groups an independent set of tabs (#401) */
export interface SessionProject {
  name: string;
  tabs: SessionTab[];
  activeIndex: number;
}

/** V2 session format with projects support */
export interface SessionV2 {
  version: 2;
  projects: SessionProject[];
  activeProject: number;
}

/** V1 session format (legacy — single flat tab list) */
export interface Session {
  tabs: SessionTab[];
  activeIndex: number;
}

/** Recursively validate a split node. Returns true if the structure is valid. */
function isValidSplitNode(node: unknown): node is SessionSplitNode {
  if (!node || typeof node !== "object") return false;
  const n = node as Record<string, unknown>;
  if (n.type === "leaf") {
    return typeof n.cwd === "string";
  }
  if (n.type === "split") {
    return (
      (n.direction === "horizontal" || n.direction === "vertical") &&
      typeof n.ratio === "number" &&
      n.ratio > 0 &&
      n.ratio < 1 &&
      Array.isArray(n.children) &&
      n.children.length === 2 &&
      isValidSplitNode(n.children[0]) &&
      isValidSplitNode(n.children[1])
    );
  }
  return false;
}

function validateTabs(tabs: unknown[]): SessionTab[] {
  return tabs
    .filter((t: unknown) => t && typeof t === "object" && typeof (t as SessionTab).cwd === "string")
    .map((t) => {
      const tab = t as SessionTab;
      if (tab.splits && !isValidSplitNode(tab.splits)) {
        logger.debug("Discarding invalid split layout from session");
        return { ...tab, splits: undefined };
      }
      return tab;
    });
}

export async function loadSession(): Promise<SessionV2 | null> {
  try {
    const text = await invoke<string>("read_session");
    if (!text) return null;
    const data = JSON.parse(text);

    // V2 format: has projects array
    if (data.version === 2 && Array.isArray(data.projects)) {
      const projects: SessionProject[] = [];
      for (const p of data.projects) {
        if (!p || typeof p !== "object" || !Array.isArray(p.tabs)) continue;
        const validTabs = validateTabs(p.tabs);
        if (validTabs.length === 0) continue;
        const activeIndex =
          typeof p.activeIndex === "number" ? Math.max(0, Math.min(p.activeIndex, validTabs.length - 1)) : 0;
        projects.push({
          name: typeof p.name === "string" ? p.name : "Project",
          tabs: validTabs,
          activeIndex,
        });
      }
      if (projects.length === 0) return null;
      const activeProject =
        typeof data.activeProject === "number"
          ? Math.max(0, Math.min(data.activeProject, projects.length - 1))
          : 0;
      return { version: 2, projects, activeProject };
    }

    // V1 format: flat tabs array — wrap in a single project
    if (Array.isArray(data.tabs) && data.tabs.length > 0) {
      const validTabs = validateTabs(data.tabs);
      if (validTabs.length === 0) return null;
      const activeIndex =
        typeof data.activeIndex === "number"
          ? Math.max(0, Math.min(data.activeIndex, validTabs.length - 1))
          : 0;
      return {
        version: 2,
        projects: [{ name: "Project", tabs: validTabs, activeIndex }],
        activeProject: 0,
      };
    }

    return null;
  } catch (e) {
    logger.debug("Failed to load session:", e);
    return null;
  }
}

export async function saveSession(session: SessionV2): Promise<void> {
  try {
    await invoke("write_session", { contents: JSON.stringify(session) });
  } catch (e) {
    logger.debug("Failed to save session:", e);
  }
}
