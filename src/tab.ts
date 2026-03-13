import type { Config } from "./config";
import { invokeWithTimeout } from "./utils";
import { type TabState, createDefaultTabState, computeDisplayTitle } from "./tab-state";
import { type OutputEvent, AGENT_PROCESS_MAP } from "./matchers";
import { logger } from "./logger";
import { showToast } from "./toast";
import { Pane, type KeyHandler } from "./pane";

export type SplitDirection = "horizontal" | "vertical";

interface SplitBranch {
  type: "split";
  direction: SplitDirection;
  children: [SplitNode, SplitNode];
  /** 0..1 ratio of first child's size */
  ratio: number;
  element: HTMLDivElement;
}

interface SplitLeaf {
  type: "leaf";
  pane: Pane;
}

type SplitNode = SplitBranch | SplitLeaf;

export class Tab {
  readonly id: string;
  title: string;
  readonly element: HTMLDivElement;
  private config: Config;
  private isVisible = false;
  manualTitle: string | null = null;
  pinned = false;
  state: TabState = createDefaultTabState();
  private pollFailures = 0;
  private pollStopped = false;
  private keyHandler?: KeyHandler;
  private cwd: string | undefined;
  /** Timestamp of the last poll that saw a running (non-idle) process */
  private lastRunningAt = 0;
  /** Grace period before transitioning running→idle (prevents flicker) */
  private static readonly IDLE_GRACE_MS = 1500;

  /** The tree of split panes */
  private root: SplitNode;
  /** The currently focused pane */
  private focusedPane: Pane;
  /** All panes in this tab (flat list for easy iteration) */
  private panes: Pane[] = [];
  /** Cleanup functions for document-level drag listeners, keyed by branch */
  private dividerCleanups = new Map<SplitBranch, () => void>();

  onExit: (() => void) | null = null;
  onTitleChange: ((title: string) => void) | null = null;
  onNeedsAttention: (() => void) | null = null;
  onOutputEvent: ((event: OutputEvent) => void) | null = null;

  // Expose for process polling — returns the focused pane's PTY pid
  get ptyPid(): number | null {
    return this.focusedPane.ptyPid;
  }

  get lastFullCwd(): string | null {
    return this.focusedPane.lastFullCwd;
  }

  /** The analyzer of the focused pane */
  get analyzer() {
    return this.focusedPane.analyzer;
  }

  constructor(id: string, title: string, config: Config, keyHandler?: KeyHandler, cwd?: string) {
    this.id = id;
    this.title = title;
    this.config = config;
    this.keyHandler = keyHandler;
    this.cwd = cwd;

    this.element = document.createElement("div");
    this.element.className = "terminal-wrapper";

    const pane = this.createPane(cwd);
    this.root = { type: "leaf", pane };
    this.focusedPane = pane;
  }

  private createPane(cwd?: string): Pane {
    const pane = new Pane(this.config, this.keyHandler, cwd);

    pane.onFocus = () => {
      this.focusedPane = pane;
      // Update focused pane styling
      for (const p of this.panes) {
        p.element.classList.toggle("pane-focused", p === pane);
      }
    };

    pane.onExit = (exitCode: number) => {
      if (exitCode !== 0) {
        this.state.activity = "error";
        this.state.lastError = `Exit code ${exitCode}`;
        this.updateTitle();
      }
      if (this.panes.length === 1) {
        // Last pane — close the tab
        this.onExit?.();
      } else {
        this.closePane(pane);
      }
    };

    pane.onOutputEvent = (event: OutputEvent) => {
      this.handleOutputEvent(event);
    };

    this.panes.push(pane);
    return pane;
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

    // Mount the root pane
    this.element.appendChild(this.focusedPane.element);
    await this.focusedPane.start();
    this.focusedPane.element.classList.add("pane-focused");
  }

  /** Split the focused pane in the given direction */
  async split(direction: SplitDirection) {
    if (this.panes.length >= this.config.maxPanes) {
      showToast(`Pane limit reached (${this.config.maxPanes})`, "warn");
      return;
    }

    const paneToSplit = this.focusedPane;

    // Query the current CWD from the pane's process in real-time
    let cwd: string | undefined = paneToSplit.lastFullCwd ?? this.cwd;
    if (paneToSplit.ptyPid) {
      try {
        const timeout = this.config.advanced.ipcTimeoutMs;
        const fg = await invokeWithTimeout<{ name: string; pid: number }>(
          "get_foreground_process",
          { pid: paneToSplit.ptyPid },
          timeout,
        );
        const liveCwd = await invokeWithTimeout<string>("get_process_cwd_full", { pid: fg.pid }, timeout);
        if (liveCwd) cwd = liveCwd;
      } catch (e) {
        logger.debug("Failed to get CWD for split:", e);
      }
    }

    const newPane = this.createPane(cwd);

    // Find the leaf node for the focused pane and replace it with a split
    const splitContainer = document.createElement("div");
    splitContainer.className = `split-container split-${direction}`;

    const divider = document.createElement("div");
    divider.className = `split-divider split-divider-${direction}`;

    const newBranch: SplitBranch = {
      type: "split",
      direction,
      children: [
        { type: "leaf", pane: paneToSplit },
        { type: "leaf", pane: newPane },
      ],
      ratio: 0.5,
      element: splitContainer,
    };

    // Replace the old leaf in the tree
    this.replaceNode(paneToSplit, newBranch);

    // Build the DOM
    splitContainer.appendChild(paneToSplit.element);
    splitContainer.appendChild(divider);
    splitContainer.appendChild(newPane.element);

    // Apply sizes
    this.applySplitSizes(newBranch);

    // Setup divider drag
    this.setupDividerDrag(divider, newBranch);

    // Start the new pane's PTY
    await newPane.start();

    // Focus the new pane
    this.focusedPane = newPane;
    for (const p of this.panes) {
      p.element.classList.toggle("pane-focused", p === newPane);
    }
    newPane.focus();

    // Refit all panes after layout change
    requestAnimationFrame(() => this.fitAllPanes());
  }

  /** Close a specific pane */
  private closePane(paneToClose: Pane) {
    // Find the parent split containing this pane
    const parentInfo = this.findParent(this.root, paneToClose);
    if (!parentInfo) return;

    const { parent, siblingNode } = parentInfo;

    // Remove the pane from panes list
    this.panes = this.panes.filter((p) => p !== paneToClose);
    paneToClose.dispose();

    // Replace the parent split with the surviving sibling
    this.replaceNode(parent, siblingNode);

    // Clear stale inline sizes on the surviving element
    const survivingEl = siblingNode.type === "leaf" ? siblingNode.pane.element : siblingNode.element;
    survivingEl.style.width = "";
    survivingEl.style.height = "";

    // If the closed pane was focused, focus the surviving pane
    if (this.focusedPane === paneToClose) {
      const nextFocus = this.getFirstPane(siblingNode);
      this.focusedPane = nextFocus;
      for (const p of this.panes) {
        p.element.classList.toggle("pane-focused", p === nextFocus);
      }
      nextFocus.focus();
    }

    // Clean up the split container element and its document-level drag listeners
    parent.element.remove();
    const cleanup = this.dividerCleanups.get(parent);
    if (cleanup) {
      cleanup();
      this.dividerCleanups.delete(parent);
    }

    requestAnimationFrame(() => this.fitAllPanes());
  }

  /** Close the currently focused pane (or close tab if last) */
  closeFocusedPane() {
    if (this.panes.length <= 1) return false; // caller should close the tab
    this.closePane(this.focusedPane);
    return true;
  }

  /** Cycle focus to the next pane */
  focusNextPane() {
    if (this.panes.length <= 1) return;
    const idx = this.panes.indexOf(this.focusedPane);
    const next = this.panes[(idx + 1) % this.panes.length];
    this.focusedPane = next;
    for (const p of this.panes) {
      p.element.classList.toggle("pane-focused", p === next);
    }
    next.focus();
  }

  /** Cycle focus to the previous pane */
  focusPrevPane() {
    if (this.panes.length <= 1) return;
    const idx = this.panes.indexOf(this.focusedPane);
    const prev = this.panes[(idx - 1 + this.panes.length) % this.panes.length];
    this.focusedPane = prev;
    for (const p of this.panes) {
      p.element.classList.toggle("pane-focused", p === prev);
    }
    prev.focus();
  }

  private replaceNode(target: SplitNode | Pane, replacement: SplitNode) {
    if (
      this.root === target ||
      (target instanceof Pane && this.root.type === "leaf" && this.root.pane === target)
    ) {
      this.root = replacement;
      // Mount replacement at the tab element level
      if (replacement.type === "split") {
        // The element replaces the pane's element in the DOM
        const parent =
          target instanceof Pane
            ? target.element.parentElement
            : (target as SplitBranch).element.parentElement;
        if (parent) {
          const oldEl = target instanceof Pane ? target.element : (target as SplitBranch).element;
          parent.replaceChild(replacement.element, oldEl);
        } else {
          this.element.appendChild(replacement.element);
        }
      } else {
        // Leaf replacement — put pane element in tab
        const pane = replacement.pane;
        const oldEl = target instanceof Pane ? target.element : (target as SplitBranch).element;
        const parent = oldEl.parentElement;
        if (parent) {
          parent.replaceChild(pane.element, oldEl);
        } else {
          this.element.appendChild(pane.element);
        }
      }
      return;
    }

    // Search the tree for the target
    this.replaceInTree(this.root, target, replacement);
  }

  private replaceInTree(node: SplitNode, target: SplitNode | Pane, replacement: SplitNode): boolean {
    if (node.type !== "split") return false;

    for (let i = 0; i < 2; i++) {
      const child = node.children[i];
      const isMatch =
        child === target || (target instanceof Pane && child.type === "leaf" && child.pane === target);

      if (isMatch) {
        node.children[i] = replacement;

        // Update DOM — replace old element with new
        if (replacement.type === "split") {
          const oldEl = child.type === "leaf" ? child.pane.element : child.element;
          node.element.replaceChild(replacement.element, oldEl);
        } else {
          const oldEl = child.type === "leaf" ? child.pane.element : child.element;
          node.element.replaceChild(replacement.pane.element, oldEl);
        }
        return true;
      }

      if (this.replaceInTree(child, target, replacement)) return true;
    }
    return false;
  }

  private findParent(node: SplitNode, pane: Pane): { parent: SplitBranch; siblingNode: SplitNode } | null {
    if (node.type !== "split") return null;

    for (let i = 0; i < 2; i++) {
      const child = node.children[i];
      if (child.type === "leaf" && child.pane === pane) {
        const siblingIdx = i === 0 ? 1 : 0;
        return { parent: node as SplitBranch, siblingNode: node.children[siblingIdx] };
      }
      const result = this.findParent(child, pane);
      if (result) return result;
    }
    return null;
  }

  private getFirstPane(node: SplitNode): Pane {
    if (node.type === "leaf") return node.pane;
    return this.getFirstPane(node.children[0]);
  }

  private applySplitSizes(branch: SplitBranch) {
    const first = branch.children[0];
    const second = branch.children[1];
    const firstEl = first.type === "leaf" ? first.pane.element : first.element;
    const secondEl = second.type === "leaf" ? second.pane.element : second.element;

    const pct = branch.ratio * 100;
    // Subtract divider width (6px) from available space
    if (branch.direction === "horizontal") {
      firstEl.style.width = `calc(${pct}% - 3px)`;
      firstEl.style.height = "";
      secondEl.style.width = `calc(${100 - pct}% - 3px)`;
      secondEl.style.height = "";
    } else {
      firstEl.style.height = `calc(${pct}% - 3px)`;
      firstEl.style.width = "";
      secondEl.style.height = `calc(${100 - pct}% - 3px)`;
      secondEl.style.width = "";
    }
  }

  private setupDividerDrag(divider: HTMLElement, branch: SplitBranch) {
    let dragging = false;

    divider.addEventListener("mousedown", (e) => {
      e.preventDefault();
      dragging = true;
      document.body.style.cursor = branch.direction === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
      // Disable pointer events on all panes during drag so the xterm canvas
      // doesn't intercept mousemove events or start text selection
      for (const pane of this.panes) {
        pane.element.style.pointerEvents = "none";
      }
    });

    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const rect = branch.element.getBoundingClientRect();
      let ratio: number;
      if (branch.direction === "horizontal") {
        ratio = (e.clientX - rect.left) / rect.width;
      } else {
        ratio = (e.clientY - rect.top) / rect.height;
      }
      branch.ratio = Math.min(0.85, Math.max(0.15, ratio));
      this.applySplitSizes(branch);
      this.fitAllPanes();
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Restore pointer events on all panes
      for (const pane of this.panes) {
        pane.element.style.pointerEvents = "";
      }
      this.fitAllPanes();
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);

    // Track for cleanup — keyed by branch so we can remove on pane close
    this.dividerCleanups.set(branch, () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    });
  }

  private fitAllPanes() {
    for (const pane of this.panes) {
      pane.fit();
    }
  }

  /** Poll process info for the focused pane. Called by TerminalManager. */
  async pollProcessInfo() {
    if (this.pollStopped) return;

    const { pid, disposed } = this.focusedPane.getProcessInfo();
    if (disposed || !pid) return;
    const shellPid = pid;

    const timeout = this.config.advanced.ipcTimeoutMs;

    try {
      const procInfo = await invokeWithTimeout<{ name: string; pid: number }>(
        "get_foreground_process",
        { pid: shellPid },
        timeout,
      );

      const wasIdle = this.state.isIdle;
      const newIsIdle = procInfo.pid === shellPid;

      // Get CWD from the foreground process (not the shell) for more accurate dir tracking
      const cwdPid = newIsIdle ? shellPid : procInfo.pid;
      const [folder, fullCwd] = await Promise.all([
        invokeWithTimeout<string>("get_process_cwd", { pid: cwdPid }, timeout),
        invokeWithTimeout<string>("get_process_cwd_full", { pid: cwdPid }, timeout),
      ]);

      this.state.folderName = folder;
      this.state.processName = newIsIdle ? "" : procInfo.name;
      this.state.isIdle = newIsIdle;

      if (!newIsIdle) {
        this.lastRunningAt = Date.now();
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

      if (!wasIdle && newIsIdle && !this.isVisible) {
        this.state.needsAttention = true;
        if (this.onNeedsAttention) this.onNeedsAttention();
      }

      if (newIsIdle && this.state.activity !== "server-running" && this.state.activity !== "completed") {
        // Grace period: don't snap to idle if we just saw a running process
        // This prevents flicker from short-lived child processes
        const timeSinceRunning = Date.now() - this.lastRunningAt;
        if (this.lastRunningAt === 0 || timeSinceRunning >= Tab.IDLE_GRACE_MS) {
          this.state.activity = "idle";
          this.state.agentName = null;
          this.state.lastError = null;
        }
      }

      if (fullCwd && fullCwd !== this.focusedPane.lastFullCwd) {
        this.focusedPane.lastFullCwd = fullCwd;
        try {
          const [projectName, gitBranch] = await Promise.all([
            invokeWithTimeout<string>("get_project_info", { dir: fullCwd }, timeout),
            invokeWithTimeout<string>("get_git_branch", { dir: fullCwd }, timeout),
          ]);
          this.state.projectName = projectName && projectName !== folder ? projectName : null;
          this.state.gitBranch = gitBranch || null;
        } catch (e) {
          logger.debug("Failed to get project/git info:", e);
        }
      }

      this.updateTitle();
      this.pollFailures = 0;
    } catch (e) {
      this.pollFailures++;
      logger.debug("Poll failed (process may have exited):", e);
      if (this.pollFailures === 5) {
        showToast("Process info unavailable — some tab features may not work", "warn");
      }
      // After 20 consecutive failures, stop polling this tab entirely
      if (this.pollFailures >= 20) {
        this.pollStopped = true;
        logger.warn(`Stopped polling tab ${this.id} after ${this.pollFailures} consecutive failures`);
      }
    }
  }

  toggleSearch() {
    this.focusedPane.toggleSearch();
  }

  writeToPty(data: string) {
    this.focusedPane.writeToPty(data);
  }

  /** Send Ctrl-C to the focused pane's process. */
  sendInterrupt() {
    this.focusedPane.sendInterrupt();
  }

  /** Kill the focused pane's PTY and restart a fresh shell in the same CWD. */
  async restartShell() {
    const pane = this.focusedPane;
    const cwd = pane.lastFullCwd ?? this.cwd;

    // Dispose old pane
    const idx = this.panes.indexOf(pane);
    pane.dispose();

    // Create replacement pane in the same CWD
    const newPane = this.createPane(cwd);

    // Replace in the tree
    if (this.root.type === "leaf" && this.root.pane === pane) {
      this.root = { type: "leaf", pane: newPane };
      this.element.appendChild(newPane.element);
    } else {
      this.replaceLeafPane(this.root, pane, newPane);
    }

    // Remove old pane from list (createPane already added newPane)
    this.panes = this.panes.filter((p) => p !== pane);

    await newPane.start();
    this.focusedPane = newPane;
    for (const p of this.panes) {
      p.element.classList.toggle("pane-focused", p === newPane);
    }
    newPane.focus();

    // Reset tab state
    this.state.activity = "idle";
    this.state.agentName = null;
    this.state.lastError = null;
    this.state.processName = "";
    this.state.isIdle = true;
    this.pollFailures = 0;
    this.pollStopped = false;
    this.updateTitle();

    // Hack: the old pane was already at `idx` in the list; newPane got appended.
    // Reorder so newPane is at the same position.
    if (idx >= 0 && idx < this.panes.length - 1) {
      this.panes.splice(this.panes.indexOf(newPane), 1);
      this.panes.splice(idx, 0, newPane);
    }
  }

  /** Replace a leaf pane reference in the split tree. */
  private replaceLeafPane(node: SplitNode, oldPane: Pane, newPane: Pane): boolean {
    if (node.type !== "split") return false;
    for (let i = 0; i < 2; i++) {
      const child = node.children[i];
      if (child.type === "leaf" && child.pane === oldPane) {
        node.children[i] = { type: "leaf", pane: newPane };
        node.element.replaceChild(newPane.element, oldPane.element);
        return true;
      }
      if (this.replaceLeafPane(child, oldPane, newPane)) return true;
    }
    return false;
  }

  applyConfig(config: Config) {
    this.config = config;
    for (const pane of this.panes) {
      pane.applyConfig(config);
    }
  }

  show() {
    this.isVisible = true;
    this.state.needsAttention = false;
    this.element.classList.add("active");
    requestAnimationFrame(() => {
      this.fitAllPanes();
      this.focusedPane.focus();
    });
  }

  hide() {
    this.isVisible = false;
    this.element.classList.remove("active");
  }

  fit() {
    if (this.element.classList.contains("active")) {
      this.fitAllPanes();
    }
  }

  focus() {
    this.focusedPane.focus();
  }

  dispose() {
    // Clean up document-level divider drag listeners
    for (const cleanup of this.dividerCleanups.values()) {
      cleanup();
    }
    this.dividerCleanups.clear();

    for (const pane of this.panes) {
      pane.dispose();
    }
    this.panes = [];
    this.element.remove();
  }
}
