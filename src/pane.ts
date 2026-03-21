import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { ImageAddon } from "@xterm/addon-image";
import { invoke } from "@tauri-apps/api/core";
import { spawn, type IPty } from "tauri-pty";
import type { Config } from "./config";
import { OutputAnalyzer } from "./output-analyzer";
import type { OutputEvent, OutputMatcher } from "./matchers";
import { DEFAULT_MATCHERS } from "./matchers";
import { type PaneState, createDefaultPaneState } from "./tab-state";
import { SearchBar } from "./search-bar";
import { logger } from "./logger";
import { showToast } from "./toast";
import { showContextMenu } from "./context-menu";
import { FileLinkProvider } from "./file-link-provider";
import { trapFocus, isPrimaryMod, isWindows } from "./utils";

export type KeyHandler = (e: KeyboardEvent) => boolean;

let paneCounter = 0;

/**
 * A single terminal pane — owns a Terminal + PTY + output analysis.
 * Multiple Panes can live inside a single Tab via splits.
 */
export class Pane {
  readonly id: string;
  readonly terminal: Terminal;
  readonly fitAddon: FitAddon;
  readonly searchAddon: SearchAddon;
  readonly element: HTMLDivElement;
  private pty: IPty | null = null;
  ptyPid: number | null = null;
  /** Internal pty session handle (NOT an OS PID) — used for IPC calls to the plugin */
  ptyHandle: number | null = null;
  private disposed = false;
  private config: Config;
  readonly analyzer: OutputAnalyzer;
  private searchBar: SearchBar | null = null;
  private cwd: string | undefined;
  lastFullCwd: string | null = null;
  private scrollPill: HTMLDivElement | null = null;
  private pasteOverlay: HTMLDivElement | null = null;
  private webglAddon: WebglAddon | null = null;
  private imageAddon: { dispose(): void } | null = null;
  private isScrolledUp = false;
  /** True when the user intentionally scrolled up (not from programmatic scroll).
   *  Persists across tab switches. Cleared when the user scrolls to bottom or
   *  clicks the scroll pill. Used to prevent auto-scroll-to-bottom on fit(). */
  private userScrolledUp = false;
  /** True while fit() is performing a reflow + scroll restore — suppresses onScroll side-effects */
  private fittingNow = false;
  /** True while the pane's scroll position is locked during tab show/hide transitions.
   *  While locked, onScroll is suppressed, fitCore() uses the locked position, and
   *  flushWrites() corrects any scroll corruption after each write.  The lock is
   *  acquired on hide() and released only after all destabilizing operations (fit,
   *  write, WebGL) complete in show(). (#184) */
  private scrollLocked = false;
  /** The authoritative viewportY saved when the scroll lock was acquired */
  private lockedViewportY: number | null = null;
  /** Pending timer for deferred WebGL activation during active output */
  private deferredWebglTimer: ReturnType<typeof setTimeout> | null = null;
  /** RAF-based write batching — queues PTY data and flushes once per frame to
   *  prevent terminal.write() from racing with fitAddon.fit() mid-reflow */
  private pendingWriteData: Uint8Array[] = [];
  private writeRafId = 0;
  /** Whether the owning Tab is currently visible.  When false, writes are
   *  queued but not flushed via rAF — they accumulate and are flushed in
   *  bulk when the tab becomes visible.  This dramatically reduces CPU and
   *  xterm.js processing for background tabs under heavy multi-tab load. */
  private tabVisible = true;
  /** Max bytes to accumulate for a hidden tab before discarding oldest data.
   *  Prevents unbounded memory growth when a background tab produces heavy output. */
  private static readonly MAX_HIDDEN_PENDING_BYTES = 512 * 1024; // 512KB
  private eventGutter: HTMLDivElement | null = null;
  private gutterTimer: ReturnType<typeof setInterval> | null = null;
  private readonly ac = new AbortController();
  private readonly disposables: { dispose(): void }[] = [];

  /** Per-pane activity state (updated by Tab during polling) */
  state: PaneState = createDefaultPaneState();
  /** Foreground PID from last poll — used to skip redundant CWD lookups */
  lastFgPid = 0;
  /** Timestamp of the last poll that saw a running (non-idle) process */
  lastRunningAt = 0;
  /** Timestamp of last data received from the PTY — used to detect idle agents */
  lastOutputAt = 0;
  /** Rolling history of significant output gaps (ms) for adaptive idle timeout */
  outputGaps: number[] = [];
  /** Timestamp when the current output gap started (0 if output is active) */
  private lastOutputGapStart = 0;

  exitCode: number | null = null;
  onExit: ((exitCode: number) => void) | null = null;
  onOutputEvent: ((event: OutputEvent) => void) | null = null;
  /** Fires when the shell sets the terminal title (OSC sequence) — used for instant CWD detection */
  onTerminalTitle: ((title: string) => void) | null = null;
  onFocus: (() => void) | null = null;

  constructor(config: Config, keyHandler?: KeyHandler, cwd?: string) {
    paneCounter++;
    this.id = `pane-${paneCounter}`;
    this.config = config;
    this.cwd = cwd;

    // Build matchers: defaults + user-defined
    const matchers: OutputMatcher[] = [...DEFAULT_MATCHERS];
    for (const um of config.outputAnalysis?.customMatchers ?? []) {
      try {
        matchers.push({
          id: um.id,
          pattern: new RegExp(um.pattern, "i"),
          type: um.type,
          cooldownMs: um.cooldownMs ?? 5000,
        });
      } catch (e) {
        logger.warn(`Invalid regex in custom matcher "${um.id}": ${e instanceof Error ? e.message : e}`);
      }
    }

    this.analyzer = new OutputAnalyzer(config.outputAnalysis?.bufferSize ?? 4096, matchers);

    this.terminal = new Terminal({
      cursorBlink: config.cursor.blink,
      cursorStyle: config.cursor.style,
      fontSize: config.font.size,
      fontFamily: config.font.family,
      lineHeight: config.font.lineHeight,
      scrollback: config.scrollback,
      theme: config.theme.terminal,
      allowProposedApi: true,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
    });

    // Intercept keys before xterm processes them
    this.terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (keyHandler && !keyHandler(e)) {
        return false;
      }

      // Windows: Ctrl+C copies when text is selected, passes through as SIGINT when not.
      // This matches Windows Terminal behavior and avoids the Ctrl+C conflict.
      if (isWindows && e.type === "keydown" && e.ctrlKey && e.key === "c" && !e.shiftKey && !e.altKey) {
        const selection = this.terminal.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection).catch(() => {});
          this.terminal.clearSelection();
          e.preventDefault();
          return false;
        }
        return true; // pass Ctrl+C through to PTY as interrupt
      }

      if (e.type === "keydown" && isPrimaryMod(e) && this.pty && !this.disposed) {
        if (e.key === "Backspace") {
          e.preventDefault();
          this.pty.write("\x15");
          return false;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          this.pty.write("\x01");
          return false;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          this.pty.write("\x05");
          return false;
        }
        if (e.key === "k") {
          e.preventDefault();
          this.terminal.clear();
          // Clear stale event markers after terminal clear
          this.analyzer.eventHistory.length = 0;
          this.renderGutter();
          return false;
        }
      }

      // Shift+Enter → send CSI u sequence so TUI apps (Claude Code) can
      // distinguish it from plain Enter and insert a newline.
      if (
        e.type === "keydown" &&
        e.key === "Enter" &&
        e.shiftKey &&
        !isPrimaryMod(e) &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        if (this.pty && !this.disposed) {
          e.preventDefault();
          this.pty.write("\x1b[13;2u");
          return false;
        }
      }

      if (e.type === "keydown" && e.altKey && !isPrimaryMod(e) && !e.ctrlKey && this.pty && !this.disposed) {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          this.pty.write("\x1bb");
          return false;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          this.pty.write("\x1bf");
          return false;
        }
        if (e.key === "Backspace") {
          e.preventDefault();
          this.pty.write("\x17");
          return false;
        }
      }

      return true;
    });

    this.fitAddon = new FitAddon();
    this.searchAddon = new SearchAddon();
    const unicodeAddon = new Unicode11Addon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(
      new WebLinksAddon((_event, uri) => {
        openUrl(uri).catch((e) => logger.debug("Failed to open URL:", e));
      }),
    );
    this.terminal.loadAddon(this.searchAddon);
    this.terminal.loadAddon(unicodeAddon);
    this.terminal.unicode.activeVersion = "11";

    this.element = document.createElement("div");
    this.element.className = "pane";

    // Fire onFocus when this pane's element receives focus (click/tab)
    this.element.addEventListener("focusin", () => this.onFocus?.(), { signal: this.ac.signal });

    // Copy selection to clipboard on select
    if (config.copyOnSelect) {
      this.disposables.push(
        this.terminal.onSelectionChange(() => {
          const selection = this.terminal.getSelection();
          if (selection) {
            navigator.clipboard.writeText(selection).catch((e) => {
              logger.debug("Clipboard write failed:", e);
              showToast("Failed to copy to clipboard", "error");
            });
          }
        }),
      );
    }

    // Right-click context menu with Copy / Paste
    this.element.addEventListener(
      "contextmenu",
      (e: MouseEvent) => {
        e.preventDefault();
        const selection = this.terminal.getSelection();
        showContextMenu(e.clientX, e.clientY, [
          {
            label: "Copy",
            disabled: !selection,
            action: () => {
              if (selection)
                navigator.clipboard.writeText(selection).catch((e) => {
                  logger.debug("Clipboard write failed:", e);
                  showToast("Failed to copy to clipboard", "error");
                });
            },
          },
          {
            label: "Paste",
            separator: true,
            action: () => {
              navigator.clipboard
                .readText()
                .then((text) => {
                  if (!text || this.disposed) return;
                  if (text.includes("\n") && !this.terminal.modes.bracketedPasteMode) {
                    this.showPasteConfirm(text);
                  } else {
                    this.terminal.paste(text);
                  }
                })
                .catch((e) => {
                  logger.debug("Clipboard read failed:", e);
                  showToast("Failed to read clipboard", "error");
                });
            },
          },
          {
            label: "Clear",
            separator: true,
            action: () => {
              this.terminal.clear();
              this.analyzer.eventHistory.length = 0;
              this.renderGutter();
            },
          },
        ]);
      },
      { signal: this.ac.signal },
    );

    // Intercept paste to confirm multi-line text before sending to terminal
    this.element.addEventListener(
      "paste",
      (e: ClipboardEvent) => {
        const text = e.clipboardData?.getData("text");
        if (!text || this.disposed) return;
        // Skip if single line or bracketed paste mode is active (app handles it)
        if (!text.includes("\n") || this.terminal.modes.bracketedPasteMode) return;
        e.preventDefault();
        e.stopPropagation();
        this.showPasteConfirm(text);
      },
      { signal: this.ac.signal },
    );

    // Listen for terminal title changes (OSC 0/2 from the shell).
    // Zsh/oh-my-zsh set the title on every prompt, giving us instant CWD detection.
    this.disposables.push(
      this.terminal.onTitleChange((title) => {
        this.onTerminalTitle?.(title);
      }),
    );

    // Wire output analyzer events
    if (config.outputAnalysis?.enabled !== false) {
      this.analyzer.onEvent((event) => {
        logger.debug(
          `[pane.analyzerEvent] pane=${this.id} type=${event.type} detail=${event.detail.slice(0, 60)}`,
        );
        this.onOutputEvent?.(event);
      });
    }
  }

  async start(): Promise<boolean> {
    this.terminal.open(this.element);

    // Clamp macOS trackpad momentum/inertial scrolling during active output.
    // Momentum events (rapid wheel events with decaying deltaY) fight with
    // xterm.js auto-scroll-to-bottom and cause erratic viewport jumps.
    this.terminal.attachCustomWheelEventHandler((ev: WheelEvent) => {
      const outputAge = Date.now() - this.lastOutputAt;
      if (outputAge < 500 && Math.abs(ev.deltaY) < 4) {
        // During active output, suppress low-delta wheel events (momentum tails).
        // Real intentional scrolls have higher deltaY values.
        return false;
      }
      return true;
    });

    // WebGL + ImageAddon are loaded lazily via activateWebGL() / deactivateWebGL()
    // so that only the active tab's panes consume GPU contexts.  The Tab calls
    // activateWebGL() in show() and deactivateWebGL() in hide().
    // For the initial tab (already visible), activate now.
    this.activateWebGL();

    // Register file path link provider (click to copy path)
    this.terminal.registerLinkProvider(new FileLinkProvider(this.terminal));

    await new Promise((r) => requestAnimationFrame(r));
    // Guard against zero-dimension elements (e.g. display:none parent) —
    // fit() on a zero-sized element can produce NaN cols/rows
    if (this.element.offsetWidth > 0 && this.element.offsetHeight > 0) {
      this.fitAddon.fit();
    }

    // Ensure valid dimensions — xterm.js may produce 0 or NaN on hidden elements
    const cols = this.terminal.cols > 0 && Number.isFinite(this.terminal.cols) ? this.terminal.cols : 80;
    const rows = this.terminal.rows > 0 && Number.isFinite(this.terminal.rows) ? this.terminal.rows : 24;

    const spawnOpts: Record<string, unknown> = {
      cols,
      rows,
      name: "xterm-256color",
    };
    if (this.cwd) spawnOpts.cwd = this.cwd;

    try {
      this.pty = spawn(this.config.shell, this.config.shellArgs, spawnOpts as any);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Failed to start shell: ${this.config.shell}`, "error", 8000);
      logger.warn("PTY spawn failed:", e);
      this.terminal.writeln(`\r\n\x1b[31m  Failed to start shell: ${this.config.shell}\x1b[0m`);
      this.terminal.writeln(`\x1b[31m  ${msg}\x1b[0m\r\n`);
      return false;
    }

    if (!this.pty) {
      logger.warn("PTY spawn returned null");
      return false;
    }
    // The pty plugin's .pid is an internal session ID (0, 1, 2...), NOT the OS PID.
    // Wait for init, then store the handle and fetch the real shell PID.
    const ptyObj = this.pty as any;
    const ptyInit = ptyObj._init as Promise<void> | undefined;
    if (ptyInit) {
      ptyInit
        .then(() => {
          if (this.disposed) return;
          this.ptyHandle = ptyObj.pid as number;
          logger.debug(`[pane.start] pane=${this.id} ptyHandle=${this.ptyHandle}`);
          return invoke<number>("plugin:pty|child_pid", { pid: this.ptyHandle });
        })
        .then((osPid) => {
          if (this.disposed || osPid == null) return;
          this.ptyPid = osPid;
          logger.debug(`[pane.start] pane=${this.id} osPid=${osPid}`);
        })
        .catch((e) => logger.warn("Failed to get shell PID:", e));
    }

    this.pty.onData((data: Uint8Array | number[]) => {
      if (!this.disposed) {
        const now = Date.now();
        // Track output gap duration for adaptive idle timeout
        if (this.lastOutputGapStart > 0) {
          const gap = now - this.lastOutputGapStart;
          if (gap > 500) {
            // Only track meaningful gaps (>500ms) — shorter gaps are normal streaming
            this.outputGaps.push(gap);
            if (this.outputGaps.length > 20) this.outputGaps.shift();
          }
        }
        this.lastOutputGapStart = now;
        this.lastOutputAt = now;
        // If the agent was marked as waiting/maybe-idle, new output means it's working again
        if (this.state.activity === "agent-waiting" || this.state.activity === "agent-maybe-idle") {
          this.state.activity = "running";
        }
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

        // Feed the output analyzer immediately (no batching needed — it's
        // just string processing, and debounces internally).
        if (this.config.outputAnalysis?.enabled !== false) {
          const buf = this.terminal.buffer.active;
          this.analyzer.currentLine = buf.baseY + buf.cursorY;
          this.analyzer.totalLines = buf.baseY + this.terminal.rows;
          this.analyzer.feed(bytes);
        }

        // Queue the write and flush once per animation frame.  This serializes
        // writes with fit() (both happen at most once per frame via rAF) and
        // eliminates the core race where terminal.write() mutates baseY/viewportY
        // between fit()'s save and restore.
        //
        // When the tab is hidden, data is queued but NOT flushed via rAF.
        // This avoids per-frame terminal.write() for every background tab,
        // dramatically reducing CPU under heavy multi-tab load (#170).
        // Accumulated data is flushed in bulk when the tab becomes visible.
        this.pendingWriteData.push(bytes);
        if (!this.tabVisible) {
          // Cap accumulated data to prevent unbounded memory growth
          let total = 0;
          for (const chunk of this.pendingWriteData) total += chunk.length;
          while (total > Pane.MAX_HIDDEN_PENDING_BYTES && this.pendingWriteData.length > 1) {
            total -= this.pendingWriteData.shift()!.length;
          }
          return;
        }
        if (!this.writeRafId) {
          this.writeRafId = requestAnimationFrame(() => this.flushWrites());
        }
      }
    });

    this.pty.onExit((exitInfo: { exitCode: number; signal?: number }) => {
      if (!this.disposed) {
        this.exitCode = exitInfo.exitCode;
        const code = exitInfo.exitCode;
        const signal = exitInfo.signal;
        const color = code === 0 ? "90" : "31"; // gray for 0, red for non-zero
        let msg = `\r\n\x1b[${color}m[Process exited with code ${code}`;
        if (signal) msg += `, signal ${signal}`;
        msg += `]\x1b[0m\r\n`;
        this.terminal.write(msg);
        this.onExit?.(code);
      }
    });

    this.disposables.push(
      this.terminal.onData((data: string) => {
        if (this.pty && !this.disposed) {
          this.pty.write(data);
        }
      }),
      this.terminal.onResize(({ cols, rows }) => {
        if (this.pty && !this.disposed) {
          this.pty.resize(cols, rows);
        }
      }),
    );

    this.searchBar = new SearchBar(this.element, this.searchAddon, () => this.terminal.focus());

    // Event timeline gutter — renders markers for detected output events
    if (this.config.outputAnalysis?.enabled !== false) {
      this.eventGutter = document.createElement("div");
      this.eventGutter.className = "event-gutter";
      this.element.appendChild(this.eventGutter);
      // Update gutter periodically (events may accumulate between renders)
      this.gutterTimer = setInterval(() => this.renderGutter(), 2000);
    }

    // Track scroll position to show "new output" pill.
    // Skip updates during programmatic scrolls from fit() to prevent a
    // race-induced jump from incorrectly marking the viewport as scrolled up.
    this.disposables.push(
      this.terminal.onScroll(() => {
        if (this.fittingNow || this.scrollLocked) return;
        const buf = this.terminal.buffer.active;
        const atBottom = buf.viewportY >= buf.baseY;
        this.isScrolledUp = !atBottom;
        // Track intentional user scrolling — this flag persists across tab
        // switches and prevents auto-scroll-to-bottom on fit().
        if (atBottom) {
          this.userScrolledUp = false;
          this.hideScrollPill();
        } else {
          this.userScrolledUp = true;
        }
      }),
    );

    return true;
  }

  /** Get process info for polling (used by Tab) */
  getProcessInfo(): { pid: number | null; disposed: boolean } {
    return { pid: this.ptyPid, disposed: this.disposed };
  }

  toggleSearch() {
    this.searchBar?.toggle();
  }

  applyConfig(config: Config) {
    this.config = config;
    this.terminal.options.fontSize = config.font.size;
    this.terminal.options.fontFamily = config.font.family;
    this.terminal.options.lineHeight = config.font.lineHeight;
    this.terminal.options.cursorBlink = config.cursor.blink;
    this.terminal.options.cursorStyle = config.cursor.style;
    this.terminal.options.theme = config.theme.terminal;
    // Use forceFit — config changes are user-initiated (zoom, reload) and
    // must take effect immediately, even during active output.
    this.forceFit();
  }

  /**
   * Set whether this pane's owning tab is visible.  When hidden, PTY writes
   * are queued but not flushed to xterm.js — this avoids per-frame
   * terminal.write() processing for every background tab and significantly
   * reduces CPU/memory pressure under heavy multi-tab load (#170).
   */
  setVisible(visible: boolean) {
    this.tabVisible = visible;
    if (visible && this.pendingWriteData.length > 0 && !this.writeRafId) {
      // Flush accumulated writes now that we're visible
      this.writeRafId = requestAnimationFrame(() => this.flushWrites());
    }
  }

  private deferredFitTimer: ReturnType<typeof setTimeout> | null = null;

  fit() {
    if (this.element.offsetWidth === 0 || this.element.offsetHeight === 0) return;

    // During active output, fitAddon.fit() races with terminal.write() —
    // writes between saving viewportY and the reflow can invalidate the
    // saved position, causing a scroll jump.  Defer the fit until output
    // settles; the next write will naturally position the viewport.
    // Use 300ms grace (up from 150ms) to cover bursty agent output gaps
    // between streaming chunks and tool calls.
    const outputAge = Date.now() - this.lastOutputAt;
    if (outputAge < 300) {
      // Always reschedule so the final fit() uses up-to-date dimensions
      // and no resize operation is silently dropped.
      if (this.deferredFitTimer) clearTimeout(this.deferredFitTimer);
      this.deferredFitTimer = setTimeout(() => {
        this.deferredFitTimer = null;
        this.fit();
      }, 300);
      return;
    }

    this.fitCore();
  }

  /**
   * Fit the terminal to its container, bypassing the output-activity deferral.
   * Used when the pane becomes visible (tab show) or after a user-initiated
   * config change (zoom, font size) — in these cases the terminal MUST be
   * sized correctly immediately, even if there is active output.
   */
  forceFit() {
    if (this.element.offsetWidth === 0 || this.element.offsetHeight === 0) return;
    // Cancel any pending deferred fit — we're fitting now.
    if (this.deferredFitTimer) {
      clearTimeout(this.deferredFitTimer);
      this.deferredFitTimer = null;
    }
    this.fitCore();
  }

  /** Shared fit implementation — preserves scroll position across reflow. */
  private fitCore() {
    // When scroll-locked (tab transition), use the locked position as the
    // authoritative source — the live buffer state may be stale or mid-mutation.
    // The actual restoration happens in unlockScroll(), so here we just reflow
    // and do a minimal scroll correction to keep xterm.js internals consistent.
    const buf = this.terminal.buffer.active;
    const referenceViewportY =
      this.scrollLocked && this.lockedViewportY !== null ? this.lockedViewportY : buf.viewportY;
    const wasNearBottom = referenceViewportY >= buf.baseY - 1;
    this.fittingNow = true;
    try {
      this.fitAddon.fit();
      if (this.scrollLocked) {
        // During scroll lock, do a best-effort correction — unlockScroll()
        // will do the final authoritative restore after all operations settle.
        const maxScroll = this.terminal.buffer.active.baseY;
        if (wasNearBottom && !this.userScrolledUp) {
          this.terminal.scrollToBottom();
        } else {
          this.terminal.scrollToLine(Math.min(referenceViewportY, maxScroll));
        }
      } else {
        if (wasNearBottom && !this.userScrolledUp) {
          this.terminal.scrollToBottom();
        } else {
          const maxScroll = this.terminal.buffer.active.baseY;
          this.terminal.scrollToLine(Math.min(referenceViewportY, maxScroll));
        }
      }
    } finally {
      this.fittingNow = false;
    }
  }

  /** Flush all queued PTY writes in a single terminal.write() call. */
  private flushWrites() {
    this.writeRafId = 0;
    if (this.disposed || this.pendingWriteData.length === 0) return;

    // Merge all queued chunks into a single Uint8Array
    if (this.pendingWriteData.length === 1) {
      this.terminal.write(this.pendingWriteData[0]);
    } else {
      let total = 0;
      for (const chunk of this.pendingWriteData) total += chunk.length;
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of this.pendingWriteData) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      this.terminal.write(merged);
    }
    this.pendingWriteData.length = 0;

    // When scroll-locked, terminal.write() may have triggered xterm.js _sync()
    // which reads DOM scrollTop and corrupts the viewport position.  Immediately
    // correct back to the locked position — unlockScroll() will do the final
    // authoritative restore later. (#184)
    if (this.scrollLocked && this.lockedViewportY !== null) {
      const buf = this.terminal.buffer.active;
      const maxScroll = buf.baseY;
      const wasNearBottom = this.lockedViewportY >= maxScroll - 1;
      this.fittingNow = true;
      try {
        if (wasNearBottom && !this.userScrolledUp) {
          this.terminal.scrollToBottom();
        } else {
          this.terminal.scrollToLine(Math.min(this.lockedViewportY, maxScroll));
        }
      } finally {
        this.fittingNow = false;
      }
    }

    if (this.isScrolledUp) {
      this.showScrollPill();
    }
  }

  focus() {
    this.terminal.focus();
  }

  /** Write a string to the PTY (as if the user typed it). */
  writeToPty(data: string) {
    if (this.pty && !this.disposed) {
      this.pty.write(data);
    }
  }

  private showPasteConfirm(text: string) {
    // Reject extremely large pastes to avoid freezing the UI
    const MAX_PASTE_BYTES = 5_000_000;
    if (text.length > MAX_PASTE_BYTES) {
      showToast("Paste too large (>5MB)", "error");
      return;
    }

    // Remove any existing paste confirm dialog for this pane
    this.pasteOverlay?.remove();

    const lineCount = text.split("\n").length;
    const preview = text.length > 300 ? text.slice(0, 300) + "\u2026" : text;

    const overlay = document.createElement("div");
    this.pasteOverlay = overlay;
    overlay.className = "close-confirm-overlay paste-confirm";

    const dialog = document.createElement("div");
    dialog.className = "close-confirm-dialog";
    dialog.style.maxWidth = "460px";

    const titleEl = document.createElement("div");
    titleEl.className = "close-confirm-title";
    titleEl.textContent = `Paste ${lineCount} lines?`;

    const bodyEl = document.createElement("div");
    bodyEl.className = "close-confirm-body";
    bodyEl.textContent =
      "This text contains newlines that may execute commands. Each line break acts as Enter.";

    const previewEl = document.createElement("pre");
    previewEl.className = "paste-preview";
    previewEl.textContent = preview;

    const actionsEl = document.createElement("div");
    actionsEl.className = "close-confirm-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "close-confirm-btn cancel";
    cancelBtn.textContent = "Cancel";

    const singleLineBtn = document.createElement("button");
    singleLineBtn.className = "close-confirm-btn cancel";
    singleLineBtn.textContent = "Paste as Single Line";

    const pasteBtn = document.createElement("button");
    pasteBtn.className = "close-confirm-btn confirm";
    pasteBtn.textContent = "Paste";
    pasteBtn.style.background = "var(--sidebar-accent)";

    actionsEl.appendChild(cancelBtn);
    actionsEl.appendChild(singleLineBtn);
    actionsEl.appendChild(pasteBtn);
    dialog.appendChild(titleEl);
    dialog.appendChild(bodyEl);
    dialog.appendChild(previewEl);
    dialog.appendChild(actionsEl);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const removeTrap = trapFocus(dialog);
    const dismiss = () => {
      removeTrap();
      overlay.remove();
      this.pasteOverlay = null;
      if (!this.disposed) this.terminal.focus();
    };

    const sig = this.ac.signal;
    cancelBtn.addEventListener("click", dismiss, { signal: sig });
    singleLineBtn.addEventListener(
      "click",
      () => {
        dismiss();
        const singleLine = text.replace(/\n/g, " ");
        this.terminal.paste(singleLine);
      },
      { signal: sig },
    );
    pasteBtn.addEventListener(
      "click",
      () => {
        dismiss();
        this.terminal.paste(text);
      },
      { signal: sig },
    );
    overlay.addEventListener(
      "click",
      (e) => {
        if (e.target === overlay) dismiss();
      },
      { signal: sig },
    );
    overlay.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") dismiss();
      },
      { signal: sig },
    );

    cancelBtn.focus();
  }

  private showScrollPill() {
    if (this.scrollPill) return;
    const pill = document.createElement("div");
    pill.className = "scroll-pill";
    pill.textContent = "New output \u2193";
    pill.addEventListener("click", () => {
      this.terminal.scrollToBottom();
      this.userScrolledUp = false;
      this.hideScrollPill();
    });
    this.element.appendChild(pill);
    this.scrollPill = pill;
  }

  private hideScrollPill() {
    if (this.scrollPill) {
      this.scrollPill.remove();
      this.scrollPill = null;
    }
  }

  /** Render event markers in the scrollbar gutter */
  private renderGutter() {
    if (!this.eventGutter || this.disposed) return;
    const events = this.analyzer.eventHistory;
    if (events.length === 0) {
      this.eventGutter.innerHTML = "";
      return;
    }

    const totalLines = this.analyzer.totalLines > 0 ? this.analyzer.totalLines : 1;
    const gutterHeight = this.eventGutter.clientHeight;
    if (gutterHeight === 0) return;

    // Build markers — reuse DOM when possible
    const frag = document.createDocumentFragment();
    for (const evt of events) {
      const line = evt.line ?? 0;
      const pct = Math.min(1, line / totalLines);
      const top = Math.round(pct * gutterHeight);

      const marker = document.createElement("div");
      marker.className = `event-marker event-marker-${evt.type}`;
      marker.style.top = `${top}px`;
      marker.title = `${evt.type}: ${evt.detail.slice(0, 60)}`;

      // Click to scroll to approximate position
      marker.addEventListener("click", () => {
        const scrollTo = Math.max(0, line - Math.floor(this.terminal.rows / 2));
        this.terminal.scrollToLine(scrollTo);
      });

      frag.appendChild(marker);
    }

    this.eventGutter.innerHTML = "";
    this.eventGutter.appendChild(frag);
  }

  private savedScrollTop: number | null = null;

  /** Save the DOM-level scrollTop before the pane is hidden.
   *  Browsers reset scrollTop to 0 when elements leave the formatting structure.
   *  This provides defense-in-depth alongside the visibility:hidden approach. */
  saveScrollPosition() {
    const vp = this.element.querySelector(".xterm-viewport") as HTMLElement | null;
    if (vp) this.savedScrollTop = vp.scrollTop;
  }

  /** Restore the DOM-level scrollTop after the pane becomes visible.
   *  Must be called BEFORE any xterm.js operation that triggers _sync(). */
  restoreScrollPosition() {
    if (this.savedScrollTop !== null) {
      const vp = this.element.querySelector(".xterm-viewport") as HTMLElement | null;
      if (vp) vp.scrollTop = this.savedScrollTop;
      this.savedScrollTop = null;
    }
  }

  /** Acquire a scroll lock — saves the authoritative scroll position and
   *  prevents any scroll mutations during the tab show/hide transition.
   *  While locked: onScroll is suppressed, fitCore() uses the locked position,
   *  and flushWrites() corrects scroll after each write. (#184) */
  lockScroll() {
    this.scrollLocked = true;
    this.lockedViewportY = this.terminal.buffer.active.viewportY;
  }

  /** Release the scroll lock and perform the single authoritative scroll
   *  restoration.  This is the ONLY point where scroll position is restored
   *  after a tab transition — all intermediate operations just preserve the
   *  locked position without trying to restore it themselves. (#184) */
  unlockScroll() {
    if (!this.scrollLocked) return;
    this.scrollLocked = false;
    if (this.lockedViewportY !== null) {
      const buf = this.terminal.buffer.active;
      const maxScroll = buf.baseY;
      const wasNearBottom = this.lockedViewportY >= maxScroll - 1;
      this.fittingNow = true; // suppress onScroll side-effects during restoration
      try {
        if (wasNearBottom && !this.userScrolledUp) {
          this.terminal.scrollToBottom();
        } else {
          this.terminal.scrollToLine(Math.min(this.lockedViewportY, maxScroll));
        }
      } finally {
        this.fittingNow = false;
      }
    }
    this.lockedViewportY = null;
  }

  /**
   * Load WebGL + Image addons if not already active and element has dimensions.
   * @param force  Bypass the output-activity deferral (used during tab show).
   */
  activateWebGL(force = false) {
    if (this.disposed || this.webglAddon) return;
    if (this.element.offsetWidth === 0 || this.element.offsetHeight === 0) return;

    // Defer WebGL activation during active output — loadAddon triggers an
    // internal xterm.js reflow that bypasses the fit() deferral guard and
    // can race with terminal.write(), causing a scroll jump.
    // Skip deferral when force=true (tab show — terminal must render now).
    if (!force) {
      const outputAge = Date.now() - this.lastOutputAt;
      if (outputAge < 300) {
        if (!this.deferredWebglTimer) {
          this.deferredWebglTimer = setTimeout(() => {
            this.deferredWebglTimer = null;
            this.activateWebGL();
          }, 300);
        }
        return;
      }
    }

    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        logger.debug(`[pane.webgl] pane=${this.id} context lost, falling back to canvas`);
        this.deactivateWebGL(/* contextLost */ true);
      });
      this.terminal.loadAddon(webgl);
      this.webglAddon = webgl;
    } catch (e) {
      logger.debug(`[pane.webgl] pane=${this.id} WebGL failed, using canvas: ${e}`);
    }
    if (!this.imageAddon) {
      try {
        const img = new ImageAddon();
        this.terminal.loadAddon(img);
        this.imageAddon = img;
      } catch {
        // Image addon may fail if WebGL is unavailable
      }
    }
  }

  /**
   * Dispose WebGL + Image addons to free GPU contexts (canvas fallback is automatic).
   * When `contextLost` is true (called from the onContextLoss handler), we force
   * a full terminal refresh so xterm.js repaints with its fallback canvas renderer
   * — without this the viewport stays black.
   */
  deactivateWebGL(contextLost = false) {
    const hadWebgl = !!this.webglAddon;
    if (this.webglAddon) {
      try {
        this.webglAddon.dispose();
      } catch {
        /* already disposed */
      }
      this.webglAddon = null;
    }
    if (this.imageAddon) {
      try {
        this.imageAddon.dispose();
      } catch {
        /* already disposed */
      }
      this.imageAddon = null;
    }
    // After losing the WebGL renderer, xterm.js reverts to its built-in canvas
    // renderer but does NOT automatically repaint the viewport.  Force a full
    // refresh so the user never sees a black screen.
    if (contextLost && hadWebgl && !this.disposed) {
      requestAnimationFrame(() => {
        if (!this.disposed) {
          this.terminal.refresh(0, this.terminal.rows - 1);
        }
      });
    }
  }

  /** Read the last N lines from the terminal buffer (for content-based status detection). */
  getLastLines(count: number): string[] {
    const buf = this.terminal.buffer.active;
    const totalRows = buf.baseY + this.terminal.rows;
    const lines: string[] = [];
    for (let i = Math.max(0, totalRows - count); i < totalRows; i++) {
      const line = buf.getLine(i);
      if (line) {
        const text = line.translateToString(true).trim();
        if (text) lines.push(text);
      }
    }
    return lines;
  }

  /** Send SIGINT (Ctrl-C) to the PTY foreground process group. */
  sendInterrupt() {
    if (this.pty && !this.disposed) {
      // \x03 is Ctrl-C / ETX — the PTY driver sends SIGINT to the fg group
      this.pty.write("\x03");
    }
  }

  dispose() {
    logger.debug(`[pane.dispose] pane=${this.id} ptyPid=${this.ptyPid}`);
    this.disposed = true;
    // Cancel any deferred fit / WebGL timers and pending write RAF
    if (this.deferredFitTimer) {
      clearTimeout(this.deferredFitTimer);
      this.deferredFitTimer = null;
    }
    if (this.deferredWebglTimer) {
      clearTimeout(this.deferredWebglTimer);
      this.deferredWebglTimer = null;
    }
    if (this.writeRafId) {
      cancelAnimationFrame(this.writeRafId);
      this.writeRafId = 0;
      this.pendingWriteData.length = 0;
    }
    // Free GPU contexts
    this.deactivateWebGL();
    // Dismiss any open paste confirm dialog for this pane
    this.pasteOverlay?.remove();
    this.pasteOverlay = null;
    // Remove all DOM event listeners registered with AbortController
    this.ac.abort();
    // Dispose all xterm event subscriptions
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    // Capture and null PTY ref before kill to prevent double-dispose
    // and block any further writes from terminal.onData / onResize
    const pty = this.pty;
    this.pty = null;
    if (pty) {
      this.gracefulKill(pty);
    }
    this.analyzer.dispose();
    this.searchBar?.dispose();
    this.hideScrollPill();
    if (this.gutterTimer) {
      clearInterval(this.gutterTimer);
      this.gutterTimer = null;
    }
    this.terminal.dispose();
    this.element.remove();
  }

  /**
   * Gracefully shut down a PTY: SIGHUP first, then SIGKILL after a timeout.
   * This gives shells and child processes a chance to clean up.
   */
  private gracefulKill(pty: IPty) {
    let exited = false;
    const onExit = pty.onExit(() => {
      exited = true;
      onExit.dispose();
    });

    try {
      pty.kill("SIGHUP");
    } catch {
      // Already dead — nothing to do
      return;
    }

    setTimeout(() => {
      if (!exited) {
        try {
          pty.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
      onExit.dispose();
    }, 2000);
  }
}
