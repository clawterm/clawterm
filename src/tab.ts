import type { Config } from "./config";
import { invoke } from "@tauri-apps/api/core";
import { invokeWithTimeout } from "./utils";
import {
  type TabState,
  type PaneState,
  createDefaultTabState,
  computeFolderTitle,
  type TabActivity,
} from "./tab-state";
import { type OutputEvent, AGENT_PROCESS_MAP } from "./matchers";
import type { SessionSplitNode } from "./session";
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
  muted = false;
  state: TabState = createDefaultTabState();
  private pollFailures = 0;
  private pollStopped = false;
  private pollStoppedAt = 0;
  private keyHandler?: KeyHandler;
  private cwd: string | undefined;
  /** Grace period before transitioning running→idle (prevents flicker) */
  private static readonly IDLE_GRACE_MS = 1500;

  /** The tree of split panes */
  private root: SplitNode;
  /** The currently focused pane */
  private focusedPane: Pane;
  /** All panes in this tab (flat list for easy iteration) */
  private panes: Pane[] = [];
  /** AbortControllers for document-level drag listeners, keyed by branch */
  private dividerCleanups = new Map<SplitBranch, AbortController>();
  /** Pending rAF ID from show() — cancelled on hide() to prevent stale focus */
  private showRafId: number | null = null;
  /** Pending "completed" → "idle" fade timers per pane, to prevent stacking */
  private fadeTimers = new Map<Pane, ReturnType<typeof setTimeout>>();

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

    // Instant CWD detection: shell sets terminal title on every prompt.
    // Trigger an immediate poll when the title changes (debounced).
    let titlePollTimer: ReturnType<typeof setTimeout> | null = null;

    pane.onExit = (exitCode: number) => {
      // Clear any pending title-poll timer so it doesn't fire after the pane
      // is gone (prevents leaked closures referencing a disposed pane).
      if (titlePollTimer) {
        clearTimeout(titlePollTimer);
        titlePollTimer = null;
      }
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
      this.handleOutputEvent(event, pane);
    };

    pane.onTerminalTitle = () => {
      if (titlePollTimer) clearTimeout(titlePollTimer);
      titlePollTimer = setTimeout(() => {
        this.pollPane(pane)
          .then(() => {
            this.deriveTabState();
            this.updateTitle();
          })
          .catch(() => {});
      }, 100); // 100ms debounce
    };

    this.panes.push(pane);
    return pane;
  }

  private handleOutputEvent(event: OutputEvent, sourcePane?: Pane) {
    logger.debug(
      `[handleOutputEvent] tab=${this.id} type=${event.type} agent=${event.agentName ?? "none"} pane=${sourcePane?.id ?? "unknown"}`,
    );

    // Update per-pane state
    const ps = sourcePane?.state;
    if (ps) {
      switch (event.type) {
        case "agent-waiting":
          ps.activity = "agent-waiting";
          if (event.agentName) ps.agentName = event.agentName;
          break;
        case "server-started":
          ps.activity = "server-running";
          if (event.port) ps.serverPort = event.port;
          break;
        case "server-crashed":
          ps.activity = "error";
          ps.lastError = "Server crashed";
          break;
        case "error":
          ps.activity = "error";
          ps.lastError = event.detail.slice(0, 50);
          break;
        case "agent-completed": {
          ps.activity = "completed";
          // Clear any existing fade timer for this pane to prevent stacking
          const prev = sourcePane ? this.fadeTimers.get(sourcePane) : undefined;
          if (prev) clearTimeout(prev);
          if (sourcePane)
            this.fadeTimers.set(
              sourcePane,
              setTimeout(() => {
                this.fadeTimers.delete(sourcePane);
                if (ps.activity === "completed") {
                  ps.activity = "idle";
                  this.deriveTabState();
                  this.updateTitle();
                }
              }, this.config.advanced.completedFadeMs),
            );
          break;
        }
      }
      logger.debug(
        `[handleOutputEvent] pane=${sourcePane?.id} paneState activity=${ps.activity} agent=${ps.agentName}`,
      );
    }

    // Update tab-level state
    switch (event.type) {
      case "agent-waiting":
        this.state.activity = "agent-waiting";
        if (event.agentName) this.state.agentName = event.agentName;
        if (!this.isVisible && !this.muted) {
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
        if (!this.isVisible && !this.muted) {
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
      const displayTitle = computeFolderTitle(this.state);
      if (displayTitle !== this.title) {
        logger.debug(`[updateTitle] tab=${this.id} "${this.title}" -> "${displayTitle}"`);
        this.title = displayTitle;
        this.onTitleChange?.(displayTitle);
      }
    }
  }

  async start(): Promise<boolean> {
    const container = document.getElementById("terminal-container")!;
    container.appendChild(this.element);

    // Mount the root pane
    this.element.appendChild(this.focusedPane.element);
    const ok = await this.focusedPane.start();
    this.focusedPane.element.classList.add("pane-focused");
    return ok;
  }

  /** Split the focused pane in the given direction */
  async split(direction: SplitDirection) {
    logger.debug(`[split] tab=${this.id} direction=${direction} panesBefore=${this.panes.length}`);
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

    // Replace the old leaf in the tree — swaps the pane's DOM element
    // with the split container. The pane element is briefly detached.
    this.replaceNode(paneToSplit, newBranch);

    // Build the DOM — re-add old pane + divider + new pane into the container
    splitContainer.appendChild(paneToSplit.element);
    splitContainer.appendChild(divider);
    splitContainer.appendChild(newPane.element);

    // Apply sizes
    this.applySplitSizes(newBranch);

    // Setup divider drag
    this.setupDividerDrag(divider, newBranch);

    // Start the new pane's PTY
    const ok = await newPane.start();

    if (!ok) {
      // PTY spawn failed — revert the split
      logger.warn("Split failed: PTY spawn failed for new pane");
      this.panes = this.panes.filter((p) => p !== newPane);
      newPane.dispose();

      // Clean up divider drag listeners
      const ac = this.dividerCleanups.get(newBranch);
      if (ac) {
        ac.abort();
        this.dividerCleanups.delete(newBranch);
      }

      // Revert tree: replace the branch with just the original pane
      this.replaceNode(newBranch, { type: "leaf", pane: paneToSplit });
      splitContainer.remove();

      // Clear stale inline sizes on the surviving pane
      paneToSplit.element.style.width = "";
      paneToSplit.element.style.height = "";

      // Reset focusedPane back to the original pane so it doesn't reference
      // the disposed newPane (fixes #140)
      this.focusedPane = paneToSplit;
      for (const p of this.panes) {
        p.element.classList.toggle("pane-focused", p === paneToSplit);
      }

      showToast("Failed to start terminal in split pane", "error");
      requestAnimationFrame(() => this.fitAllPanes());
      return;
    }

    // Focus the new pane (only if tab is still visible — user may have switched away)
    this.focusedPane = newPane;
    for (const p of this.panes) {
      p.element.classList.toggle("pane-focused", p === newPane);
    }
    if (this.isVisible) newPane.focus();

    logger.debug(`[split] tab=${this.id} panesAfter=${this.panes.length} newPane=${newPane.id}`);

    // Refit all panes after layout change
    requestAnimationFrame(() => this.fitAllPanes());
  }

  /** Close a specific pane */
  private closePane(paneToClose: Pane) {
    logger.debug(`[closePane] tab=${this.id} pane=${paneToClose.id} panesBefore=${this.panes.length}`);
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
    const ac = this.dividerCleanups.get(parent);
    if (ac) {
      ac.abort();
      this.dividerCleanups.delete(parent);
    }

    logger.debug(`[closePane] tab=${this.id} panesAfter=${this.panes.length}`);
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
    this.setFocusedPane(next);
  }

  /** Cycle focus to the previous pane */
  focusPrevPane() {
    if (this.panes.length <= 1) return;
    const idx = this.panes.indexOf(this.focusedPane);
    const prev = this.panes[(idx - 1 + this.panes.length) % this.panes.length];
    this.setFocusedPane(prev);
  }

  /** Jump to pane by 0-based index */
  focusPaneByIndex(index: number) {
    if (index < 0 || index >= this.panes.length) return;
    this.setFocusedPane(this.panes[index]);
  }

  get paneCount(): number {
    return this.panes.length;
  }

  private setFocusedPane(pane: Pane) {
    this.focusedPane = pane;
    for (const p of this.panes) {
      p.element.classList.toggle("pane-focused", p === pane);
    }
    pane.focus();
    this.showPaneNumberOverlay(pane);
  }

  /** Show a brief pane number overlay on the focused pane */
  private showPaneNumberOverlay(pane: Pane) {
    if (this.panes.length <= 1) return;
    // Remove existing overlay from all panes
    for (const p of this.panes) {
      p.element.querySelector(".pane-number-overlay")?.remove();
    }
    const overlay = document.createElement("div");
    overlay.className = "pane-number-overlay";
    overlay.textContent = String(this.panes.indexOf(pane) + 1);
    pane.element.appendChild(overlay);
    // Auto-remove after animation
    setTimeout(() => overlay.remove(), 1500);
  }

  /** Resize the focused pane in a direction by adjusting the parent split ratio */
  resizeFocusedPane(direction: "left" | "right" | "up" | "down", step = 0.05) {
    const parentInfo = this.findPaneBranch(this.root, this.focusedPane);
    if (!parentInfo) return;
    const { branch, childIndex } = parentInfo;

    // Only resize along the branch's split direction
    let delta: number;
    if (branch.direction === "horizontal" && (direction === "left" || direction === "right")) {
      delta = direction === "right" ? step : -step;
    } else if (branch.direction === "vertical" && (direction === "up" || direction === "down")) {
      delta = direction === "down" ? step : -step;
    } else {
      return; // Direction doesn't match split axis
    }

    // If focused pane is the second child, invert the delta
    if (childIndex === 1) delta = -delta;

    branch.ratio = Math.min(0.85, Math.max(0.15, branch.ratio + delta));
    this.applySplitSizes(branch);
    this.fitAllPanes();
  }

  /** Find the parent branch of a pane and which child index it's in */
  private findPaneBranch(node: SplitNode, pane: Pane): { branch: SplitBranch; childIndex: number } | null {
    if (node.type !== "split") return null;
    for (let i = 0; i < 2; i++) {
      const child = node.children[i];
      if (child.type === "leaf" && child.pane === pane) {
        return { branch: node, childIndex: i };
      }
      const result = this.findPaneBranch(child, pane);
      if (result) return result;
    }
    return null;
  }

  /** Reset all splits to equal ratios */
  balanceSplits() {
    this.balanceNode(this.root);
    this.fitAllPanes();
  }

  private balanceNode(node: SplitNode) {
    if (node.type !== "split") return;
    node.ratio = 0.5;
    this.applySplitSizes(node);
    this.balanceNode(node.children[0]);
    this.balanceNode(node.children[1]);
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
    // Subtract divider width from available space
    const DIVIDER_PX = 9;
    const half = DIVIDER_PX / 2;
    if (branch.direction === "horizontal") {
      firstEl.style.width = `calc(${pct}% - ${half}px)`;
      firstEl.style.height = "";
      secondEl.style.width = `calc(${100 - pct}% - ${half}px)`;
      secondEl.style.height = "";
    } else {
      firstEl.style.height = `calc(${pct}% - ${half}px)`;
      firstEl.style.width = "";
      secondEl.style.height = `calc(${100 - pct}% - ${half}px)`;
      secondEl.style.width = "";
    }
  }

  private setupDividerDrag(divider: HTMLElement, branch: SplitBranch) {
    let dragging = false;

    // Double-click to auto-balance (50/50)
    divider.addEventListener("dblclick", (e) => {
      e.preventDefault();
      branch.ratio = 0.5;
      this.applySplitSizes(branch);
      this.fitAllPanes();
    });

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
      // Guard against zero-dimension containers (window minimized, etc.)
      if (rect.width === 0 || rect.height === 0) return;
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

    // Use an AbortController so all document-level listeners are cleaned up
    // atomically — even if manual cleanup is missed, aborting the signal
    // guarantees removal.
    const ac = new AbortController();
    document.addEventListener("mousemove", onMove, { signal: ac.signal });
    document.addEventListener("mouseup", onUp, { signal: ac.signal });

    // Track for cleanup — keyed by branch so we can remove on pane close
    this.dividerCleanups.set(branch, ac);
  }

  private fitAllPanes() {
    for (const pane of this.panes) {
      pane.fit();
    }
  }

  /** Get per-pane states for rendering in the sidebar */
  getPaneStates(): PaneState[] {
    return this.panes.map((p) => p.state);
  }

  /** Poll process info for ALL panes. Called by TerminalManager. */
  async pollProcessInfo() {
    if (this.pollStopped) {
      // Resume polling if: (a) any pane produced output since we stopped, OR
      // (b) enough time has passed (30s) to retry in case the process is idle
      // but alive (e.g., shell waiting for input produces no output).
      const hasRecentOutput = this.panes.some(
        (p) => !p.getProcessInfo().disposed && p.lastOutputAt > this.pollStoppedAt,
      );
      const retryElapsed = Date.now() - this.pollStoppedAt > 30_000;
      if (hasRecentOutput || retryElapsed) {
        this.pollStopped = false;
        this.pollFailures = 0;
        logger.debug(`[pollProcessInfo] tab=${this.id} resuming poll — pane output detected`);
      } else {
        return;
      }
    }

    // Poll all panes concurrently
    const pollable = this.panes.filter((p) => !p.getProcessInfo().disposed && p.getProcessInfo().pid);
    logger.debug(`[pollProcessInfo] tab=${this.id} panes=${this.panes.length} pollable=${pollable.length}`);
    const polls = pollable.map((pane) => this.pollPane(pane).catch(() => {}));

    await Promise.all(polls);

    // Derive tab-level state from all pane states
    this.deriveTabState();
    this.updateTitle();
  }

  /** Poll a single pane's process info and update its PaneState */
  private async pollPane(pane: Pane) {
    const { pid, disposed } = pane.getProcessInfo();
    if (disposed || !pid) return;
    const shellPid = pid;
    const ps = pane.state;

    const timeout = this.config.advanced.ipcTimeoutMs;

    try {
      // Use tcgetpgrp via pty plugin to get the foreground process group leader.
      // This is more reliable than proc_listchildpids for PTY-spawned shells.
      const fgPgid =
        pane.ptyHandle != null
          ? await invoke<number>("plugin:pty|foreground_pid", { pid: pane.ptyHandle }).catch(() => shellPid)
          : shellPid;

      logger.debug(
        `[pollPane] pane=${pane.id} shellPid=${shellPid} fgPgid=${fgPgid} ptyHandle=${pane.ptyHandle}`,
      );

      // Now get the deepest child of the foreground group leader
      const procInfo =
        fgPgid !== shellPid
          ? await invokeWithTimeout<{ name: string; pid: number }>(
              "get_foreground_process",
              { pid: fgPgid },
              timeout,
            )
          : { name: "zsh", pid: shellPid };

      logger.debug(`[pollPane] pane=${pane.id} procInfo name=${procInfo.name} pid=${procInfo.pid}`);

      const wasIdle = ps.isIdle;
      const newIsIdle = fgPgid === shellPid;

      // Track foreground PID for agent detection
      pane.lastFgPid = newIsIdle ? shellPid : procInfo.pid;

      logger.debug(`[pollPane] pane=${pane.id} idle=${newIsIdle} wasIdle=${wasIdle}`);

      // Always look up shell CWD — it's cheap and the user may have cd'd.
      // Use allSettled so one failure doesn't kill the entire poll cycle.
      const cwdResults = await Promise.allSettled([
        invokeWithTimeout<string>("get_process_cwd", { pid: shellPid }, timeout),
        invokeWithTimeout<string>("get_process_cwd_full", { pid: shellPid }, timeout),
      ]);
      const folder = cwdResults[0].status === "fulfilled" ? cwdResults[0].value : ps.folderName;
      const fullCwd = cwdResults[1].status === "fulfilled" ? cwdResults[1].value : null;

      ps.folderName = folder;
      ps.processName = newIsIdle ? "" : procInfo.name;
      ps.isIdle = newIsIdle;

      logger.debug(`[pollPane] pane=${pane.id} cwd=${folder} fullCwd=${fullCwd}`);

      if (!newIsIdle) {
        pane.lastRunningAt = Date.now();
        const agentId = AGENT_PROCESS_MAP[procInfo.name.toLowerCase()];
        logger.debug(
          `[pollPane] pane=${pane.id} agentDetect name=${procInfo.name} agentId=${agentId ?? "none"}`,
        );
        if (agentId) {
          if (ps.agentName !== agentId) {
            ps.agentStartedAt = Date.now();
          }
          ps.agentName = agentId;
          // If the agent hasn't produced output for a long time, it's likely
          // waiting for user input.  Use a generous threshold to avoid false
          // positives — agents regularly pause 5-10s while thinking or running
          // tools.  Pattern-based detection (matchers.ts) handles the fast path.
          const agentOutputAge = Date.now() - pane.lastOutputAt;
          if (agentOutputAge > 8000) {
            ps.activity = "agent-waiting";
          } else if (ps.activity === "idle" || ps.activity === "agent-waiting") {
            ps.activity = "running";
          }
        } else if (ps.activity !== "server-running" && ps.activity !== "error") {
          ps.activity = "running";
        }
      }

      // Needs attention: background pane went from running to idle
      if (!wasIdle && newIsIdle && !this.isVisible && !this.muted) {
        this.state.needsAttention = true;
        this.onNeedsAttention?.();
      }

      if (newIsIdle && ps.activity !== "server-running" && ps.activity !== "completed") {
        const timeSinceRunning = Date.now() - pane.lastRunningAt;
        if (pane.lastRunningAt === 0 || timeSinceRunning >= Tab.IDLE_GRACE_MS) {
          const prevActivity = ps.activity;
          ps.activity = "idle";
          ps.agentName = null;
          ps.agentStartedAt = null;
          ps.lastError = null;
          if (prevActivity !== "idle") {
            logger.debug(`[pollPane] pane=${pane.id} activity ${prevActivity} -> idle (grace elapsed)`);
          }
        }
      }

      if (fullCwd && fullCwd !== pane.lastFullCwd) {
        pane.lastFullCwd = fullCwd;
        // Get project/git info for the focused pane (determines tab title)
        if (pane === this.focusedPane) {
          try {
            const [projectName, gitBranch] = await Promise.all([
              invokeWithTimeout<string>("get_project_info", { dir: fullCwd }, timeout),
              invokeWithTimeout<string>("get_git_branch", { dir: fullCwd }, timeout),
            ]);
            this.state.projectName = projectName || null;
            this.state.gitBranch = gitBranch || null;
          } catch (e) {
            logger.debug("Failed to get project/git info:", e);
          }
        }
      }

      this.pollFailures = 0;
    } catch (e) {
      this.pollFailures++;
      logger.debug("Poll failed (process may have exited):", e);
      if (this.pollFailures === 5) {
        showToast("Process info unavailable — some tab features may not work", "warn");
      }
      if (this.pollFailures >= 20) {
        this.pollStopped = true;
        this.pollStoppedAt = Date.now();
        logger.warn(`Stopped polling tab ${this.id} after ${this.pollFailures} consecutive failures`);
      }
    }
  }

  /** Derive tab-level state from all pane states */
  private deriveTabState() {
    const fps = this.focusedPane.state;

    // Tab folder = focused pane's (follows the user)
    this.state.folderName = fps.folderName;
    this.state.processName = fps.processName;
    this.state.isIdle = fps.isIdle;

    // Tab activity = highest priority across all panes
    const ACTIVITY_PRIORITY: TabActivity[] = [
      "error",
      "agent-waiting",
      "running",
      "server-running",
      "completed",
      "idle",
    ];
    let bestActivity: TabActivity = "idle";
    let bestAgent: string | null = null;
    let bestAgentStartedAt: number | null = null;
    let bestServerPort: number | null = null;
    let bestError: string | null = null;

    for (const pane of this.panes) {
      const ps = pane.state;
      if (ACTIVITY_PRIORITY.indexOf(ps.activity) < ACTIVITY_PRIORITY.indexOf(bestActivity)) {
        bestActivity = ps.activity;
      }
      if (ps.agentName && !bestAgent) {
        bestAgent = ps.agentName;
        bestAgentStartedAt = ps.agentStartedAt;
      }
      if (ps.serverPort && !bestServerPort) bestServerPort = ps.serverPort;
      if (ps.lastError && !bestError) bestError = ps.lastError;
    }

    this.state.activity = bestActivity;
    this.state.agentName = bestAgent;
    this.state.agentStartedAt = bestAgentStartedAt;
    this.state.serverPort = bestServerPort;
    this.state.lastError = bestError;

    logger.debug(
      `[deriveTabState] tab=${this.id} activity=${bestActivity} agent=${bestAgent} folder=${this.state.folderName}`,
    );
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
    // Two-frame delay: first frame lets the DOM settle (display: flex applied),
    // second frame ensures xterm has dimensions before we focus.
    // Track the rAF so hide() can cancel it if the user switches away quickly.
    this.showRafId = requestAnimationFrame(() => {
      this.fitAllPanes();
      // Re-activate WebGL for this tab's panes (freed on hide to save GPU contexts)
      for (const pane of this.panes) pane.activateWebGL();
      this.showRafId = requestAnimationFrame(() => {
        this.showRafId = null;
        if (this.isVisible) this.focusedPane.focus();
      });
    });
  }

  hide() {
    this.isVisible = false;
    this.element.classList.remove("active");
    // Cancel any pending show() rAF to prevent stale focus stealing
    if (this.showRafId !== null) {
      cancelAnimationFrame(this.showRafId);
      this.showRafId = null;
    }
    // Free WebGL contexts for hidden tabs — canvas fallback keeps rendering.
    // This allows unlimited total panes across tabs without GPU exhaustion.
    for (const pane of this.panes) pane.deactivateWebGL();
  }

  fit() {
    if (this.element.classList.contains("active")) {
      this.fitAllPanes();
    }
  }

  focus() {
    this.focusedPane.focus();
  }

  /** Serialize the split tree for session persistence. */
  serializeSplits(): SessionSplitNode | undefined {
    if (this.panes.length <= 1) return undefined;
    return this.serializeNode(this.root);
  }

  private serializeNode(node: SplitNode): SessionSplitNode {
    if (node.type === "leaf") {
      return { type: "leaf", cwd: node.pane.lastFullCwd ?? "" };
    }
    return {
      type: "split",
      direction: node.direction,
      ratio: node.ratio,
      children: [this.serializeNode(node.children[0]), this.serializeNode(node.children[1])],
    };
  }

  /** Restore splits from a serialized tree. Call after start(). */
  async restoreSplits(layout: SessionSplitNode): Promise<void> {
    if (layout.type !== "split") return;
    await this.restoreNode(layout);
  }

  private async restoreNode(node: SessionSplitNode): Promise<void> {
    if (node.type !== "split") return;

    // Remember the pane that will be split (currently focused)
    const originalPane = this.focusedPane;
    const paneCountBefore = this.panes.length;

    // Split it — after this, focusedPane = the NEW pane (child[1] side)
    await this.split(node.direction);
    const newPane = this.focusedPane;

    // If split failed (PTY spawn error, pane limit, etc.) the tree was reverted.
    // Bail out to avoid recursing into a subtree that doesn't exist.
    if (this.panes.length === paneCountBefore || newPane === originalPane) {
      logger.warn("[restoreNode] split failed, skipping subtree");
      return;
    }

    // Find the branch containing these two panes and adjust ratio
    const branch = this.findBranchWith(this.root, originalPane, newPane);
    if (branch) {
      branch.ratio = node.ratio;
      this.applySplitSizes(branch);
    }

    // Recurse into child[1] (new pane, currently focused)
    if (node.children[1].type === "split") {
      await this.restoreNode(node.children[1]);
    }

    // Recurse into child[0] (original pane — need to focus it first)
    if (node.children[0].type === "split") {
      this.setFocusedPane(originalPane);
      await this.restoreNode(node.children[0]);
    }

    this.fitAllPanes();
  }

  /** Find the SplitBranch that directly contains both panes as leaves. */
  private findBranchWith(node: SplitNode, a: Pane, b: Pane): SplitBranch | null {
    if (node.type === "leaf") return null;
    const hasA = this.treeContainsPane(node.children[0], a) || this.treeContainsPane(node.children[1], a);
    const hasB = this.treeContainsPane(node.children[0], b) || this.treeContainsPane(node.children[1], b);
    if (hasA && hasB) {
      // Check children first for a tighter match
      const deeper =
        this.findBranchWith(node.children[0], a, b) ?? this.findBranchWith(node.children[1], a, b);
      return deeper ?? node;
    }
    return null;
  }

  private treeContainsPane(node: SplitNode, pane: Pane): boolean {
    if (node.type === "leaf") return node.pane === pane;
    return this.treeContainsPane(node.children[0], pane) || this.treeContainsPane(node.children[1], pane);
  }

  dispose() {
    // Clear any pending fade timers
    for (const timer of this.fadeTimers.values()) clearTimeout(timer);
    this.fadeTimers.clear();

    // Clean up document-level divider drag listeners
    for (const ac of this.dividerCleanups.values()) {
      ac.abort();
    }
    this.dividerCleanups.clear();

    for (const pane of this.panes) {
      try {
        pane.dispose();
      } catch (e) {
        logger.warn("Pane dispose failed:", e);
      }
    }
    this.panes = [];
    this.element.remove();
  }
}
