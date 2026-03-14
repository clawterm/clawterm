import "@xterm/xterm/css/xterm.css";
import "./style.css";
import { TerminalManager } from "./terminal-manager";
import { startUpdateChecker } from "./updater";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

const manager = new TerminalManager();
manager.init();

// On Cmd+Q / window close: clear session state so the app starts fresh.
// This is the escape hatch when tabs get into a broken state.
getCurrentWindow().onCloseRequested(async () => {
  await invoke("clear_session").catch(() => {
    // Best-effort during shutdown — no UI to show errors
  });
  manager.dispose();
});

// Check for updates on launch and periodically
startUpdateChecker();
