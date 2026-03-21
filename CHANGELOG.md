# Changelog

All notable changes to Clawterm are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.13.0] - 2026-03-21

### Added
- Windows support — Clawterm now builds and runs on Windows with NSIS installer distribution (#185)
- Windows process introspection using `CreateToolhelp32Snapshot` for process tree walking and `sysinfo` for CWD detection (#185)
- Platform detection (`isMac`, `isWindows`, `isPrimaryMod`) for cross-platform keybinding and UI behavior (#185)
- Windows-style window controls (top-right, rectangular minimize/maximize/close) alongside existing macOS traffic lights (#185)
- Ctrl+C conflict handling on Windows — copies when text is selected, sends SIGINT when not (matches Windows Terminal) (#185)
- Windows CI: `windows-latest` backend checks and `x86_64-pc-windows-msvc` release target (#185)
- Linux fallback for process CWD via `/proc/{pid}/cwd` (#185)

### Changed
- Default shell is now platform-aware: `powershell.exe -NoLogo` on Windows, `/bin/zsh --login` on macOS (#185)
- Default font family is now platform-aware: Cascadia Mono on Windows, Menlo on macOS (#185)
- All hardcoded `e.metaKey` keybinding checks replaced with `isPrimaryMod()` for cross-platform support (#185)
- `HOME` environment variable set from `USERPROFILE` on Windows for Unix-origin tool compatibility (#185)
- `TERM`/`COLORTERM` environment variables only set on Unix (ConPTY handles VT translation on Windows) (#185)
- Unix file APIs (`write_private`, `validate_shell`) guarded with `#[cfg]` for cross-platform compilation (#185)


## [0.12.1] - 2026-03-21

### Fixed
- Terminal scroll-to-top on tab switch — added a scroll position lock mechanism that spans the entire tab show/hide transition; the lock is acquired on hide() and released only after all destabilizing operations (fit, write flush, WebGL) complete, providing a single authoritative scroll restoration point instead of multiple racy intermediate restorations (#184)


## [0.12.0] - 2026-03-20

### Changed
- Tab icons replaced with minimal 8×8 dots — state conveyed through muted colors and CSS animations (pulse, breathe, fade) instead of distinct SVG shapes; desaturated color palette (orange #d4a053, red #d46a63, green #7cc49a) reduces visual noise (#180)
- Status bar is now context-adaptive — shows different fields depending on whether the active tab runs a shell, an agent, or a dev server; agent mode displays name, live elapsed timer (mm:ss), and current action with truncation (#179)
- Sidebar tab subtitles now show action count ("· 12 actions") and differentiate waiting types ("waiting for input" for user prompts vs "waiting" for unknown/API waits) (#181)
- Removed aggressive title color overrides for needs-attention and agent-waiting tab states — badge dot is now the sole attention indicator (#180)

### Added
- Agent startup detection — sidebar shows "starting claude..." for 3 seconds when an agent process is first detected in a tab (#181)
- Persistent notification badges for background tabs — color-coded (green for completed, red for error/crash, pulsing orange for needs-input, green for server-started) that persist until the tab is focused (#181)
- `userScrolledUp` flag that tracks intentional scroll-up and persists across tab switches — prevents auto-scroll-to-bottom on fit() when the user has scrolled up deliberately (#182)

### Fixed
- Terminal jumping to top of scrollback during agent work and tab switches — reduced near-bottom threshold from 3 to 1 line, added intentional scroll tracking, and deferred write flushing by one extra rAF frame in the show() pipeline to let scroll restoration fully settle before pending writes fire (#182)
- Split pane divider only resizing one terminal — divider drag now uses forceFit() (bypassing output-activity deferral) so both panes re-render their content in lockstep with the divider position; also applied to double-click reset and drag-end (#183)
- Notification badge not appearing for events that don't set needsAttention (e.g., server-started) — added base CSS rule for all notif-* classes independent of needs-attention


## [0.11.0] - 2026-03-18

### Changed
- Removed all blinking, pulsing, and spinning animations — tab icons now use static colors to indicate state (green=running, orange=waiting, blue=attention, red=error) instead of distracting infinite animations
- Cursor blink defaults to off — can still be enabled via `cursor.blink: true` in config
- Removed all `backdrop-filter: blur()` effects (7 instances) — saves GPU, opaque backgrounds look cleaner on dark themes
- Simplified box-shadows from heavy `0 12px 40px` to subtle `0 4px 16px`

### Removed
- Dead `.tab-agent-indicator` element (was already `display: none`)
- Pane status dots in sidebar — the status text already conveys activity state
- `animation-play-state` rules (no animations left to pause)
- `PANE_DOT_CLASS` constant and related DOM creation

## [0.10.1] - 2026-03-18

### Fixed
- Terminal unexpectedly scrolling to top of scrollback buffer — root cause was `display: none` on hidden tabs resetting DOM `scrollTop` to 0, which corrupted xterm.js internal scroll state when `_sync()` ran; replaced with `visibility: hidden` to preserve scroll position, serialized the show() pipeline to prevent write/fit races, added DOM scrollTop save/restore as defense-in-depth, and suppressed ResizeObserver during tab transitions (#177)

## [0.10.0] - 2026-03-18

### Fixed
- Split pane divider not draggable — CSS `flex: 1` (flex-basis: 0%) caused the flex algorithm to ignore width/height values set by applySplitSizes(), making both panes always equal-sized regardless of drag position; now uses `flex: 0 0 calc(...)` shorthand to override flex-basis directly (#175)

### Added
- Smarter tab status for AI agents — tabs now show the specific action an agent is performing (e.g., "claude: Reading src/auth.ts (2m)") instead of generic "working..." text; parses tool-use detail from output matchers and terminal title (OSC 0/2) (#176)
- Notification click-to-tab — clicking a macOS notification now focuses the app window and switches to the relevant tab; uses Web Notification API onclick as a working fallback while Tauri plugin desktop support is pending upstream (#174)
- RAF-throttled divider drag — xterm.js fit calls are coalesced via requestAnimationFrame during pane resize drag for smoother performance (#175)
- Touch event support for split pane dividers — touchstart/touchmove/touchend handlers enable pane resizing on trackpads and touch screens (#175)

## [0.9.9] - 2026-03-16

### Fixed
- Zoom in (Cmd+=) not working — matchesKeybinding() rejected Cmd+Shift+= (the standard zoom-in gesture on macOS) because it enforced shiftKey=false and expected key="=" while Shift produces key="+"; now accepts shifted variants of symbol keys to match browser/native behavior (#173)


## [0.9.8] - 2026-03-16

### Fixed
- Terminal goes black under heavy multi-tab load (8+ tabs with AI agents) — background tabs now defer PTY write flushing instead of processing every frame, reducing CPU pressure; periodic recovery refresh catches silent WebGL context loss on the active tab (#170)


## [0.9.7] - 2026-03-16

### Fixed
- Terminal goes dark or appears shifted/zoomed when switching to a tab with active output — fit() and WebGL activation were caught in an infinite deferral loop; added forceFit() that bypasses the output-activity guard, and Tab.show() now force-fits, force-activates WebGL, and refreshes all pane viewports (#171)
- Zoom in/out/reset (Cmd+=/-/0) not working during active output — applyConfig() now uses forceFit() since config changes are user-initiated and must take effect immediately (#172)


## [0.9.6] - 2026-03-16

### Fixed
- Terminal goes black during typing or while waiting for AI agent output — WebGL context loss now forces a full viewport refresh so xterm.js repaints with the fallback canvas renderer, and window re-focus triggers a preventive refresh to recover from silent renderer failures


## [0.9.5] - 2026-03-16

### Fixed
- Terminal jumps to top of scrollback during agent thinking/tool execution — RAF-based write batching serializes terminal.write() with fit() calls, macOS momentum scroll clamping via attachCustomWheelEventHandler (#168)
- Tab activity status (working vs waiting) inaccurate for AI agents — replaced fixed 8s timeout with adaptive threshold based on output cadence, two-stage transition (maybe-idle → waiting), terminal buffer scanning for working patterns, child process tree monitoring, and agent-specific working pattern matchers (#169)

### Added
- New `agent-maybe-idle` tab activity state with dimmed orange indicator for uncertain idle detection
- `agent-working` output event type for immediate idle-timer reset on tool-use messages and spinners
- `has_active_children` Rust command for child process monitoring during agent silence
- Agent-specific working pattern matchers for Claude Code (spinners, tool messages) and aider


## [0.9.4] - 2026-03-15

### Fixed
- Terminal still scrolls to top during bursty agent output — increased fit() deferral to 300ms with always-reschedule, deferred WebGL activation during output, suppressed false isScrolledUp from programmatic scrolls (#167)


## [0.9.3] - 2026-03-15

### Fixed
- Update check button not refreshing version in existing update notice (#166)


## [0.9.2] - 2026-03-15

### Added
- `preflight` npm script combining lint, format check, test, and typecheck in one command
- `release` npm script — single-command release pipeline replacing the 9-step manual process (#161)

### Changed
- CI and release workflows use `npm run preflight` instead of 4 separate commands
- Split divider width now respects `theme.ui.splitDividerWidth` config (default 9, range 3–20) (#163)
- Git branch indicator polls every cycle instead of only on CWD change (#164)
- PR template simplified to use `npm run preflight`

### Fixed
- Terminal scrolls to top during heavy agent output — fit() now deferred during active writes and uses near-bottom tolerance (#162)
- Split divider size calculation used hardcoded 9px instead of configured width (#163)
- Git branch indicator not updating when switching branches in the same directory (#164)
- Update notification floating in terminal area instead of sidebar above new tab button (#165)

### Removed
- `scripts/bump.mjs` — absorbed into `scripts/release.mjs` (#161)


## [0.9.1] - 2026-03-15

### Fixed
- App freezes after opening ~5 terminals — PTY read/write/exitstatus blocked tokio async worker threads, exhausting the thread pool at `CPU_cores / 2` sessions (#160)

## [0.9.0] - 2026-03-14

### Added
- Lazy WebGL lifecycle: GPU contexts disposed on tab hide, re-created on show — enables many more terminals across tabs (#135, #136)
- `close_session` PTY plugin command for explicit session cleanup (#137)
- Focus-visible indicators on all interactive elements (search input, tab close, utility buttons, palette/switcher inputs) (#145)
- `prefers-reduced-motion` media query to disable all animations for users with motion sensitivities (#145)
- ARIA `role="alert"` on toast notifications, `aria-label` on dismiss button (#151)
- Focus traps in context menu and command palette to prevent Tab escaping (#153)
- Platform guards (`#[cfg(target_os = "macos")]`) with stubs for other platforms (#152)
- Compile-time struct size assertions for unsafe FFI layouts (#144)

### Changed
- Default `maxPanes` raised from 4 to 8, configurable up to 16 (was hard-capped at 4) (#136)
- Split divider widened to 9px with centered 1px visual line for reliable dragging (#134)
- AI status detection patterns tightened and timeout increased from 3s to 8s (#125)
- Color contrast improved across sidebar: tab text (0.45→0.65), pane lines (0.3→0.5), keyboard hints (0.2→0.4), utility buttons (0.2→0.45) (#147)
- Z-index hierarchy established: context-menu(800) < toast(900) < overlay(1200) (#146)
- Touch targets expanded for tab close and utility buttons via padding (#148)
- Session saved on quit instead of cleared — tabs restore on next launch (#128)
- Config reload now restarts poll timer with new interval values (#141)
- Poll failure recovery: resumes after new output or 30-second timeout (#130, #157)
- Config/session files written with mode 0o600 (owner-only permissions) (#150)
- Path validation now canonicalizes to resolve symlinks (#149)
- File reads use direct error handling instead of exists() check (TOCTOU fix) (#143)

### Fixed
- App crash when total terminal count exceeds ~4 across tabs (WebGL context exhaustion) (#135)
- Split pane divider not draggable due to xterm.js canvas intercepting mouse events (#134)
- Scroll position lost when switching between tabs with long output (#124)
- AI status falsely showing "waiting for input" while agent is working (#125)
- Tab creation permanently blocked if PTY start() throws (#127)
- Rapid tab switching focusing the wrong tab due to two-frame rAF delay race (#132)
- Event listener memory leaks in sidebar resize handlers (#126)
- Session state lost on quit due to debounced save timing (#128)
- Split restore corrupting pane tree on partial failure (#129)
- Poll failure counter never resetting after transient errors (#130)
- Paste overlay not dismissed on pane/tab close (tracked per-pane now) (#131)
- Clipboard errors silently swallowed — now shown as toast notifications (#131)
- Focused pane referencing disposed pane after split revert (#140)
- Activity "completed" fade timeouts stacking up on rapid completions (#142)
- Tab switch during async split stealing focus to hidden element (#154)
- Incomplete dispose(): resize rAF and poll callback continuing after shutdown (#133)
- Toast double-removal race between transitionend and setTimeout (#151)
- Stale command palette reference if overlay removed externally (#155)
- Divider drag listeners leaking on tab close (now use AbortController) (#138)
- Title poll timer firing after pane disposal (#139)
- PTY sessions leaking memory (never removed from BTreeMap after exit) (#137)
- Unsafe FFI buffer over-read in `get_proc_name()` and allocation overflow in `list_child_pids()` (#144)
- Typo "Unavaliable" in PTY plugin error messages (#156)
- Paste confirm dialog event listeners not scoped to AbortController (#159)
- Magic numbers replaced with named constants (divider width, closed tab limit, paste limit) (#158)

## [0.8.0] - 2026-03-14

### Added
- Full UI customizability via `theme.ui` config section: window border radius/color, titlebar height, status bar height, pane padding, focus outline color, unfocused pane opacity, split divider width, accent colors (orange/red/green), and transition speed (#121)
- CSS custom properties for all UI appearance values, enabling user theming
- Validation with sensible min/max bounds for all new config fields
- Missing `.toast-info` CSS rule for info-level toast notifications
- Recursive session split layout validation to prevent crashes from corrupted state

### Changed
- Updater now re-checks for the absolute latest version before downloading to skip intermediate releases (#120)
- Updater skips the initial post-relaunch update check to prevent duplicate prompts
- IPC timeout minimum increased from 1000ms to 2000ms for slower systems
- Process poll now uses `Promise.allSettled` so one CWD lookup failure doesn't block others

### Fixed
- Crash when `theme`, `theme.ui`, or nested config properties are null/undefined (#123)
- Terminal crash from zero/NaN dimensions when PTY spawns on hidden elements (#123)
- Division by zero in split divider drag when container has zero dimensions (#123)
- Event gutter markers rendering at NaN position when totalLines is 0 (#123)
- Large paste (>5MB) freezing the UI — now rejected with toast notification (#123)
- PTY init chain continuing after pane disposal, causing stale state mutations (#123)
- Negative elapsed time display when system clock skews (#123)
- Invalid custom matcher regex silently ignored — now logged as warning (#123)

### Removed
- Unused `isVisible()` methods from SearchBar and TabSwitcher (#122)
- Unused `.tab-title-input` CSS class (#122)
- Unused `@tauri-apps/plugin-fs` dependency (#122)

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

[Unreleased]: https://github.com/clawterm/clawterm/compare/v0.13.0...HEAD
[0.13.0]: https://github.com/clawterm/clawterm/compare/v0.12.1...v0.13.0
[0.12.1]: https://github.com/clawterm/clawterm/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/clawterm/clawterm/compare/v0.11.0...v0.12.0
[0.9.9]: https://github.com/clawterm/clawterm/compare/v0.9.8...v0.9.9
[0.9.8]: https://github.com/clawterm/clawterm/compare/v0.9.7...v0.9.8
[0.9.7]: https://github.com/clawterm/clawterm/compare/v0.9.6...v0.9.7
[0.9.6]: https://github.com/clawterm/clawterm/compare/v0.9.5...v0.9.6
[0.9.5]: https://github.com/clawterm/clawterm/compare/v0.9.4...v0.9.5
[0.9.4]: https://github.com/clawterm/clawterm/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/clawterm/clawterm/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/clawterm/clawterm/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/clawterm/clawterm/compare/v0.9.0...v0.9.1
[0.11.0]: https://github.com/clawterm/clawterm/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/clawterm/clawterm/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/clawterm/clawterm/compare/v0.9.9...v0.10.0
[0.9.0]: https://github.com/clawterm/clawterm/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/clawterm/clawterm/compare/v0.7.0...v0.8.0
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
