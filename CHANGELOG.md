# Changelog

All notable changes to Clawterm are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.19.0] - 2026-04-02

### Design
- **Agent-first sidebar layout** — when an agent is running, the tab entry shows the agent name as the primary label with an animated state icon, elapsed time right-aligned, current action as secondary text, and folder+branch as tertiary context (#331)
- **Per-pane status footers** — each terminal pane now has its own contextual footer replacing the global status bar; agent panes show agent name, model, context usage bar, cost, git info, and elapsed time; shell/server panes show CWD and branch (#348)
- **Focus mode** — new `sidebar.expandActiveTab` config option shows recent action history for the active agent tab, giving richer detail without switching terminals (#342)
- **State-specific icons** — animated SVG icons for each pane state: spinning arc (running), pulsing ring (waiting), triangle (server), checkmark (completed), X (error), dot (idle) (#347)
- **Tab grouping** — sidebar groups tabs by type: AGENTS, SERVERS, SHELLS with section headers and counts (#334)
- **Hover quick actions** — Split, Kill, Mute, and Close buttons appear on tab hover (#337)
- **Startup command pills** — quick-launch buttons in the sidebar footer for configured startup commands (#340)
- **Typography hierarchy** — 3-tier type scale (13px primary, 11px secondary, 10px tertiary) for clear information density (#341)
- **Cleaner chrome** — removed branch badges, pane number overlays, simplified split dividers (9px→5px), replaced notification corner dots with left-edge accent bars (#333)
- **Structured pane status** — per-pane status lines use independent DOM spans for agent name, action, and elapsed time instead of flat strings (#350)
- **Compact elapsed format** — elapsed time shown as M:SS or H:MM:SS with action count badge (#335)
- **Responsive sidebar** — compact mode (120-179px) and slim mode (<120px) with progressive density reduction (#346)

### Performance
- **DashMap for PTY sessions** — replaced `RwLock<BTreeMap>` with lock-free `DashMap` for concurrent PTY session access (#303)
- **WebGL context LRU pool** — reuses up to 6 WebGL contexts across tab switches instead of create/destroy each time (#290)
- **Faster tab switching** — collapsed the 4-frame rAF show pipeline to 2 frames (#295)
- **Hidden tab memory savings** — cap scrollback to 1000 lines and reduce pending buffer from 512KB to 128KB for hidden tabs (#305)
- **Lazy addon loading** — dynamic imports for WebGL, Search, Unicode11, and Image addons for bundle code splitting (#317)
- **Performance instrumentation** — PerfMetrics collector with timed/timedAsync utilities and command palette stats viewer (#307)
- **Universal macOS binary** — single `universal-apple-darwin` build replaces separate aarch64 and x86_64 builds (#320)

### Fixed
- **Worktree path resolution** — `find_repo_root` now uses `--git-common-dir` instead of `--show-toplevel` for correct behavior inside git worktrees (#351)
- **Branch name stacking** — strip existing `-wt-N` suffix before generating new worktree branch names (#351)
- **Notification suppression** — extended grace period from 2s to 3s and added transitioning guard to prevent spurious notifications on idle tab checks (#278)
- **Update notice overflow** — text truncation for update labels at narrow sidebar widths (#345)
- **Event gutter default** — hidden by default to reduce visual noise, configurable via `showEventGutter` (#349)

### Infrastructure
- **macOS code signing** — added Entitlements.plist with JIT, unsigned memory, dyld env, and library validation permissions; wired into Tauri bundle config (#277)

## [0.18.9] - 2026-04-02

### Performance
- **Batched IPC polling** — replaced 5-7 sequential IPC calls per pane per poll cycle with a single batched `poll_pane_info` command; 10 active panes: 50-70 IPC calls/s → 20 IPC calls/s (#284)
- **Git status caching** — per-directory cache with 3-second TTL eliminates redundant `git status` subprocess spawns; 5 panes in same repo: 5 git spawns/s → ~0.3 git spawns/s (#285)
- **16x larger PTY read buffer** — increased from 4KB to 64KB, reducing IPC round-trips proportionally during high-throughput terminal output (#328)

## [0.18.8] - 2026-04-02

### Performance
- **Idle tab poll throttling** — after 5 consecutive idle polls, skip expensive CWD lookups and git subprocess spawns; resets instantly on user activity or process start (#301)
- **Progressive session restore** — restore the active tab first so the user sees a terminal immediately, then restore remaining tabs with yields to keep the UI responsive (#298)
- **Opaque window rendering** — switched from transparent to opaque window with native shadow, eliminating per-frame compositor alpha blending overhead (#321)
- **Simplified status bar** — removed redundant agent info (already in sidebar) and the 1-second elapsed timer; status bar now shows only CWD + git branch (#336)

### Design
- **Unmissable waiting state** — agent-waiting tabs now have a 2px left-edge orange accent bar, subtle warm background tint, and a gentle 4-second breathing animation on the notification dot (#338)
- **Neutral UI chrome** — replaced accent color usage on context menus, command palette, and split dividers with subtle neutral highlights; accent reserved for state communication only (#339)
- **Cleaner split panes** — removed opacity dimming on unfocused panes (keeps text readable) and replaced the colored focus outline with a subtle inset top-edge line (#343)


## [0.18.7] - 2026-04-01

### Performance
- **Smaller font bundle** — import only latin + latin-ext subsets, eliminating 171KB (48%) of unused Cyrillic/Greek/Vietnamese font files (#312)
- **CSS containment** — added `contain` and `content-visibility` properties to panes, split containers, and hidden terminal wrappers so the browser can skip rendering for hidden/isolated content (#327)
- **Faster release pipeline** — release check job now runs on ubuntu-latest with frontend-only checks, saving ~1-2 min per release (#310)
- **Parallel preflight** — frontend checks (lint, format, test, typecheck) now run concurrently instead of sequentially, cutting preflight time from ~15s to ~5s (#315)
- **Lazy-load SearchAddon** — search addon and search bar are now created on first use instead of at pane construction, reducing per-pane initialization overhead (#308)


## [0.18.6] - 2026-04-01

### Performance
- **Defer ANSI stripping to debounce window** — moved the complex 5-alternation ANSI regex from per-chunk feed() to the debounced runMatchers() call (every 100ms), removing it from the PTY hot path (#299)
- **Reusable write merge buffer** — flushWrites() now reuses a pre-allocated buffer instead of allocating a new Uint8Array every animation frame; also tracks pending bytes as a running total instead of O(n) iteration (#292)
- **DOM-diff sidebar pane list** — update existing DOM nodes in place instead of destroying and recreating with innerHTML on every render cycle (#297)
- **Cache file link regex results** — FileLinkProvider now caches regex results per line content (500-entry LRU), avoiding re-scanning the same lines during scroll (#323)
- **Process tree depth limit** — cap process tree traversal at 10 levels on both macOS and Windows to prevent runaway syscalls with Docker/tmux/nested shells (#291)
- **Parallelize startup I/O** — load config, themes, and session concurrently via Promise.all; session load overlaps with synchronous DOM setup (#318)
- **CI frontend on ubuntu** — switched frontend CI job from macos-latest to ubuntu-latest for ~10x cheaper and ~30-60s faster provisioning (#313)
- **Defer analytics** — moved Plausible script from synchronous `<head>` to deferred post-init loading, eliminating a network request from the critical startup path (#316)


## [0.18.5] - 2026-04-01

### Performance
- **Coalesce sidebar renders** — replaced 17 direct `renderTabList()` call sites with rAF-batched `scheduleRender()`, eliminating 3-5x redundant DOM updates per poll cycle (#287)
- **Debounce search input** — search now waits 150ms after the user stops typing before scanning the scrollback buffer, preventing per-keystroke full-buffer scans (#322)
- **Compact session save** — removed JSON pretty-printing from session persistence; machine-read file no longer wastes 30-50% on whitespace (#326)
- **Debounce config writes** — rapid config changes (font zoom, sidebar drag) are coalesced into a single disk write via 500ms debounce (#300)
- **Defer config on hidden tabs** — font size, theme, and config changes are deferred for hidden tabs and applied lazily when the tab becomes visible (#302)
- **Faster update install** — removed redundant version re-check before downloading, saving 500ms-2s of network latency (#319)
- **Optimized release binary** — added Cargo release profile with LTO, strip, and single codegen unit for 30-50% smaller binaries (#311)
- **Pause hidden gutter timers** — event gutter `setInterval` timers are now paused for hidden panes, eliminating invisible DOM updates and forced reflows (#289)


## [0.18.4] - 2026-04-01

### Performance
- **Eliminate false-positive sidebar re-renders** — removed elapsed time computation from tab snapshot change detection; snapshot now only differs on actual state transitions instead of every second (#286)
- **O(1) logger ring buffer** — replaced Array.splice() with a circular buffer using head pointer; eliminates O(n) element shifting on every overflow (#324)
- **Concurrent server health checks** — health checks now run via Promise.all instead of sequentially; worst-case crash detection time reduced from O(n × timeout) to O(timeout) (#306)
- **Memoize branch color hash** — cache branch→color mappings to avoid recomputing the hash on every render cycle (#304)
- **Faster release script** — replaced `cargo check` (30-60s full compilation) with `cargo generate-lockfile` (<2s) for Cargo.lock updates (#314)


## [0.18.3] - 2026-03-31

### Fixed
- **Landing page layout on wide screens** — constrained page to 1100px max-width so video and text stay grouped instead of drifting apart on large monitors (#283)
- **Landing page responsive breakpoints** — added phone breakpoint (480px) with tighter padding and scaled typography alongside the existing 860px tablet breakpoint (#283)

### Added
- **SEO essentials** — added robots.txt, sitemap.xml, and JSON-LD SoftwareApplication structured data to the landing page (#283)
- **Landing page accessibility** — semantic logo link, focus-visible outlines, aria-labels on video and logo, prefers-reduced-motion support, improved dim text contrast (#283)


## [0.18.2] - 2026-03-28

### Added
- **OSC 9;4 progress bar interception** — Clawterm now intercepts Claude Code's OSC 9;4 escape sequences for ground-truth working/idle detection, replacing fragile regex-based spinner matching. Status transitions are instant instead of delayed by 15-60s adaptive timeouts (#278)
- **OSC 9;2 notification interception** — intercepts Claude Code's desktop notification sequences to detect permission prompts and task completion directly from the escape sequence, not by parsing terminal text (#278)
- **`onStateChange` callback** — new Tab callback that fires on any activity/status transition, enabling instant sidebar re-renders for OSC-driven state changes without waiting for the 1s poll cycle (#278)
- **Demo video on landing page** — 1080p MP4 autoplay demo in the website hero section (closes #207)

### Changed
- **OSC-aware agents use 5s idle timeout** — agents that emit OSC 9;4 (like Claude Code) get a 5s idle detection threshold instead of the 15-60s adaptive heuristic, since absence of OSC progress = not working (#278)
- **Post-OSC idle check tightened to 1.5s** — when an OSC progress bar clears, a fast poll runs after 1.5s instead of waiting for the next regular poll cycle (#278)
- **`agentJustStarted` cleared by OSC** — the 3s "starting claude..." placeholder is replaced by real status as soon as the first OSC signal arrives (#278)

### Fixed
- **Spurious notification after checking idle tab** — added 2s grace period (`lastShownAt`) that suppresses notifications from poll cycles firing during the `show()` rAF pipeline. Grace period applied to all notification paths: poll-triggered, regex-matched, and OSC-based (#278)
- **False "working" status on fresh agent start** — `lastOutputAt` is now initialized to `Date.now()` when a new agent is first detected, preventing the adaptive timeout from seeing epoch-0 and misclassifying (#278)
- **OSC state reset on agent exit** — `oscProgressActive` and `analyzer.oscActive` are now cleared when the agent process exits, preventing stale state from affecting the next agent in the same pane (#278)
- **OSC 9;4 error state (state=2) surfaced** — API rate limits and agent errors reported via OSC progress are now shown as error activity instead of being silently treated as "working" (#278)


## [0.18.1] - 2026-03-28

### Changed
- **Sidebar tabs simplified** — removed activity dot icon and branch badge row ("↓0 ↑0 main") for a cleaner, more compact layout. Branch info remains in per-pane status lines (#263, #264)
- **Tighter sidebar spacing** — tab padding reduced (8→6px), tab list padding reduced (4→2px), close button shrunk from 20px to 16px for better space utilisation (#264, #265)
- **Notification badges relocated** — moved from the removed icon element to the tab entry itself, maintaining the same visual behavior (#264)

### Fixed
- **Warm background gaps** — sidebar divider and split pane dividers no longer show transparent gaps; they now use `--sidebar-bg` and `--terminal-bg` respectively (#266)
- **Off-brand blue on hover/focus** — added `accent-color: var(--sidebar-accent)` to `:root` and a global `:focus-visible` reset so native controls and focus rings use brand red instead of browser-default blue (#267, #268)
- **Theme accent token mismatch** — non-default presets (Nord, Dracula, etc.) now auto-derive `accentSubtle`, `accentBorder`, `accentMuted`, and `paneFocusOutline` from their own accent color instead of hardcoding red rgba values (#270)
- **Branch color palette** — replaced cold iOS-blue tones (`#0a84ff`, `#64d2ff`) with warmer alternatives (`#ff6b6b`, `#e0a4ff`); workspace panel now uses CSS custom property instead of inline style (#270)
- **Global letter-spacing** — `-0.01em` now applied to `body` so all UI text inherits it, not just a few elements (#270)
- **Unused `--brand` CSS variable removed** — `--sidebar-accent` is the single source of truth for accent color (#270)
- **Updater failure recovery** — failed updates now reset the update-found flag (allowing re-detection), open the GitHub releases page in the browser, and change the notice button to "Download" as a fallback (#269)


## [0.18.0] - 2026-03-28

### Added
- **Inter Variable font** for UI chrome — sidebar tabs, command palette, dialogs, and context menus now use a proportional font for better readability. Terminal content, branch badges, status bar, and keyboard shortcuts remain in JetBrains Mono (#261)
- **`--font-ui` / `--font-mono` CSS variables** — dual font system separating UI chrome from terminal/code elements
- **`--brand: #FF1744` token** — brand red available as a standalone CSS variable
- **`--anim-normal` (200ms) and `--anim-ease` (ease-out-quad) tokens** — refined motion system inspired by Linear's 160ms transitions
- **`--space-10` (32px) token** — extends the spacing scale for larger gaps
- **Inter OpenType features** — `cv01` and `ss03` enabled for refined character forms

### Changed
- **Brand update: Linear-inspired design language** — comprehensive visual identity overhaul guided by research into Linear's design system (#261)
- **Accent color unified to brand red** — `#0a84ff` (iOS blue) → `#FF1744` across sidebar accent, focus outlines, and all accent-derived tokens. App, docs, and logo now share one identity
- **Warm backgrounds** — pure `#000000` → `#101012` (sidebar) / `#131316` (terminal). Sidebar intentionally dimmer than content to create depth hierarchy
- **Mercury White text base** — `rgb(255,255,255)` → `rgb(244,245,248)` for softer, less harsh text
- **Negative letter-spacing** — `0.05em` → `-0.01em`, creating tighter, more refined typography
- **Variable font micro-weights** — `500/600` → `510/590` for medium/semibold, enabled by Inter Variable
- **Larger border radii** — `md: 6→8px`, `lg: 10→12px`, `window: 10→12px` for softer corners
- **Higher opacity scale** — `soft: 0.7→0.75`, `medium: 0.8→0.85`, `strong: 0.9→0.92` for better text contrast
- **Transition speed** — `0.12s` → `0.16s` (Linear's production sweet spot)
- **Wider scrollbar** — `4px` → `6px`
- **Deeper shadows** — `shadow-lg` now uses dual-layer shadow for more visible elevation
- **Darker modal overlay** — `rgba(0,0,0,0.4)` → `rgba(0,0,0,0.7)` for better modal isolation
- **Softer borders** — modal/context menu/toast borders reduced from `--text-12` to `--text-08`
- **Sidebar tabs** — smaller text (`font-md` → `font-base`), more vertical padding (`6px` → `8px`), dimmer inactive state
- **Status colors refined** — `#30d158` → `#34C759` green, `#ff453a` → `#FF3B30` red
- **All 10 theme presets updated** with new structural tokens
- **Landing page redesign** — Inter font, warm backgrounds, refined button/link styling, brand-consistent shadows, proper text selection highlighting, Linear-style underline treatment
- **Docs page updated** — matching warm backgrounds and Inter font


## [0.17.0] - 2026-03-28

### Added
- **Complete design token system** — 80 CSS variables covering every visual property: opacity (6 steps), spacing (9 steps), hover backgrounds (3 intensities), scrollbar styling, disabled state, animation timing, font weights, letter spacing, icon sizes, and border widths. A full rebrand requires editing only the theme preset file (#260, #253)
- **Hover tokens** — `--hover-subtle`, `--hover-default`, `--hover-strong` unify all hover backgrounds from one place
- **Scrollbar tokens** — `--scrollbar-thumb` and `--scrollbar-thumb-hover` sync tab list and terminal scrollbar styling
- **Disabled state token** — `--disabled-opacity` ensures consistent disabled appearance across all components
- **Text selection styling** — `::selection` now uses the accent color instead of browser default blue
- **Utility CSS classes** — `.hidden`, `.no-select`, `.pointer-none` replace inline style assignments
- **Plausible analytics** — privacy-friendly usage analytics on the docs site and in-app (#255)

### Changed
- **Landing page redesign** — minimal one-pager with demo video left, headline + GitHub button right. No scroll, no navbar. Logo top right (#259)
- **Sidebar branch badge** — git ahead/behind arrows now appear before the branch name (`↓2 ↑15 feature-branch`), added missing behind (↓) arrow, removed noisy change count (#258)
- **Token consolidation** — removed 28 unused/redundant variables (107 → 80), merged similar opacity steps, eliminated single-use indirection tokens, trimmed text-alpha scale from 20 to 17 steps
- **Removed all pulse/breathe animations** — activity states use static color/opacity instead of CPU-intensive infinite animations. Cleaner look, better performance
- **All theme presets updated** — every preset now includes the full token set (hover, scrollbar, disabled, font-weight, letter-spacing, icon sizes)

### Fixed
- **Duplicate notifications on agent completion** — removed redundant `onNeedsAttention` notification path so each event produces exactly one notification (#256)
- **Notification click-to-navigate** — clicking a notification now focuses the window and switches to the correct tab (#256)
- **Scroll position lost during agent output** — viewport no longer jumps when scrolled up while an AI agent streams output (#257)
- **Plausible not detecting** — added script to docs site pages and fixed CSP for inline init block (#255)
- **Inconsistent scrollbar colors** — tab list and terminal scrollbars now share the same thumb colors
- **Inconsistent disabled states** — all disabled elements now use the same opacity token
- **Inconsistent hover backgrounds** — all hover states now use semantic intensity tokens
- **Inconsistent dot sizes** — notification badges, status dots, and event markers unified to consistent sizes

## [0.16.9] - 2026-03-27

### Added
- **Plausible analytics** — privacy-friendly usage analytics via Plausible, with CSP updated to allow the external script (#255)

### Changed
- **Sidebar branch badge redesign** — git ahead/behind arrows now appear before the branch name (`↓2 ↑15 feature-branch`), added missing behind (↓) arrow, removed noisy change count (#258)

### Fixed
- **Duplicate notifications on agent completion** — agent events were firing notifications through two separate code paths simultaneously; removed the redundant `onNeedsAttention` path so each event produces exactly one notification (#256)
- **Notification click-to-navigate** — clicking a notification now correctly focuses the window and switches to the tab where the agent was running. Fixed by preferring the Web Notification API (reliable `onclick` in Tauri webviews) over the Tauri native plugin (whose `onAction` doesn't fire on desktop) (#256)
- **Scroll position lost during agent output** — viewport no longer jumps when scrolled up while an AI agent streams output. Fixed by saving scroll position before `terminal.write()` and restoring it in the write callback after xterm.js finishes parsing (#257)

## [0.16.8] - 2026-03-26

### Added
- **Custom theme files** — drop `.json` theme files into `~/.config/clawterm/themes/` and they appear in the theme picker alongside built-in presets. Custom themes are validated and merged onto defaults to prevent missing-field errors (#253)
- **"Save Theme as File"** palette command — exports the current resolved theme to the themes directory for sharing (#253)
- **"Open Config File"** palette command — opens `config.json` in the system default editor (#253)
- **"Reset Theme to Default"** palette command — reverts to Default Dark and clears all overrides (#253)
- **"Copy Current Theme"** palette command — copies the full resolved theme JSON to clipboard (#253)
- **Theme picker divider** — "Custom" section header separates built-in presets from user themes in the picker

### Changed
- **Light theme support** — the white-alpha scale (`--w-*`) is renamed to a semantic text-alpha scale (`--text-*`) driven by a new `textColor` property in UITheme. Dark themes use `"255, 255, 255"`, light themes use `"0, 0, 0"` — Solarized Light now has correct text contrast (#253)

## [0.16.7] - 2026-03-25

### Added
- **Split pane choice dialog** — `Cmd+D` / `Cmd+Shift+D` now shows a lightweight dialog: press left arrow for a new worktree split, right arrow for a same-branch split. If not in a git repo, splits on same branch directly. Also adds direct "Split → Worktree" and "Split → Same Branch" palette commands (#254)
- **Design token system** — all 60 hardcoded `font-size` values replaced with 8 semantic tokens (`--font-2xs` through `--font-2xl`) derived from a configurable base size (`theme.ui.fontSize`). All 31 hardcoded `border-radius` values replaced with 3 tokens (`--radius-sm`, `--radius-md`, `--radius-lg`). Surface colors, shadows, and accent-derived colors now configurable via `theme.ui.*` (#253)
- **10 built-in theme presets** — Default Dark, Midnight, Solarized Dark, Solarized Light, Dracula, Nord, Gruvbox Dark, Tokyo Night, Catppuccin Mocha, Rosé Pine. Select via `theme.preset` in config or the new "Switch Theme" command in the palette (#253)
- **Live theme picker** — "Switch Theme" command in the command palette lets you arrow through presets with instant live preview on the terminal and UI. Enter to persist, Escape to revert (#253)

## [0.16.6] - 2026-03-24

### Added
- **Cmd+↑ / Cmd+↓ to switch tabs** — navigate to the tab above or below in the sidebar, wraps around at edges (#252)


## [0.16.5] - 2026-03-24

### Changed
- **JetBrains Mono everywhere** — switched the entire app (UI, terminal, code elements) to JetBrains Mono Variable, bundled via @fontsource-variable/jetbrains-mono (40KB woff2)
- **New SVG branch icon** — replaced the obscure `⎇` (U+2387) Unicode symbol with a proper git-branch SVG icon rendered via CSS mask-image, inheriting text color at any size
- **Sidebar tab overhaul** — cleaner visual hierarchy with unified 10px metadata size, consistent left-alignment under title, dimmer inactive states, and activity-colored pane status lines (orange for waiting, red for errors, green for servers)
- **Design system consistency pass** — standardized border-radius tiers (eliminated 3px/5px outliers), unified surface colors across overlays, normalized border colors on floating elements, replaced `transition: all` with specific properties
- **Centralized z-index system** — all stacking values now use CSS variables (`--z-pane-overlay` through `--z-confirm`), defined in `:root`
- **New color tokens** — added `--accent-subtle`, `--accent-border`, `--accent-muted`, `--red-muted`, `--orange-muted`, `--surface-badge` for maintainable accent-at-opacity colors
- **Modal CSS deduplication** — tab switcher now shares base classes with command palette, removing ~60 lines of duplicate CSS
- **Unified modal buttons** — worktree and close-confirm dialogs now share consistent button styling; added `.close-confirm-btn.primary` class for non-destructive confirm actions

### Fixed
- Paste confirm dialog used inline styles for width and button color — now uses proper CSS classes
- Missing `font-family: inherit` on buttons, inputs, selects, and textareas — added to global reset
- 3 different sans-serif font stacks and 2 different monospace stacks across the app — unified to single font
- `--font-mono` CSS variable was referenced but never defined — resolved by switching to JetBrains Mono
- ~17 redundant CSS variable fallback values (e.g., `var(--sidebar-accent, #0a84ff)`) — removed, since variables are always defined in `:root`
- Shortcut hints (`⌘1`, `⌘2`...) competed visually with tab titles — dimmed to near-invisible until needed
- Worktree indicator changed from prefix `◇` to suffix `◈` for better readability alongside the branch icon


## [0.16.4] - 2026-03-24

### Changed
- Split terminal (`Cmd+D` / `Cmd+Shift+D`) now auto-creates a worktree from the current branch without showing a dialog — branch is named `<branch>-wt-1`, `-wt-2`, etc.

### Added
- Version label displayed in the bottom-right status bar (to the left of the keyboard icon)


## [0.16.3] - 2026-03-24

### Changed
- Complete CSS variable system: all colors, surfaces, shadows, and transitions are now tokenized
- Added 4 new white-alpha tokens (`--w-45`, `--w-55`, `--w-75`, `--w-95`) for finer opacity control
- Added `--surface-modal`, `--surface-panel`, `--overlay-backdrop` variables for consistent modal/overlay styling
- Added `--shadow-sm` and `--shadow-lg` shadow tokens
- All 13 hardcoded transition durations now use `var(--transition-speed)` — single control point for animation feel
- Replaced all remaining inline `rgba(255,255,255,...)` values with `--w-*` tokens
- Replaced hardcoded modal/overlay backgrounds (6 instances) with surface variables
- Replaced hardcoded box-shadows (6 instances) with shadow tokens
- Close-confirm and update buttons now use `var(--color-red)` / `var(--color-green)` instead of hardcoded hex


## [0.16.2] - 2026-03-24

### Changed
- Split terminal (`Cmd+D` / `Cmd+Shift+D`) now always creates an isolated worktree — every pane gets its own branch, ready for independent agents
- Removed redundant "Split to Branch" keybinding (`Cmd+Shift+\`) — split actions now handle this by default
- Command palette "Split Right" / "Split Down" entries route through worktree dialog

### Fixed
- **Critical**: Fixed 16 self-referential `--w-*` CSS variables that resolved to nothing, breaking 128 CSS properties across the entire UI (invisible text, missing borders, broken visual hierarchy)
- Synced CSS fallback colors with config.ts defaults — eliminated flash of wrong colors on initial paint (`--color-orange`, `--color-red`, `--color-green`, sidebar tab text)
- Improved text contrast for WCAG compliance: bumped `--w-30` usages to `--w-40`, `--w-35` to `--w-50` for status bar, placeholders, labels, workspace panel, and dialog text
- Replaced 8 hardcoded `color: white` with `var(--w-90)` for consistent theming
- Added `--surface-elevated` CSS variable, replacing 3 hardcoded `rgb(30,30,30)` backgrounds (search bar, context menu, worktree dialog input)
- Replaced hardcoded `rgba(255,255,255,0.25)` on disabled menu items with `var(--w-35)` token
- Increased worktree-existing item opacity from 0.5 to 0.6 for better readability


## [0.16.1] - 2026-03-24

### Changed
- Codebase refactoring: extracted 7 new modules from the 3 largest files, reducing terminal-manager.ts (1,756→1,568), tab.ts (1,520→1,344), pane.ts (1,187→973), process_info.rs (992→561), config.ts (628→493) — total 937 lines removed from large files
- CSS maintainability: introduced white-alpha variable scale (`--w-04` through `--w-90`), replacing 112 hardcoded `rgba(255,255,255,...)` values with semantic tokens

### Fixed
- Rust CI: tests for git_info and project_info now live in their correct extracted modules (was breaking `cargo test` after #247)
- Prettier formatting issues that caused v0.16.0 release build to fail


## [0.16.0] - 2026-03-24

### Added
- Per-pane branch isolation via git worktrees — each terminal pane within a tab can independently be on a different git branch (#240)
- "Split to Branch" action (`Cmd+Shift+\`) — opens branch picker, creates worktree, splits focused pane into it
- "Split to Branch…" command in command palette
- Per-pane branch badge overlay (top-right corner of each pane) — shows branch name with color coding, diamond indicator for worktrees
- Sidebar branch badge shows `+N` when a tab has panes on multiple branches (e.g., `⎇ main +2`)
- Pane status lines in sidebar show `[branch]` prefix when panes in a tab are on different branches
- Workspace panel shows `+N` for additional branches per tab with tooltip listing them
- Per-pane worktree cleanup on pane close (when `autoCleanup` is enabled)
- Per-pane worktree metadata in session persistence — worktree state survives app restart
- Branch change detection — warns when `git checkout` in a shared directory affects sibling panes, suggests Split to Branch for isolation
- Worktree dialog now supports custom title, button label, and optional agent launcher (used by Split to Branch)

### Changed
- Git branch/status tracking moved from tab-level to pane-level — each pane independently tracks its git state
- Git status polling now runs for all panes, not just the focused pane
- Tab-level `gitBranch`/`gitStatus` derived from focused pane for backward compatibility
- `restartShell` preserves worktree metadata across shell restart
- Both `openWorktreeDialog` and `openSplitToBranchDialog` use stored `repoRoot` when in a worktree, avoiding incorrect `find_repo_root` results
- Tab close cleanup now iterates all per-pane worktrees (with deduplication) in addition to legacy tab-level worktrees

### Fixed
- Branch change warning toast no longer fires duplicate toasts when multiple panes in the same directory detect the change simultaneously
- Sidebar re-renders correctly when a pane's branch changes (added `gitBranch` to snapshot key)
- `splitToBranch` detects failed splits and cleans up orphaned worktrees instead of stamping metadata on the wrong pane
- Legacy session migration now applies tab-level worktree metadata to the first pane (not the last-created pane after restore)


## [0.15.2] - 2026-03-23

### Fixed
- Workspace panel dots always showed branch color instead of status color (green/blue/orange) — inline style overrode CSS classes
- Workspace panel not updating when only staged, untracked, or ahead counts changed — change detection key was incomplete
- Tab sidebar branch badges showing stale git status — `computeTabSnapshot` now includes all gitStatus fields for change detection


## [0.15.1] - 2026-03-23

### Changed
- Test suite audit and structural improvements — 98 → 124 TypeScript tests (#239)
- `session.test.ts` rewritten with proper type imports, worktree field tests, and nested describe blocks (#239)
- `config-validation.test.ts` now asserts warning logs instead of silently suppressing them (#239)

### Added
- `computeFolderTitle` tests: project name, folder name, home, root, priority (#239)
- `computePaneStatusLine` tests: idle, agent starting, waiting, working, server, error, process (#239)
- `computeSubtitle` test for `lastAction` display when agent is running (#239)
- `matchesKeybinding` tests for shifted-key variants (cmd+= matching +, cmd+- matching _) (#239)
- `validateConfig` tests for worktree config section preservation and defaults (#239)
- Session tests for worktree metadata fields, pin/mute/manualTitle, and Session structure (#239)


## [0.15.0] - 2026-03-23

### Added
- Multi-branch multi-agent workspace — run parallel AI agents on isolated git branches from a single project (#233)
- Git worktree management commands in Rust backend: create, remove, list worktrees, list branches, find repo root, prune stale references (#233)
- Branch picker dialog (Cmd+Shift+N) — search local/remote branches, create new branches, optional agent auto-launch (#233)
- Workspace overview panel (Cmd+Shift+B) — toggleable sidebar showing all tabs with branch status, agent state, and last action (#233)
- Jump to Branch shortcut (Cmd+Shift+G) — branch-focused tab switcher for quick navigation between worktree tabs (#233)
- Git branch badges in tab sidebar — color-coded by status (green=clean, blue=modified, orange=staged) with change counts and ahead/behind arrows (#233)
- Enhanced status bar git display — shows change counts, ahead/behind arrows, and color-coded status (#233)
- Deterministic branch colors from a fixed palette — consistent color per branch name across sessions (#233)
- Worktree diamond indicator on branch badges for tabs running in git worktrees (#233)
- Worktree config section: `worktree.directory`, `postCreateHooks`, `autoCleanup`, `defaultAgent` (#233)
- Session persistence for worktree metadata — `worktreePath` and `repoRoot` survive restarts (#233, #235)
- Branch name in tab switcher (Cmd+P) — searchable by branch, shown alongside tab title (#233)
- Branch context in system notifications — "claude on feature/auth is waiting for input" (#233)
- Command palette entries: New Agent Tab on Branch, Toggle Workspace Panel, Jump to Branch (#233)
- Auto-cleanup worktrees on tab close when `worktree.autoCleanup` is enabled (#233)
- 13 new TypeScript tests for branchColor, GitStatusInfo, and worktree state (#233)
- 3 new Rust tests for get_git_status (clean repo, dirty repo, non-git directory) (#233)

### Fixed
- `get_git_branch` now supports git worktrees where `.git` is a file containing `gitdir: <path>` (#233)
- `get_git_status` uses `--no-optional-locks` to prevent index contention during polling (#236)
- `list_branches` correctly distinguishes local branches containing `/` (e.g., `feature/auth`) from remote branches by querying actual remote names (#234)
- Worktree metadata (`worktreePath`, `repoRoot`) persisted across session restarts instead of being lost (#235)
- Branch picker hides base branch selector when selecting existing branches (only shown for new branch creation) (#237)


## [0.14.0] - 2026-03-22

### Changed
- Upgrade xterm.js v5.5.0 → v6.0.0 — synchronized output (DEC mode 2026), overhauled viewport/scrollbar (VS Code SmoothScrollableElement), 7+ scroll teleport fixes, smooth scroll frame limiting, ESM native, memory leak fixes (#227)
- Upgrade @xterm/addon-fit 0.10.0 → 0.11.0 and @xterm/addon-web-links 0.11.0 → 0.12.0 for v6 compatibility (#227)
- Upgrade TypeScript 5.5 → 5.9.3 — V8 compile caching, `import defer`, stricter type checks (#227)
- Update scrollbar CSS for xterm.js v6 SmoothScrollableElement overlay scrollbar (#227)

### Fixed
- Terminal scrolling to top of scrollback while waiting for agent response — direct `terminal.write()` calls now use write callbacks for scroll-safe position restoration (#227)
- Unreliable `userScrolledUp` tracking — add native `.xterm-viewport` scroll listener since `terminal.onScroll` only fires on buffer growth, not user scroll (xtermjs/xterm.js#3201) (#227)


## [0.13.4] - 2026-03-21

### Added
- Tab renaming via double-click on title or "Rename Tab" in context menu (#215)
- First-run onboarding — new users see a welcome message with key shortcuts on first launch (#214)
- Confirmation dialog for bulk close actions (Close Others, Close to Right) when tabs have running processes (#216)
- Config option `updates.autoCheck` and `updates.checkIntervalMs` to disable or adjust auto-update checks (#219)
- Config schema versioning with `configVersion` field and migration framework for safe upgrades (#221)
- In-memory debug log buffer (2000 entries) with "Copy Debug Log" command in command palette (#222)
- Tab pin, mute, and manual title state persisted across restarts in session.json (#223)
- Checksum verification (SHA256SUMS.txt) in install.sh for download integrity (#217)
- Windows install script `install.ps1` with checksum verification (#218)
- Uninstall support via `install.sh --uninstall` and `install.ps1 --uninstall` (#225)
- ARIA labels on activity icons, aria-live on search count (#211)
- WAI-ARIA combobox+listbox pattern on command palette and tab switcher (#212)
- ARIA alertdialog role on close confirmation dialog (#213)

### Fixed
- WCAG AA color contrast — sidebar text, status lines, icons, and hints all meet minimum ratios (#210)
- Update check and install errors now surface to users via toasts instead of silent debug logs (#220)


## [0.13.3] - 2026-03-21

### Added
- Documentation page (`docs/docs.html`) with installation, keyboard shortcuts, configuration, troubleshooting, and build instructions (#195)
- ARCHITECTURE.md documenting data flow, polling loop, file responsibilities, and split pane model (#208)
- Twitter card, Open Graph URL, canonical link, and theme-color meta tags on landing page (#193)
- Explanatory copy on landing page — visitors now see what Clawterm does (#191)
- Platform-aware download button — detects macOS vs Windows and labels accordingly (#194)
- Video fallback on landing page — shows logo when demo.mp4 is not yet available (#190)
- Package metadata (description, homepage, repository, author, license, keywords) in package.json and Cargo.toml (#205)
- GitHub repository topics for discoverability (#209)
- `good first issue` and `help wanted` labels on appropriate issues (#202)
- 18 new tests for adaptive idle detection, working patterns, and session types — total 85 tests (#199)

### Changed
- Extract `tab-polling.ts` module from `tab.ts` — adaptive timeout and working-pattern logic now testable independently (#198)
- Replace silent `.catch(() => {})` with debug logging across 6 catch handlers (#197)
- Enable `@typescript-eslint/no-explicit-any` ESLint rule — all 10 `any` usages replaced with proper types (#196)
- Update CONTRIBUTING.md with Windows prerequisites and platform-neutral wording (#206)
- Consolidate redundant GitHub labels: `feature` → `enhancement`, `documentation` → `docs` (#204)
- Disable GitHub Discussions (empty, unused) and remove links (#203)


## [0.13.2] - 2026-03-21

### Fixed
- Fix remaining terminal not resizing after closing a split pane — use forceFit to bypass output-activity deferral (#188)
- Remove speculative `agent-maybe-idle` state — tab status no longer shows uncertain "possibly idle" or "idle?" labels (#189)
- Remove overly broad `server-port-alt` matcher that falsely detected servers from any "port NNNN" text (#189)
- Anchor `claude-tool-use` matcher to start-of-line to prevent false positives from generic log output (#189)

### Changed
- Tab status now reflects the focused pane instead of highest-priority across all panes — what you see matches what the sidebar shows (#189)
- Raise adaptive idle thresholds (15s min, 20s default) to reduce false waiting transitions during normal agent pauses (#189)


## [0.13.1] - 2026-03-21

### Fixed
- Fix `navigator is not defined` crash in test environment — guard platform detection with typeof check (#187)
- Fix Windows clippy build failure — use `ProcessRefreshKind::nothing()` instead of removed `::new()` for sysinfo 0.33 (#185)
- Remove unused `HANDLE` import in Windows process_info module (#185)

### Changed
- Redesign landing page — video-first hero, monospace feature lines, minimal CTA, removed feature cards and install steps (#187)
- Update README and website for Windows support — dual-platform install, keyboard shortcuts, config paths, troubleshooting (#186)


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

[Unreleased]: https://github.com/clawterm/clawterm/compare/v0.18.8...HEAD
[0.18.8]: https://github.com/clawterm/clawterm/compare/v0.18.7...v0.18.8
[0.18.7]: https://github.com/clawterm/clawterm/compare/v0.18.6...v0.18.7
[0.18.6]: https://github.com/clawterm/clawterm/compare/v0.18.5...v0.18.6
[0.18.5]: https://github.com/clawterm/clawterm/compare/v0.18.4...v0.18.5
[0.18.4]: https://github.com/clawterm/clawterm/compare/v0.18.3...v0.18.4
[0.18.3]: https://github.com/clawterm/clawterm/compare/v0.18.2...v0.18.3
[0.18.2]: https://github.com/clawterm/clawterm/compare/v0.18.1...v0.18.2
[0.18.1]: https://github.com/clawterm/clawterm/compare/v0.18.0...v0.18.1
[0.18.0]: https://github.com/clawterm/clawterm/compare/v0.17.0...v0.18.0
[0.16.6]: https://github.com/clawterm/clawterm/compare/v0.16.5...v0.16.6
[0.16.5]: https://github.com/clawterm/clawterm/compare/v0.16.4...v0.16.5
[0.16.4]: https://github.com/clawterm/clawterm/compare/v0.16.3...v0.16.4
[0.16.3]: https://github.com/clawterm/clawterm/compare/v0.16.2...v0.16.3
[0.16.2]: https://github.com/clawterm/clawterm/compare/v0.16.1...v0.16.2
[0.16.1]: https://github.com/clawterm/clawterm/compare/v0.16.0...v0.16.1
[0.16.0]: https://github.com/clawterm/clawterm/compare/v0.15.2...v0.16.0
[0.15.2]: https://github.com/clawterm/clawterm/compare/v0.15.1...v0.15.2
[0.15.1]: https://github.com/clawterm/clawterm/compare/v0.15.0...v0.15.1
[0.15.0]: https://github.com/clawterm/clawterm/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/clawterm/clawterm/compare/v0.13.4...v0.14.0
[0.13.4]: https://github.com/clawterm/clawterm/compare/v0.13.3...v0.13.4
[0.13.3]: https://github.com/clawterm/clawterm/compare/v0.13.2...v0.13.3
[0.13.2]: https://github.com/clawterm/clawterm/compare/v0.13.1...v0.13.2
[0.13.1]: https://github.com/clawterm/clawterm/compare/v0.13.0...v0.13.1
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
