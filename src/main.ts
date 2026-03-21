import "@xterm/xterm/css/xterm.css";
import "./style.css";
import { TerminalManager } from "./terminal-manager";
import { startUpdateChecker } from "./updater";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

// Clean up stale PTY sessions from previous hot reloads (dev mode)
invoke("plugin:pty|clear_sessions").catch((e) => console.debug("clear_sessions:", e));

const manager = new TerminalManager();
manager.init().then(() => {
  // Check for updates after config is loaded
  startUpdateChecker(manager.config);
});

// On Cmd+Q / window close: flush session to disk so it can be restored on
// next launch.  The debounced save may not have fired yet, so we save now.
getCurrentWindow().onCloseRequested(async () => {
  await manager.flushSession().catch(() => {
    // Best-effort during shutdown — no UI to show errors
  });
  manager.dispose();
});

// Pause CSS animations when window is hidden to save battery
document.addEventListener("visibilitychange", () => {
  document.documentElement.classList.toggle("window-hidden", document.hidden);
});
