import { invoke } from "@tauri-apps/api/core";
import { logger } from "./logger";

export interface SessionTab {
  title: string | null;
  cwd: string;
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
    return data as Session;
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
