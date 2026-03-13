import { invoke } from "@tauri-apps/api/core";
import { logger } from "./logger";

export interface SessionSplitLeaf {
  type: "leaf";
  cwd: string;
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
}

export interface Session {
  tabs: SessionTab[];
  activeIndex: number;
}

export async function loadSession(): Promise<Session | null> {
  try {
    const text = await invoke<string>("read_session");
    if (!text) return null;
    const data = JSON.parse(text);
    if (!Array.isArray(data.tabs) || data.tabs.length === 0) return null;

    // Validate each tab has a cwd string; discard malformed entries
    const validTabs = data.tabs.filter(
      (t: unknown) => t && typeof t === "object" && typeof (t as SessionTab).cwd === "string",
    );
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
    await invoke("write_session", { contents: JSON.stringify(session, null, 2) });
  } catch (e) {
    logger.debug("Failed to save session:", e);
  }
}
