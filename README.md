# Clawterm

A terminal emulator built for running AI agents. Vertical tabs, fast PTY, native macOS feel.

## About

Clawterm is a lightweight terminal emulator designed with AI-agent workflows in mind. If you spend your day running Claude Code, Codex, or similar tools across multiple sessions, Clawterm gives you a clean vertical-tab interface to manage them all without the overhead of a full IDE terminal.

Built with [Tauri 2](https://v2.tauri.app/) and [xterm.js](https://xtermjs.org/).

## Screenshot

*Coming soon*

## Features

- **Vertical tab sidebar** -- switch between sessions at a glance, renameable with double-click
- **JSON config file** -- fonts, colors, keybindings, sidebar position, all in one place
- **Keyboard shortcuts** -- new tab, close tab, cycle tabs, jump-to-tab by number
- **Natural text editing** -- Cmd+Backspace deletes the line, Cmd+Arrow jumps to line boundaries, Alt+Arrow moves by word, just like a native text field
- **macOS native** -- custom traffic lights, draggable titlebar, minimal chrome
- **Fast** -- Rust backend with a real PTY, xterm.js renderer, no Electron

## Installation

Clawterm is not yet distributed as a pre-built binary. To run it, build from source.

### Prerequisites

- [Rust](https://rustup.rs/) (stable toolchain)
- [Node.js](https://nodejs.org/) (v18+)
- [Tauri CLI](https://v2.tauri.app/start/create-project/) (`cargo install tauri-cli --version "^2"`)

### Build and run

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/clawterm.git
cd clawterm

# Install frontend dependencies
npm install

# Run in development mode
cargo tauri dev

# Or build a release binary
cargo tauri build
```

The release build produces a `.app` bundle in `src-tauri/target/release/bundle/macos/`.

## Configuration

Clawterm reads its config from:

```
~/.config/clawterm/config.json
```

On first launch the file is created with sensible defaults. Edit it with any text editor and press **Cmd+Shift+R** inside Clawterm to reload without restarting.

### Example config

```json
{
  "shell": "/bin/zsh",
  "font": {
    "family": "Menlo, Monaco, monospace",
    "size": 14,
    "lineHeight": 1.3
  },
  "cursor": {
    "style": "bar",
    "blink": true
  },
  "sidebar": {
    "width": 200,
    "position": "left"
  },
  "theme": {
    "sidebar": {
      "background": "#000000",
      "accentColor": "#0a84ff"
    },
    "terminal": {
      "background": "#000000",
      "foreground": "#f8f8f2"
    }
  },
  "keybindings": {
    "newTab": "cmd+t",
    "closeTab": "cmd+w",
    "nextTab": "cmd+shift+]",
    "prevTab": "cmd+shift+[",
    "reloadConfig": "cmd+shift+r"
  }
}
```

You only need to include the keys you want to override; everything else falls back to defaults.

## Keyboard Shortcuts

| Action | Default Shortcut |
| --- | --- |
| New tab | `Cmd+T` |
| Close tab | `Cmd+W` |
| Next tab | `Cmd+Shift+]` |
| Previous tab | `Cmd+Shift+[` |
| Jump to tab 1-9 | `Cmd+1` through `Cmd+9` |
| Reload config | `Cmd+Shift+R` |
| Clear terminal | `Cmd+K` |
| Jump to line start | `Cmd+Left` |
| Jump to line end | `Cmd+Right` |
| Delete line | `Cmd+Backspace` |
| Move back one word | `Alt+Left` |
| Move forward one word | `Alt+Right` |
| Delete previous word | `Alt+Backspace` |

All keybindings (except the text-editing ones) can be remapped in `config.json`.

## Contributing

Contributions are welcome. Please:

1. Fork the repository and create a feature branch.
2. Keep changes focused -- one feature or fix per pull request.
3. Make sure the project builds cleanly (`cargo tauri build`).
4. Open a pull request with a clear description of what changed and why.

If you find a bug or have a feature request, open an issue first so it can be discussed before implementation work begins.

## License

[MIT](LICENSE)
