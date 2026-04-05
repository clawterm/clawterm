# Clawterm

[![CI](https://github.com/clawterm/clawterm/actions/workflows/ci.yml/badge.svg)](https://github.com/clawterm/clawterm/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/clawterm/clawterm)](https://github.com/clawterm/clawterm/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A terminal for running many AI agents at once and keeping track of them.

![Clawterm](docs/screenshots/clawterm.png)

Vertical tabs with live agent status, split panes, per-pane context tracking, desktop notifications, and auto-updates. Built with [Tauri 2](https://v2.tauri.app/) + [xterm.js](https://xtermjs.org/).

## Install

**macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/clawterm/clawterm/main/install.sh | bash
```

**Windows:**
```powershell
irm https://raw.githubusercontent.com/clawterm/clawterm/main/install.ps1 | iex
```

Or grab the DMG / EXE from the [latest release](https://github.com/clawterm/clawterm/releases/latest). Updates are automatic.

> **macOS note:** You may need `xattr -cr /Applications/Clawterm.app` to clear the quarantine flag until Apple notarization is set up.

## Highlights

- **Live tab status** — see which agents are idle, running, waiting for input, or errored without clicking through tabs
- **Desktop notifications** — get notified when agents need input or long commands finish
- **Split panes** — `Cmd+D` / `Cmd+Shift+D` to split horizontally or vertically
- **Command palette** — `Cmd+Shift+P` for quick access to all actions
- **Git worktrees** — run agents on isolated branches from a single project
- **Auto-updates** — built-in update checker with release notes and silent install option
- **Settings page** — shortcuts reference, version info, and update controls
- **Fully configurable** — config at `~/.config/clawterm/config.json`, all keybindings remappable

## Build from Source

```bash
git clone https://github.com/clawterm/clawterm.git && cd clawterm
npm install && npm run tauri dev
```

Requires [Rust](https://rustup.rs/) and [Node.js](https://nodejs.org/) 18+.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports: [open an issue](https://github.com/clawterm/clawterm/issues).

## License

[MIT](LICENSE)
