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

export async function loadSession(): Promise<Session | null> {
  try {
    const text = await invoke<string>("read_session");
    if (!text) return null;
    const data = JSON.parse(text);
    if (!Array.isArray(data.tabs) || data.tabs.length === 0) return null;

    // Validate each tab has a cwd string; discard malformed entries
    const validTabs = data.tabs
      .filter((t: unknown) => t && typeof t === "object" && typeof (t as SessionTab).cwd === "string")
      .map((t: SessionTab) => {
        // Strip invalid splits so they don't crash restoreNode
        if (t.splits && !isValidSplitNode(t.splits)) {
          logger.debug("Discarding invalid split layout from session");
          return { ...t, splits: undefined };
        }
        return t;
      });
    if (validTabs.length === 0) return null;

    const activeIndex =
      typeof data.activeIndex === "number"
        ? Math.max(0, Math.min(data.activeIndex, validTabs.length - 1))
        : 0;

    return { tabs: validTabs, activeIndex };
  } catch (e) {
    logger.debug("Failed to load session:", e);
    return null;
  }
}

export async function saveSession(tabs: SessionTab[], activeIndex: number): Promise<void> {
  try {
    const session: Session = { tabs, activeIndex };
    await invoke("write_session", { contents: JSON.stringify(session) });
  } catch (e) {
    logger.debug("Failed to save session:", e);
  }
}
