# Changelog

All notable changes to Clawterm are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.7.0] - 2026-03-14

### Added
- Output event timeline with scrollbar markers and prompt capture
- Native OS notifications via Tauri, replacing Web Notification API (#44380d5)
- Pane focus visual indicators and keyboard navigation (#1bbafcb)
- Agent-specific color indicators in sidebar tab entries
- Dynamic tab names replacing static "Terminal N" titles
- PaneState type with per-pane status line computation
- Notification click-to-focus and folder-based tab titles
- New pane shortcuts in keyboard shortcuts panel

### Changed
- Redesigned sidebar footer and moved utility buttons (#117, #118, #119)
- Redesigned sidebar tabs with folder title and per-pane status lines
- Complete process detection overhaul: tcgetpgrp, local PTY plugin, idle agent detection
- Improved responsiveness: instant CWD detection, enforce maxPanes, faster poll
- Refactored Tab to poll all panes and derive tab state from pane states
- Rewrote README to lead with multi-agent value prop
- Split CONTRIBUTING.md — moved release process to RELEASING.md

### Fixed
- Terminal randomly scrolling to top on resize (#111)
- PTY session leak across dev hot reloads (#116)
- Nested splits lost on session restore (#115)
- Crash on 3+ pane splits from WebGL context exhaustion
- Critical CWD truncation bug and poll timing
- Agent detection for script-based agents (codex, gemini) and tab title CWD
- ptyPid always undefined — read pid lazily from PTY object
- Split pane dividers misaligned with sidebar/status borders

## [0.6.0] - 2026-03-14

### Added
- Clickable links in terminal output
- Check-for-updates button in sidebar footer
- Intel Mac (x86_64) builds in release workflow
- Apple code signing and notarization support
- GitHub Pages landing page
- Dependabot for npm, Cargo, and GitHub Actions
- CODEOWNERS, CODE_OF_CONDUCT.md, and SECURITY.md

### Changed
- Replaced generated logos with Figma-designed brand assets
- Updated app icons (including macOS dock icon) to new brand
- Updated website theme to neon red with new logo and favicon
- Migrated repo URLs from Axelj00/clawterm to clawterm/clawterm org
- Updated Homebrew formula and install script for dual architecture

## [0.5.3] - 2026-03-14

### Fixed
- Split pane crash leaving app in broken state — handle PTY spawn failure with rollback (#67)
- Unhandled promise rejections from split operations — properly await and catch errors (#67)
- fitAddon.fit() crash on zero-dimension elements in Pane.start() (#67)
- Cascading dispose failures — one pane failing to dispose no longer blocks the rest (#67)

## [0.5.2] - 2026-03-14

### Fixed
- Terminal focus loss when switching tabs — two-frame delay for DOM settling (#63, #64)
- Stuck confirm overlays blocking all interaction — auto-dismissed on tab switch (#63, #64)
- Session persisting after Cmd+Q due to race with debounced save (#65)

### Changed
- Update notice now appears above the new tab button in sidebar (#66)
- Replaced innerHTML with DOM API in updater to prevent XSS (#66)

## [0.5.1] - 2026-03-14

### Fixed
- Session state not cleared on quit when app is frozen — moved to Rust-side handler (#62)
- Session restore now validates CWDs and isolates per-tab failures (#62)
- Poll loop runs tab polls concurrently to prevent one stuck IPC from blocking all tabs (#62)
- Tab creation now handles PTY spawn failure gracefully (#62)

## [0.5.0] - 2026-03-14

### Added
- Font size zoom with Cmd+/Cmd- (#58)
- Multi-line paste confirmation dialog (#59)
- Restore recently closed tab with Cmd+Shift+T (#60)
- GitHub issue/PR templates (#55)

### Changed
- Refactored terminal-manager.ts into focused modules (#51)
- Throttled output analyzer with 100ms debounce (#54)
- Cached IPC calls to skip redundant lookups (#53)
- Paused CSS animations on non-visible tabs (#61)
- Improved README with badges, troubleshooting, and getting started (#56)
- Added CHANGELOG with full release history (#57)

### Fixed
- Memory leak: Pane event listeners not cleaned on dispose (#49)
- Cached tab child element refs to avoid querySelector per render (#50)
- Replaced silent catch blocks with logged errors (#52)

## [0.4.1] - 2025-03-14

### Fixed
- Cmd+Q now clears session state so the app starts fresh (#48)

## [0.4.0] - 2025-03-13

### Added
- Command palette with Cmd+Shift+P (#14)
- Tab pinning to prevent accidental close (#47)
- Clickable file paths in terminal output (#46)
- Startup command option per tab (#45)
- Auto-scroll pill when scrolled up with new output (#43)
- Per-tab notification muting (#10)
- Interactive status bar with click actions (#9)
- Agent session elapsed time tracking (#20)
- Image protocol support via @xterm/addon-image (#18)
- User-defined output matchers in config (#15)
- Split pane layout persistence across sessions (#2)

### Fixed
- Split pane divider drag by disabling pointer events during resize (#36)
- Shell args now configurable with smart defaults per shell (#23)

## [0.3.5] - 2025-03-13

### Added
- Git branch indicator in status bar (#41)
- Kill Process and Restart Shell in tab context menu (#42)

### Changed
- Improved tab intelligence: anti-flicker grace period, subtitles, attention dots (#39)

### Fixed
- Bracketed paste mode for context menu paste (#44)

## [0.3.4] - 2025-03-13

### Fixed
- Guard against concurrent tab creation (#38)
- Show confirmation dialog before installing update (#37)

## [0.3.3] - 2025-03-13

### Added
- Keyboard shortcuts panel with sidebar button (#31)
- Right-click context menu with Copy, Paste, Clear (#35)
- Configurable scrollback buffer size (#34)
- WebGL renderer with canvas fallback (#33)

## [0.3.2] - 2025-03-13

### Added
- Quick commands — custom keybindings that type into the terminal (#30)
- Keyboard navigation for context menus (#6)
- Graceful PTY shutdown: SIGHUP then SIGKILL after 2s (#16)

## [0.3.1] - 2025-03-13

### Added
- Detect Claude Code running as node process for tab name (#28)
- Send CSI u escape for Shift+Enter for multi-line input (#27)
- Set TERM, COLORTERM, TERM_PROGRAM env vars for PTY children (#24, #25, #26)

### Changed
- Skip tab list re-render when state is unchanged (#4)

## [0.3.0] - 2025-03-13

### Added
- Copy-on-select option (#7)
- Max panes limit to prevent memory bloat (#12)
- Search result count in search bar (#3)

### Fixed
- Close context menu on Escape key (#22)
- Shell not inheriting PATH (#21)
- Debounced ResizeObserver with requestAnimationFrame (#5)
- Race condition in nextTab/prevTab (#1)

## [0.2.6] - 2025-03-13

### Changed
- Check for updates periodically, not just on launch

## [0.2.5] - 2025-03-13

### Added
- Project documentation and install script

### Fixed
- Show toast on sidebar width save failure (#19)

## [0.2.0] - 2025-03-12

### Added
- Split panes (horizontal/vertical terminal splits)
- Session persistence — restore tabs on restart
- Tab drag-and-drop reordering
- Draggable sidebar divider for live resize
- Confirmation dialog when closing tabs with running processes
- Toast notification system
- Cross-platform keybinding support
- Tests for tab-state and server-tracker modules

### Fixed
- Window dragging, rounded corners, and CWD inheritance
- Memory leaks, XSS prevention, stale styles, dead code

## [0.1.0] - 2025-03-12

### Added
- Initial release
- Vertical tab sidebar with terminal management
- Process intelligence (idle, running, server, agent detection)
- Output analysis with pattern matching
- Desktop notifications for agent events
- JSON configuration (fonts, colors, keybindings)
- Native macOS text editing shortcuts
- Tauri 2 + xterm.js architecture

[Unreleased]: https://github.com/clawterm/clawterm/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/clawterm/clawterm/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/clawterm/clawterm/compare/v0.5.3...v0.6.0
[0.5.3]: https://github.com/clawterm/clawterm/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/clawterm/clawterm/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/clawterm/clawterm/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/clawterm/clawterm/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/clawterm/clawterm/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/clawterm/clawterm/compare/v0.3.5...v0.4.0
[0.3.5]: https://github.com/clawterm/clawterm/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/clawterm/clawterm/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/clawterm/clawterm/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/clawterm/clawterm/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/clawterm/clawterm/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/clawterm/clawterm/compare/v0.2.6...v0.3.0
[0.2.6]: https://github.com/clawterm/clawterm/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/clawterm/clawterm/compare/v0.2.0...v0.2.5
[0.2.0]: https://github.com/clawterm/clawterm/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/clawterm/clawterm/releases/tag/v0.1.0
