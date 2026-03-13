# Contributing to Clawterm

Thanks for your interest in contributing. This document covers the basics for getting started.

## Development Setup

```bash
git clone https://github.com/Axelj00/clawterm.git
cd clawterm
npm install
npm run tauri dev
```

Prerequisites: Rust (stable), Node.js 18+, macOS Apple Silicon.

## Branching

- **`main`** is the release branch. It should always be buildable.
- Create feature branches off `main` with a descriptive name: `fix/focus-loss`, `feat/split-panes`, etc.
- Open a pull request when ready. Keep PRs focused — one feature or fix per PR.

## Commits

Write clear commit messages. Use present tense ("Fix focus loss", not "Fixed focus loss"). If the change is non-trivial, add a blank line and a short description of *why*.

```
Fix terminal focus loss after Cmd+Tab window switch

xterm.js textarea loses focus when the window deactivates.
Added a window focus listener that re-focuses the active
terminal pane when the window regains focus.
```

## Code Quality

Before pushing, make sure everything passes:

```bash
npm run lint          # ESLint
npm run format:check  # Prettier
npm run test          # Vitest
npx tsc --noEmit      # TypeScript
```

CI runs these checks on every push and PR.

## Releasing a New Version

Releases are automated. The process:

1. Make your changes on a branch, get them merged to `main`.
2. Bump the version in all three files:
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
3. Commit the bump: `git commit -m "Bump version to X.Y.Z"`
4. Tag and push:
   ```bash
   git tag vX.Y.Z
   git push origin main --tags
   ```
5. GitHub Actions builds the `.dmg`, signs the update bundle, and publishes a release.

Users running an older version see an update notification in the sidebar and can update with one click.

### Version Numbering

We use [semver](https://semver.org/):

- **Patch** (0.2.x): bug fixes, small tweaks
- **Minor** (0.x.0): new features, non-breaking changes
- **Major** (x.0.0): breaking changes

## Reporting Bugs

[Open an issue](https://github.com/Axelj00/clawterm/issues) with:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Your macOS version and Clawterm version

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
