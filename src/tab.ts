import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { spawn, type IPty } from "tauri-pty";
import type { Config } from "./config";

export type KeyHandler = (e: KeyboardEvent) => boolean;

export class Tab {
  readonly id: string;
  title: string;
  readonly terminal: Terminal;
  readonly fitAddon: FitAddon;
  readonly element: HTMLDivElement;
  private pty: IPty | null = null;
  private disposed = false;
  private config: Config;
  onExit: (() => void) | null = null;

  constructor(id: string, title: string, config: Config, keyHandler?: KeyHandler) {
    this.id = id;
    this.title = title;
    this.config = config;

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
      // Let the manager handle app-level shortcuts first
      if (keyHandler && !keyHandler(e)) {
        return false; // manager handled it, don't send to terminal
      }

      // Natural text editing mappings (only on keydown)
      if (e.type === "keydown" && e.metaKey && this.pty && !this.disposed) {
        // Cmd+Backspace -> delete line (Ctrl+U)
        if (e.key === "Backspace") {
          e.preventDefault();
          this.pty.write("\x15");
          return false;
        }
        // Cmd+Left -> jump to start of line (Home / Ctrl+A)
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          this.pty.write("\x01");
          return false;
        }
        // Cmd+Right -> jump to end of line (End / Ctrl+E)
        if (e.key === "ArrowRight") {
          e.preventDefault();
          this.pty.write("\x05");
          return false;
        }
        // Cmd+K -> clear terminal
        if (e.key === "k") {
          e.preventDefault();
          this.terminal.clear();
          return false;
        }
      }

      // Alt+Left -> back one word (ESC b)
      if (e.type === "keydown" && e.altKey && !e.metaKey && this.pty && !this.disposed) {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          this.pty.write("\x1bb");
          return false;
        }
        // Alt+Right -> forward one word (ESC f)
        if (e.key === "ArrowRight") {
          e.preventDefault();
          this.pty.write("\x1bf");
          return false;
        }
        // Alt+Backspace -> delete word (Ctrl+W)
        if (e.key === "Backspace") {
          e.preventDefault();
          this.pty.write("\x17");
          return false;
        }
      }

      return true; // let xterm handle it
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon());

    this.element = document.createElement("div");
    this.element.className = "terminal-wrapper";
  }

  async start() {
    const container = document.getElementById("terminal-container")!;
    container.appendChild(this.element);

    this.terminal.open(this.element);

    await new Promise((r) => requestAnimationFrame(r));
    this.fitAddon.fit();

    const cols = this.terminal.cols;
    const rows = this.terminal.rows;

    this.pty = spawn(this.config.shell, [], {
      cols,
      rows,
    });

    this.pty.onData((data: Uint8Array | number[]) => {
      if (!this.disposed) {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        this.terminal.write(bytes);
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

  show() {
    this.element.classList.add("active");
    requestAnimationFrame(() => {
      this.fitAddon.fit();
      this.terminal.focus();
    });
  }

  hide() {
    this.element.classList.remove("active");
  }

  fit() {
    if (this.element.classList.contains("active")) {
      this.fitAddon.fit();
    }
  }

  focus() {
    this.terminal.focus();
  }

  dispose() {
    this.disposed = true;
    if (this.pty) {
      this.pty.kill();
    }
    this.terminal.dispose();
    this.element.remove();
  }
}
