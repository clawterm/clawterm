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
import { trapFocus } from "./utils";

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
  private isScrolledUp = false;
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

  exitCode: number | null = null;
  onExit: ((exitCode: number) => void) | null = null;
  onOutputEvent: ((event: OutputEvent) => void) | null = null;
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
      } catch {
        // Invalid regex — skip silently
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

      if (e.type === "keydown" && e.metaKey && this.pty && !this.disposed) {
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
      if (e.type === "keydown" && e.key === "Enter" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (this.pty && !this.disposed) {
          e.preventDefault();
          this.pty.write("\x1b[13;2u");
          return false;
        }
      }

      if (e.type === "keydown" && e.altKey && !e.metaKey && !e.ctrlKey && this.pty && !this.disposed) {
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
            navigator.clipboard.writeText(selection).catch((e) => logger.debug("Clipboard write failed:", e));
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
                navigator.clipboard
                  .writeText(selection)
                  .catch((e) => logger.debug("Clipboard write failed:", e));
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
                .catch((e) => logger.debug("Clipboard read failed:", e));
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

    // Wire output analyzer events
    if (config.outputAnalysis?.enabled !== false) {
      this.analyzer.onEvent((event) => {
        logger.debug(`[pane.analyzerEvent] pane=${this.id} type=${event.type} detail=${event.detail.slice(0, 60)}`);
        this.onOutputEvent?.(event);
      });
    }
  }

  async start(): Promise<boolean> {
    this.terminal.open(this.element);

    // WebGL renderer — must load after open(); falls back to canvas silently.
    // Only attempt WebGL if the pane is visible (has dimensions) to avoid
    // exhausting GPU context limits when restoring many tabs at once.
    if (this.element.offsetWidth > 0 && this.element.offsetHeight > 0) {
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          logger.debug(`[pane.webgl] pane=${this.id} context lost, falling back to canvas`);
          try { webgl.dispose(); } catch { /* already disposed */ }
        });
        this.terminal.loadAddon(webgl);
        this.disposables.push(webgl);
      } catch (e) {
        // WebGL not available or context limit reached — canvas fallback is automatic
        logger.debug(`[pane.webgl] pane=${this.id} WebGL failed, using canvas: ${e}`);
      }
    }

    // Inline image support (Sixel + iTerm2 IIP)
    try {
      this.terminal.loadAddon(new ImageAddon());
    } catch {
      // Image addon may fail if WebGL is unavailable
    }

    // Register file path link provider (click to copy path)
    this.terminal.registerLinkProvider(new FileLinkProvider(this.terminal));

    await new Promise((r) => requestAnimationFrame(r));
    // Guard against zero-dimension elements (e.g. display:none parent) —
    // fit() on a zero-sized element can produce NaN cols/rows
    if (this.element.offsetWidth > 0 && this.element.offsetHeight > 0) {
      this.fitAddon.fit();
    }

    const cols = this.terminal.cols;
    const rows = this.terminal.rows;

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
      ptyInit.then(() => {
        this.ptyHandle = ptyObj.pid as number;
        logger.debug(`[pane.start] pane=${this.id} ptyHandle=${this.ptyHandle}`);
        return invoke<number>("plugin:pty|child_pid", { pid: this.ptyHandle });
      }).then((osPid) => {
        this.ptyPid = osPid;
        logger.debug(`[pane.start] pane=${this.id} osPid=${osPid}`);
      }).catch((e) => logger.warn("Failed to get shell PID:", e));
    }

    this.pty.onData((data: Uint8Array | number[]) => {
      if (!this.disposed) {
        this.lastOutputAt = Date.now();
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        this.terminal.write(bytes);
        if (this.config.outputAnalysis?.enabled !== false) {
          // Update analyzer with current terminal position before feeding
          const buf = this.terminal.buffer.active;
          this.analyzer.currentLine = buf.baseY + buf.cursorY;
          this.analyzer.totalLines = buf.baseY + this.terminal.rows;
          this.analyzer.feed(bytes);
        }
        if (this.isScrolledUp) {
          this.showScrollPill();
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

    // Track scroll position to show "new output" pill
    this.disposables.push(
      this.terminal.onScroll(() => {
        const buf = this.terminal.buffer.active;
        const atBottom = buf.viewportY >= buf.baseY;
        this.isScrolledUp = !atBottom;
        if (atBottom) this.hideScrollPill();
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
    this.fit();
  }

  fit() {
    if (this.element.offsetWidth > 0 && this.element.offsetHeight > 0) {
      this.fitAddon.fit();
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
    // Remove any existing paste confirm dialog
    document.querySelector(".close-confirm-overlay.paste-confirm")?.remove();

    const lineCount = text.split("\n").length;
    const preview = text.length > 300 ? text.slice(0, 300) + "\u2026" : text;

    const overlay = document.createElement("div");
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
    pasteBtn.style.background = "#0a84ff";

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
      if (!this.disposed) this.terminal.focus();
    };

    cancelBtn.addEventListener("click", dismiss);
    singleLineBtn.addEventListener("click", () => {
      dismiss();
      const singleLine = text.replace(/\n/g, " ");
      this.terminal.paste(singleLine);
    });
    pasteBtn.addEventListener("click", () => {
      dismiss();
      this.terminal.paste(text);
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) dismiss();
    });
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") dismiss();
    });

    cancelBtn.focus();
  }

  private showScrollPill() {
    if (this.scrollPill) return;
    const pill = document.createElement("div");
    pill.className = "scroll-pill";
    pill.textContent = "New output \u2193";
    pill.addEventListener("click", () => {
      this.terminal.scrollToBottom();
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

    const totalLines = this.analyzer.totalLines || 1;
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
    // Dismiss any open paste confirm dialog
    document.querySelector(".close-confirm-overlay.paste-confirm")?.remove();
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
