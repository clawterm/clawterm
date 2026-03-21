# Architecture

## Overview

Clawterm is a [Tauri v2](https://v2.tauri.app/) app: a Rust backend manages PTY processes and OS integration, a TypeScript frontend renders terminals using [xterm.js](https://xtermjs.org/) and manages the tab/pane UI.

## Data flow

```
PTY (Rust) → binary stream → Pane (xterm.js terminal) → OutputAnalyzer
                                                          ↓
                                                     OutputEvent
                                                          ↓
                                                     Tab.handleOutputEvent()
                                                          ↓
                                                     PaneState update
                                                          ↓
                                                     TabRenderer (sidebar)
```

## Polling loop

`TerminalManager` runs a polling interval that calls `Tab.pollProcessInfo()` for each tab. Each poll cycle:

1. Gets foreground PID via PTY plugin (`tcgetpgrp` on macOS, process tree on Windows)
2. Walks process tree to find deepest child (Rust IPC)
3. Checks if process matches known agents (`AGENT_PROCESS_MAP`)
4. Computes adaptive idle timeout based on output cadence
5. Updates `PaneState` (idle, running, agent-waiting, etc.)
6. Derives tab-level state from the focused pane
7. Re-renders the sidebar

## Frontend (`src/`)

| File | Responsibility |
|------|---------------|
| `main.ts` | Entry point, creates `TerminalManager` |
| `terminal-manager.ts` | Orchestrates tabs, panes, polling, keyboard commands, session persistence |
| `tab.ts` | Tab state machine, split pane tree, process polling, output event handling |
| `pane.ts` | xterm.js terminal wrapper, PTY I/O, fit/resize, scroll management |
| `tab-state.ts` | Pure state types and computation functions (titles, subtitles, icons) |
| `tab-renderer.ts` | DOM rendering for sidebar tabs, status bar, pane status lines |
| `output-analyzer.ts` | Debounced regex engine that scans terminal output for events |
| `matchers.ts` | Pattern definitions for agents, servers, errors; agent process map |
| `config.ts` | User configuration loading/validation (`~/.config/clawterm/config.json`) |
| `keybinding-handler.ts` | Keyboard shortcut dispatch (platform-aware Cmd/Ctrl) |
| `utils.ts` | Platform detection (`isMac`, `isWindows`), IPC timeout helper |
| `style.css` | All UI styles — sidebar, tabs, panes, window controls |
| `search-bar.ts` | In-terminal find UI (xterm.js search addon) |
| `tab-switcher.ts` | Quick-switch overlay (Cmd+P) |
| `context-menu.ts` | Right-click menu for tabs and panes |
| `toast.ts` | Toast notification UI |
| `logger.ts` | Debug logging with module prefixes |
| `session.ts` | Session persistence types (save/restore tabs across restarts) |

## Backend (`src-tauri/src/`)

| File | Responsibility |
|------|---------------|
| `main.rs` | Tauri app setup, IPC commands (config read/write, shell validation, window events) |
| `process_info.rs` | Cross-platform process introspection — macOS (`proc_pidinfo`, `sysctl`), Windows (`CreateToolhelp32Snapshot`, `sysinfo`), Linux (`/proc`) |
| `server_check.rs` | TCP port reachability check for server detection |

## PTY Plugin (`src-tauri/plugins/tauri-plugin-pty/`)

Custom Tauri plugin wrapping `portable-pty` for PTY management. Uses `native_pty_system()` which maps to:
- macOS/Linux: Unix PTY (`openpty` + `fork`)
- Windows: ConPTY (`CreatePseudoConsole`)

**Exposed commands:** `spawn`, `write`, `resize`, `kill`, `foreground_pid`, `clear_sessions`

## Split pane model

Panes within a tab are stored as a recursive binary tree:

```
SplitNode = SplitBranch | SplitLeaf

SplitBranch {
  direction: "horizontal" | "vertical"
  children: [SplitNode, SplitNode]
  ratio: number  // 0..1 size of first child
}

SplitLeaf {
  pane: Pane
}
```

Each `Tab` has a `root: SplitNode` and a flat `panes: Pane[]` array for quick access. Closing a pane promotes its sibling to replace the parent branch.
