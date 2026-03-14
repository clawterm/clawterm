# Clawterm

[![CI](https://github.com/Axelj00/clawterm/actions/workflows/ci.yml/badge.svg)](https://github.com/Axelj00/clawterm/actions/workflows/ci.yml)
[![Release](https://github.com/Axelj00/clawterm/releases/latest/badge.svg)](https://github.com/Axelj00/clawterm/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A terminal emulator built for running AI coding agents. Vertical tabs, split panes, fast PTY, native macOS feel.

<!-- TODO: Add screenshot/GIF here once available -->
<!-- ![Clawterm screenshot](docs/screenshot.png) -->

## About

Clawterm is a lightweight terminal emulator designed for AI-agent workflows. If you spend your day running Claude Code, Codex, or similar tools across multiple sessions, Clawterm gives you a clean vertical-tab interface to manage them all without the overhead of a full IDE terminal.

Built with [Tauri 2](https://v2.tauri.app/) and [xterm.js](https://xtermjs.org/). macOS only (Apple Silicon).

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/Axelj00/clawterm/main/install.sh | bash
```

Or download the `.dmg` from the [latest release](https://github.com/Axelj00/clawterm/releases/latest).

> **Note (macOS):** After installing from the DMG, you may need to run:
> ```bash
> xattr -cr /Applications/Clawterm.app
> ```
> This removes the quarantine flag that macOS applies to unsigned apps.

### Updates

Clawterm checks for updates automatically on launch. When a new version is available, you'll see a notification in the sidebar — click **Update** to download, install, and restart in one step.

You can also re-run the install script to update manually:

```bash
curl -fsSL https://raw.githubusercontent.com/Axelj00/clawterm/main/install.sh | bash
```

## Features

- **Vertical tab sidebar** — switch between sessions at a glance, drag to reorder, double-click to rename
- **Split panes** — split horizontally (`Cmd+D`) or vertically (`Cmd+Shift+D`) within any tab
- **Process intelligence** — sees what's running in each tab (idle, running, server, agent waiting)
- **Output analysis** — detects server starts, agent prompts, errors, and command completions
- **Desktop notifications** — get notified when a long command finishes or an agent needs input
- **Session persistence** — tabs and working directories are restored on relaunch
- **Command palette** — `Cmd+Shift+P` for quick access to all actions
- **Tab pinning & muting** — pin important tabs, mute noisy ones
- **JSON config** — fonts, colors, keybindings, sidebar position, all in one file
- **Natural text editing** — Cmd+Backspace, Cmd+Arrow, Alt+Arrow work like native macOS
- **Auto-updates** — in-app update notifications with one-click install
- **Fast** — Rust backend with a real PTY, WebGL-accelerated xterm.js renderer, no Electron

## Keyboard Shortcuts

| Action | Shortcut |
| --- | --- |
| New tab | `Cmd+T` |
| Close tab | `Cmd+W` |
| Next tab | `Cmd+Shift+]` |
| Previous tab | `Cmd+Shift+[` |
| Jump to tab 1–9 | `Cmd+1` – `Cmd+9` |
| Quick switch | `Cmd+P` |
| Command palette | `Cmd+Shift+P` |
| Split right | `Cmd+D` |
| Split down | `Cmd+Shift+D` |
| Close pane | `Cmd+Shift+W` |
| Next pane | `Cmd+]` |
| Previous pane | `Cmd+[` |
| Find | `Cmd+F` |
| Cycle attention tabs | `Cmd+Shift+A` |
| Clear terminal | `Cmd+K` |
| Reload config | `Cmd+Shift+R` |

All keybindings (except text-editing shortcuts) can be remapped in the config file.

## Configuration

Config lives at `~/.config/clawterm/config.json`. Created with defaults on first launch. Edit and press **Cmd+Shift+R** to reload without restarting.

```json
{
  "shell": "/bin/zsh",
  "font": {
    "family": "Menlo, Monaco, monospace",
    "size": 14,
    "lineHeight": 1.3
  },
  "cursor": { "style": "bar", "blink": true },
  "sidebar": { "width": 200, "position": "left" },
  "theme": {
    "sidebar": { "background": "#000000", "accentColor": "#0a84ff" },
    "terminal": { "background": "#000000", "foreground": "#f8f8f2" }
  },
  "keybindings": {
    "newTab": "cmd+t",
    "closeTab": "cmd+w",
    "splitHorizontal": "cmd+d",
    "splitVertical": "cmd+shift+d"
  }
}
```

Only include keys you want to override — everything else uses defaults.

## Troubleshooting

| Problem | Solution |
| --- | --- |
| App won't open ("damaged" or "unidentified developer") | Run `xattr -cr /Applications/Clawterm.app` |
| Commands like `npm`, `claude` not found | Your shell PATH isn't loading. Ensure your shell profile (`.zshrc`) exports PATH correctly |
| Terminal has no colors | Set `TERM=xterm-256color` in your shell profile (Clawterm sets this by default) |
| Blank/white screen on launch | WebGL may not be available — Clawterm falls back to canvas rendering automatically |

## Building from Source

### Prerequisites

- [Rust](https://rustup.rs/) (stable toolchain)
- [Node.js](https://nodejs.org/) (v18+)
- macOS with Apple Silicon

### Development

```bash
git clone https://github.com/Axelj00/clawterm.git
cd clawterm
npm install
npm run tauri dev
```

### Production build

```bash
npm run tauri build
```

Output goes to `src-tauri/target/release/bundle/`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on branching, commits, and releases.

Bug reports and feature requests: [open an issue](https://github.com/Axelj00/clawterm/issues).

## License

[MIT](LICENSE)
