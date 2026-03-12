import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { spawn, type IPty } from "tauri-pty";
import type { Config } from "./config";
import { invokeWithTimeout } from "./utils";
import { type TabState, createDefaultTabState, computeDisplayTitle } from "./tab-state";
import { OutputAnalyzer } from "./output-analyzer";
import { type OutputEvent, AGENT_PROCESS_MAP } from "./matchers";
import { SearchBar } from "./search-bar";
import { logger } from "./logger";
import { isMac } from "./utils";

export type KeyHandler = (e: KeyboardEvent) => boolean;

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export class Tab {
  readonly id: string;
  title: string;
  readonly terminal: Terminal;
  readonly fitAddon: FitAddon;
  readonly searchAddon: SearchAddon;
  readonly element: HTMLDivElement;
  private pty: IPty | null = null;
  ptyPid: number | null = null;
  private disposed = false;
  private config: Config;
  private isVisible = false;
  manualTitle: string | null = null;
  state: TabState = createDefaultTabState();
  readonly analyzer: OutputAnalyzer;
  private searchBar: SearchBar | null = null;
  private cwd: string | undefined;
  onExit: (() => void) | null = null;
  onTitleChange: ((title: string) => void) | null = null;
  onNeedsAttention: (() => void) | null = null;
  onOutputEvent: ((event: OutputEvent) => void) | null = null;

  constructor(id: string, title: string, config: Config, keyHandler?: KeyHandler, cwd?: string) {
    this.id = id;
    this.title = title;
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
      macOptionIsMeta: isMac,
      macOptionClickForcesSelection: isMac,
    });

    // Intercept keys before xterm processes them
    this.terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      // Let the manager handle app-level shortcuts first
      if (keyHandler && !keyHandler(e)) {
        return false; // manager handled it, don't send to terminal
      }

      // macOS: Map Cmd+key to terminal control sequences for natural text editing
      // On Linux/Windows, Ctrl already sends these natively to the PTY
      if (isMac && e.type === "keydown" && e.metaKey && this.pty && !this.disposed) {
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
      if (e.type === "keydown" && e.altKey && !e.metaKey && !e.ctrlKey && this.pty && !this.disposed) {
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
    this.searchAddon = new SearchAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon());
    this.terminal.loadAddon(this.searchAddon);

    this.element = document.createElement("div");
    this.element.className = "terminal-wrapper";

    // Wire output analyzer events
    if (config.outputAnalysis?.enabled !== false) {
      this.analyzer.onEvent((event) => {
        this.handleOutputEvent(event);
      });
    }
  }

  private handleOutputEvent(event: OutputEvent) {
    switch (event.type) {
      case "agent-waiting":
        this.state.activity = "agent-waiting";
        if (event.agentName) this.state.agentName = event.agentName;
        if (!this.isVisible) {
          this.state.needsAttention = true;
          this.onNeedsAttention?.();
        }
        break;
      case "server-started":
        this.state.activity = "server-running";
        if (event.port) this.state.serverPort = event.port;
        break;
      case "server-crashed":
        this.state.activity = "error";
        this.state.lastError = "Server crashed";
        break;
      case "error":
        this.state.activity = "error";
        this.state.lastError = event.detail.slice(0, 50);
        break;
      case "agent-completed":
        this.state.activity = "completed";
        if (!this.isVisible) {
          this.state.needsAttention = true;
          this.onNeedsAttention?.();
        }
        // Fade completed back to idle
        setTimeout(() => {
          if (this.state.activity === "completed") {
            this.state.activity = "idle";
            this.updateTitle();
          }
        }, this.config.advanced.completedFadeMs);
        break;
    }

    this.updateTitle();
    this.onOutputEvent?.(event);
  }

  private updateTitle() {
    if (!this.manualTitle) {
      const displayTitle = computeDisplayTitle(this.state);
      if (displayTitle !== this.title) {
        this.title = displayTitle;
        this.onTitleChange?.(displayTitle);
      }
    }
  }

  async start() {
    const container = document.getElementById("terminal-container")!;
    container.appendChild(this.element);

    this.terminal.open(this.element);

    await new Promise((r) => requestAnimationFrame(r));
    this.fitAddon.fit();

    const cols = this.terminal.cols;
    const rows = this.terminal.rows;

    const spawnOpts: Record<string, unknown> = {
      cols,
      rows,
      name: "xterm-256color",
    };
    if (this.cwd) spawnOpts.cwd = this.cwd;

    this.pty = spawn(this.config.shell, [], spawnOpts as any);
    this.ptyPid = this.pty.pid;

    let hasSentCd = false;
    this.pty.onData((data: Uint8Array | number[]) => {
      if (!this.disposed) {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        this.terminal.write(bytes);
        if (this.config.outputAnalysis?.enabled !== false) {
          this.analyzer.feed(bytes);
        }
        // cd after first output (shell prompt is ready)
        if (!hasSentCd && this.cwd && this.pty) {
          hasSentCd = true;
          this.pty.write(`cd ${shellEscape(this.cwd)} && clear\r`);
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

    // Create search bar for this tab
    this.searchBar = new SearchBar(this.element, this.searchAddon);
  }

  /** Poll process info once. Called by TerminalManager's centralized poll loop. */
  async pollProcessInfo() {
    if (this.disposed || !this.pty) return;
    const shellPid = this.pty.pid;

    const timeout = this.config.advanced.ipcTimeoutMs;

    try {
      const [procInfo, folder, fullCwd] = await Promise.all([
        invokeWithTimeout<{ name: string; pid: number }>(
          "get_foreground_process",
          { pid: shellPid },
          timeout,
        ),
        invokeWithTimeout<string>("get_process_cwd", { pid: shellPid }, timeout),
        invokeWithTimeout<string>("get_process_cwd_full", { pid: shellPid }, timeout),
      ]);

      const wasIdle = this.state.isIdle;
      const newIsIdle = procInfo.pid === shellPid;

      this.state.folderName = folder;
      this.state.processName = newIsIdle ? "" : procInfo.name;
      this.state.isIdle = newIsIdle;

      // Detect agent from process name
      if (!newIsIdle) {
        const agentId = AGENT_PROCESS_MAP[procInfo.name.toLowerCase()];
        if (agentId) {
          this.state.agentName = agentId;
          if (this.state.activity === "idle") {
            this.state.activity = "running";
          }
        } else if (this.state.activity !== "server-running" && this.state.activity !== "error") {
          this.state.activity = "running";
        }
      }

      // Idle transition in background tab = needs attention
      if (!wasIdle && newIsIdle && !this.isVisible) {
        this.state.needsAttention = true;
        if (this.onNeedsAttention) this.onNeedsAttention();
      }

      // Reset activity on idle (unless server is running)
      if (newIsIdle && this.state.activity !== "server-running" && this.state.activity !== "completed") {
        this.state.activity = "idle";
        this.state.agentName = null;
        this.state.lastError = null;
      }

      // Fetch project name if we have a CWD
      if (fullCwd && !this.state.projectName) {
        try {
          const projectName = await invokeWithTimeout<string>("get_project_info", { dir: fullCwd }, timeout);
          if (projectName && projectName !== folder) {
            this.state.projectName = projectName;
          }
        } catch (e) {
          logger.debug("Failed to get project info:", e);
        }
      }

      this.updateTitle();
    } catch (e) {
      logger.debug("Poll failed (process may have exited):", e);
    }
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

  show() {
    this.isVisible = true;
    this.state.needsAttention = false;
    this.element.classList.add("active");
    requestAnimationFrame(() => {
      this.fitAddon.fit();
      this.terminal.focus();
    });
  }

  hide() {
    this.isVisible = false;
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
      let exited = false;
      this.pty.onExit(() => {
        exited = true;
      });
      this.pty.kill();
      setTimeout(() => {
        if (!exited) {
          logger.warn(`PTY for tab ${this.id} did not exit within 500ms after kill`);
        }
      }, 500);
    }
    this.analyzer.dispose();
    this.searchBar?.dispose();
    this.terminal.dispose();
    this.element.remove();
  }
}
