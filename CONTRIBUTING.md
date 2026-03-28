# Contributing

## Setup

```bash
git clone https://github.com/clawterm/clawterm.git
cd clawterm
npm install
npm run tauri dev
```

Requires [Rust](https://rustup.rs/) (stable) and [Node.js](https://nodejs.org/) 18+. macOS needs Xcode CLI tools (`xcode-select --install`).

## Workflow

1. Branch off `main` — one feature or fix per PR
2. Run `npm run preflight` before pushing (lint, format, test, typecheck)
3. Open a PR

## License

By contributing, you agree your work is licensed under the [MIT License](LICENSE).
