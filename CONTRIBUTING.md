# Contributing

Thanks for your interest in Clawterm! Here's everything you need to get started.

## Setup

```bash
git clone https://github.com/clawterm/clawterm.git
cd clawterm
npm install
npm run tauri dev
```

### Prerequisites

**All platforms:**
- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) (v18+)

**macOS:**
- Xcode Command Line Tools (`xcode-select --install`)

**Windows:**
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++" workload
- [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (pre-installed on Windows 11, may need manual install on Windows 10)

## Making Changes

1. Create a branch off `main`: `feat/my-feature`, `fix/the-bug`, etc.
2. Keep PRs focused — one feature or fix per PR.
3. Make sure everything passes before pushing:
   ```bash
   npm run preflight
   ```
4. Open a pull request. CI runs the same checks automatically.

## Commits

Write clear, present-tense commit messages. If the change is non-trivial, add a short description of *why*:

```
Fix terminal focus loss after Cmd+Tab

xterm.js textarea loses focus when the window deactivates.
Added a window focus listener that re-focuses the active pane.
```

## Reporting Bugs

[Open an issue](https://github.com/clawterm/clawterm/issues/new/choose) with what you expected, what happened, steps to reproduce, and your OS and Clawterm version.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
