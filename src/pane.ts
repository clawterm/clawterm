import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { spawn, type IPty } from "tauri-pty";
import type { Config } from "./config";
import { OutputAnalyzer } from "./output-analyzer";
import type { OutputEvent } from "./matchers";
import { SearchBar } from "./search-bar";
import { logger } from "./logger";
import { showToast } from "./toast";

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
  private disposed = false;
  private config: Config;
  readonly analyzer: OutputAnalyzer;
  private searchBar: SearchBar | null = null;
  private cwd: string | undefined;
  lastFullCwd: string | null = null;

  onExit: (() => void) | null = null;
  onOutputEvent: ((event: OutputEvent) => void) | null = null;
  onFocus: (() => void) | null = null;

  constructor(config: Config, keyHandler?: KeyHandler, cwd?: string) {
    paneCounter++;
    this.id = `pane-${paneCounter}`;
    this.config = config;
    this.cwd = cwd;

    this.analyzer = new OutputAnalyzer(config.outputAnalysis?.bufferSize ?? 4096);

    this.terminal = new Terminal({
      cursorBlink: config.cursor.blink,
      cursorStyle: config.cursor.style,
      fontSize: config.font.size,
      fontFamily: config.font.family,
      lineHeight: config.font.lineHeight,
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
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon());
    this.terminal.loadAddon(this.searchAddon);

    this.element = document.createElement("div");
    this.element.className = "pane";

    // Fire onFocus when this pane's element receives focus (click/tab)
    this.element.addEventListener("focusin", () => {
      this.onFocus?.();
    });

    // Copy selection to clipboard on select
    if (config.copyOnSelect) {
      this.terminal.onSelectionChange(() => {
        const selection = this.terminal.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection).catch(() => {});
        }
      });
    }

    // Wire output analyzer events
    if (config.outputAnalysis?.enabled !== false) {
      this.analyzer.onEvent((event) => {
        this.onOutputEvent?.(event);
      });
    }
  }

  async start(): Promise<boolean> {
    this.terminal.open(this.element);

    await new Promise((r) => requestAnimationFrame(r));
    this.fitAddon.fit();

    const cols = this.terminal.cols;
    const rows = this.terminal.rows;

    const spawnOpts: Record<string, unknown> = {
      cols,
      rows,
      name: "xterm-256color",
      env: { TERM: "xterm-256color", COLORTERM: "truecolor" },
    };
    if (this.cwd) spawnOpts.cwd = this.cwd;

    try {
      this.pty = spawn(this.config.shell, [], spawnOpts as any);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Failed to start shell: ${this.config.shell}`, "error", 8000);
      logger.warn("PTY spawn failed:", e);
      this.terminal.writeln(`\r\n\x1b[31m  Failed to start shell: ${this.config.shell}\x1b[0m`);
      this.terminal.writeln(`\x1b[31m  ${msg}\x1b[0m\r\n`);
      return false;
    }
    this.ptyPid = this.pty.pid;

    this.pty.onData((data: Uint8Array | number[]) => {
      if (!this.disposed) {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        this.terminal.write(bytes);
        if (this.config.outputAnalysis?.enabled !== false) {
          this.analyzer.feed(bytes);
        }
      }
    });

    this.pty.onExit((_exitInfo: { exitCode: number; signal?: number }) => {
      if (!this.disposed && this.onExit) {
        this.onExit();
      }
    });

    this.terminal.onData((data: string) => {
      if (this.pty && !this.disposed) {
        this.pty.write(data);
      }
    });

    this.terminal.onResize(({ cols, rows }) => {
      if (this.pty && !this.disposed) {
        this.pty.resize(cols, rows);
      }
    });

    this.searchBar = new SearchBar(this.element, this.searchAddon, () => this.terminal.focus());
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

  dispose() {
    this.disposed = true;
    // Capture and null PTY ref before kill to prevent double-dispose
    // and block any further writes from terminal.onData / onResize
    const pty = this.pty;
    this.pty = null;
    if (pty) {
      pty.kill();
    }
    this.analyzer.dispose();
    this.searchBar?.dispose();
    this.terminal.dispose();
    this.element.remove();
  }
}
