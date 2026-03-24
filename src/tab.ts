import type { Config } from "./config";
import { invoke } from "@tauri-apps/api/core";
import { invokeWithTimeout } from "./utils";
import {
  type TabState,
  type PaneState,
  type GitStatusInfo,
  createDefaultTabState,
  computeFolderTitle,
} from "./tab-state";
import { type OutputEvent, AGENT_PROCESS_MAP } from "./matchers";
import type { SessionSplitNode, SessionSplitLeaf } from "./session";
import { logger } from "./logger";
import { showToast } from "./toast";
import { Pane, type KeyHandler } from "./pane";
import { computeAdaptiveTimeout, hasWorkingPatterns } from "./tab-polling";

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
  /** If this tab is in a git worktree, the worktree directory path */
  worktreePath: string | null = null;
  /** The repo root this worktree belongs to */
  repoRoot: string | null = null;
  state: TabState = createDefaultTabState();
  private pollFailures = 0;
  private pollStopped = false;
  private pollStoppedAt = 0;
  private keyHandler?: KeyHandler;
  private cwd: string | undefined;
  /** Grace period before transitioning running→idle (prevents flicker) */
  private static readonly IDLE_GRACE_MS = 1500;
  /** Minimum adaptive agent idle timeout (ms) — floor for waiting detection */
  private static readonly MIN_AGENT_IDLE_MS = 15_000;
  /** Maximum adaptive agent idle timeout (ms) — cap for extreme cases */
  private static readonly MAX_AGENT_IDLE_MS = 60_000;
  /** Default agent idle timeout when insufficient gap data — conservative */
  private static readonly DEFAULT_AGENT_IDLE_MS = 20_000;

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
  /** True during show/hide transition — used to suppress ResizeObserver fits */
  transitioning = false;
  /** Pending "completed" → "idle" fade timers per pane, to prevent stacking */
  private fadeTimers = new Map<Pane, ReturnType<typeof setTimeout>>();

  onExit: (() => void) | null = null;
  onTitleChange: ((title: string) => void) | null = null;
  onNeedsAttention: (() => void) | null = null;
  onOutputEvent: ((event: OutputEvent) => void) | null = null;
  /** Called when a pane is closed, with worktree info for cleanup */
  onPaneClose: ((pane: Pane) => void) | null = null;

  // Expose for process polling — returns the focused pane's PTY pid
  get ptyPid(): number | null {
    return this.focusedPane.ptyPid;
  }

  get lastFullCwd(): string | null {
    return this.focusedPane.lastFullCwd;
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
      this.updateFocusedClass(pane);
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

    pane.onTerminalTitle = (title) => {
      // Parse agent status from the terminal title (Claude Code sets informative titles)
      this.parseAgentTitle(title, pane);

      if (titlePollTimer) clearTimeout(titlePollTimer);
      titlePollTimer = setTimeout(() => {
        this.pollPane(pane)
          .then(() => {
            this.deriveTabState();
            this.updateTitle();
          })
          .catch((e) => logger.debug("[pollPane] output event poll failed:", e));
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
      // Clear "just started" flag on any output event from the agent
      if (ps.agentJustStarted) ps.agentJustStarted = false;

      switch (event.type) {
        case "agent-waiting":
          ps.activity = "agent-waiting";
          // Determine waiting type: if the event was fired from an interactive
          // prompt matcher, it's waiting for user input.
          ps.waitingType = event.detail.match(/\[Y\/n\]|Approve|Allow|Continue|proceed/i)
            ? "user"
            : "unknown";
          if (event.agentName) ps.agentName = event.agentName;
          ps.lastAction = null;
          break;
        case "agent-working":
          // Agent is actively working — reset from any idle/waiting state
          if (ps.activity === "agent-waiting" || ps.activity === "idle") {
            ps.activity = "running";
          }
          ps.waitingType = "unknown";
          if (event.agentName) ps.agentName = event.agentName;
          // Capture the specific action and increment counter
          if (event.detail) {
            const action = event.detail.slice(0, 60);
            if (action !== ps.lastAction) {
              ps.actionCount++;
              ps.lastAction = action;
            }
          }
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
          ps.lastAction = null;
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
                  ps.actionCount = 0;
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
        this.state.waitingType = ps?.waitingType ?? "unknown";
        if (event.agentName) this.state.agentName = event.agentName;
        if (!this.isVisible && !this.muted) {
          this.state.needsAttention = true;
          this.state.notification = "needs-input";
          this.onNeedsAttention?.();
        }
        break;
      case "agent-working":
        // Agent actively working — override any idle/waiting state
        if (this.state.activity === "agent-waiting") {
          this.state.activity = "running";
        }
        this.state.waitingType = "unknown";
        if (event.agentName) this.state.agentName = event.agentName;
        if (event.detail) {
          const action = event.detail.slice(0, 60);
          if (action !== this.state.lastAction) {
            this.state.actionCount++;
            this.state.lastAction = action;
          }
        }
        break;
      case "server-started":
        this.state.activity = "server-running";
        if (event.port) this.state.serverPort = event.port;
        if (!this.isVisible && !this.muted) {
          this.state.notification = "server-started";
          // Auto-clear server-started notification after 5s
          setTimeout(() => {
            if (this.state.notification === "server-started") {
              this.state.notification = null;
              this.updateTitle();
            }
          }, 5000);
        }
        break;
      case "server-crashed":
        this.state.activity = "error";
        this.state.lastError = "Server crashed";
        if (!this.isVisible && !this.muted) {
          this.state.needsAttention = true;
          this.state.notification = "server-crashed";
          this.onNeedsAttention?.();
        }
        break;
      case "error":
        this.state.activity = "error";
        this.state.lastError = event.detail.slice(0, 50);
        if (!this.isVisible && !this.muted) {
          this.state.needsAttention = true;
          this.state.notification = "error";
          this.onNeedsAttention?.();
        }
        break;
      case "agent-completed":
        this.state.activity = "completed";
        this.state.lastAction = null;
        if (!this.isVisible && !this.muted) {
          this.state.needsAttention = true;
          this.state.notification = "completed";
          this.onNeedsAttention?.();
        }
        // Don't auto-fade completion for background tabs — keep badge until focused
        if (this.isVisible) {
          setTimeout(() => {
            if (this.state.activity === "completed") {
              this.state.activity = "idle";
              this.state.actionCount = 0;
              this.updateTitle();
            }
          }, this.config.advanced.completedFadeMs);
        }
        break;
    }

    this.updateTitle();
    this.onOutputEvent?.(event);
  }

  /** Parse agent status from the terminal title string (OSC 0/2).
   *  Claude Code sets titles like "Reading src/auth.ts" or "claude: session-name".
   *  Other agents may set similar informative titles. */
  private parseAgentTitle(title: string, pane: Pane) {
    if (!title || !pane.state.agentName) return;

    // Match tool-use patterns in the title (e.g., "Reading src/foo.ts")
    const toolMatch = title.match(
      /^(Reading|Writing|Editing|Creating|Searching|Running|Thinking)\b(.{0,60})/,
    );
    if (toolMatch) {
      const action = toolMatch[0].trim();
      pane.state.lastAction = action;
      this.state.lastAction = action;
      this.updateTitle();
    }
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

  /** Get the currently focused pane */
  getFocusedPane(): Pane {
    return this.focusedPane;
  }

  /** Split the focused pane with a specific CWD (used for split-to-branch) */
  async splitWithCwd(direction: SplitDirection, cwd: string): Promise<void> {
    logger.debug(`[splitWithCwd] tab=${this.id} direction=${direction} cwd=${cwd}`);
    if (this.panes.length >= this.config.maxPanes) {
      showToast(`Pane limit reached (${this.config.maxPanes})`, "warn");
      return;
    }
    await this.splitInternal(direction, cwd);
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

    await this.splitInternal(direction, cwd);
  }

  /** Internal split implementation — creates a new pane in the given CWD */
  private async splitInternal(direction: SplitDirection, cwd: string | undefined) {
    const paneToSplit = this.focusedPane;
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
      this.updateFocusedClass(paneToSplit);

      showToast("Failed to start terminal in split pane", "error");
      requestAnimationFrame(() => this.fitAllPanes());
      return;
    }

    // Focus the new pane (only if tab is still visible — user may have switched away)
    this.focusedPane = newPane;
    this.updateFocusedClass(newPane);
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

    // Notify listener before disposing (for worktree cleanup)
    this.onPaneClose?.(paneToClose);

    // Remove the pane from panes list
    this.panes = this.panes.filter((p) => p !== paneToClose);
    paneToClose.dispose();

    // Replace the parent split with the surviving sibling
    this.replaceNode(parent, siblingNode);

    // Clear stale inline sizes on the surviving element — revert to CSS flex: 1
    const survivingEl = siblingNode.type === "leaf" ? siblingNode.pane.element : siblingNode.element;
    survivingEl.style.flex = "";
    survivingEl.style.width = "";
    survivingEl.style.height = "";

    // If the closed pane was focused, focus the surviving pane
    if (this.focusedPane === paneToClose) {
      const nextFocus = this.getFirstPane(siblingNode);
      this.focusedPane = nextFocus;
      this.updateFocusedClass(nextFocus);
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
    requestAnimationFrame(() => this.forceFitAllPanes());
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



  /** Update DOM classes so only the given pane has the focused outline */
  private updateFocusedClass(pane: Pane) {
    for (const p of this.panes) {
      p.element.classList.toggle("pane-focused", p === pane);
    }
  }

  private setFocusedPane(pane: Pane) {
    this.focusedPane = pane;
    this.updateFocusedClass(pane);
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
    // Subtract divider width from available space — must match CSS --split-divider-width
    const dividerPx = this.config.theme.ui?.splitDividerWidth ?? 9;
    const half = dividerPx / 2;
    // Use flex shorthand to override the CSS `flex: 1` on .pane / .split-container.
    // Setting width/height alone has no effect because flex-basis: 0% (from flex: 1)
    // takes priority over width/height in the flex algorithm.
    // `flex: 0 0 <basis>` = no grow, no shrink, explicit basis.
    firstEl.style.flex = `0 0 calc(${pct}% - ${half}px)`;
    secondEl.style.flex = `0 0 calc(${100 - pct}% - ${half}px)`;
  }

  private setupDividerDrag(divider: HTMLElement, branch: SplitBranch) {
    let dragging = false;
    let rafId = 0;

    // Double-click to auto-balance (50/50)
    divider.addEventListener("dblclick", (e) => {
      e.preventDefault();
      branch.ratio = 0.5;
      this.applySplitSizes(branch);
      this.forceFitAllPanes();
    });

    const startDrag = (e: Event) => {
      e.preventDefault();
      dragging = true;
      document.body.style.cursor = branch.direction === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
      // Disable pointer events on all panes during drag so the xterm canvas
      // doesn't intercept mousemove events or start text selection
      for (const pane of this.panes) {
        pane.element.style.pointerEvents = "none";
      }
    };

    divider.addEventListener("mousedown", startDrag);
    divider.addEventListener("touchstart", startDrag, { passive: false });

    const positionFromEvent = (e: MouseEvent | TouchEvent): { x: number; y: number } | null => {
      if ("touches" in e) {
        const t = e.touches[0];
        return t ? { x: t.clientX, y: t.clientY } : null;
      }
      return { x: e.clientX, y: e.clientY };
    };

    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragging) return;
      const pos = positionFromEvent(e);
      if (!pos) return;
      const rect = branch.element.getBoundingClientRect();
      // Guard against zero-dimension containers (window minimized, etc.)
      if (rect.width === 0 || rect.height === 0) return;
      let ratio: number;
      if (branch.direction === "horizontal") {
        ratio = (pos.x - rect.left) / rect.width;
      } else {
        ratio = (pos.y - rect.top) / rect.height;
      }
      branch.ratio = Math.min(0.85, Math.max(0.15, ratio));
      // Apply CSS + refit terminals synchronously so both panes resize
      // together with the divider.  Using forceFit() bypasses the output-
      // activity deferral — during drag, immediate feedback matters more.
      // Previous approach deferred fit to rAF, causing one pane's content
      // to lag behind the CSS layout change and appear "stuck" (#183).
      this.applySplitSizes(branch);
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          this.forceFitAllPanes();
        });
      }
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Restore pointer events on all panes
      for (const pane of this.panes) {
        pane.element.style.pointerEvents = "";
      }
      // Final fit after drag completes — force-fit to ensure both panes
      // have correct dimensions regardless of output activity.
      this.forceFitAllPanes();
    };

    // Use an AbortController so all document-level listeners are cleaned up
    // atomically — even if manual cleanup is missed, aborting the signal
    // guarantees removal.
    const ac = new AbortController();
    document.addEventListener("mousemove", onMove as EventListener, { signal: ac.signal });
    document.addEventListener("mouseup", onUp, { signal: ac.signal });
    document.addEventListener("touchmove", onMove as EventListener, {
      signal: ac.signal,
      passive: false,
    });
    document.addEventListener("touchend", onUp, { signal: ac.signal });

    // Track for cleanup — keyed by branch so we can remove on pane close
    this.dividerCleanups.set(branch, ac);
  }

  private fitAllPanes() {
    for (const pane of this.panes) {
      pane.fit();
    }
  }

  /** Force-fit all panes immediately, bypassing the output-activity deferral.
   *  Used during divider drag and other user-initiated resizes where immediate
   *  visual feedback is more important than avoiding write/fit races. */
  private forceFitAllPanes() {
    for (const pane of this.panes) {
      pane.forceFit();
    }
  }

  /** Get per-pane states for rendering in the sidebar */
  getPaneStates(): PaneState[] {
    return this.panes.map((p) => p.state);
  }

  /** Get all panes (for worktree cleanup on tab close, etc.) */
  getPanes(): readonly Pane[] {
    return this.panes;
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
    const polls = pollable.map((pane) =>
      this.pollPane(pane).catch((e) => logger.debug("[pollPane] error:", e)),
    );

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
          ? await invoke<number>("plugin:pty|foreground_pid", { pid: pane.ptyHandle }).catch(() => shellPid) // Fall back to shell PID on error (expected on Windows)
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
            // New agent detected — mark as "just started" for the UI
            ps.agentStartedAt = Date.now();
            ps.agentJustStarted = true;
            ps.actionCount = 0;
            // Auto-clear the startup flag after 3 seconds
            setTimeout(() => {
              ps.agentJustStarted = false;
            }, 3000);
          }
          ps.agentName = agentId;

          // Adaptive idle detection: if the agent has been silent past the
          // adaptive threshold, check buffer patterns and child processes
          // before marking as waiting. Only one stage — no speculative states.
          const agentOutputAge = Date.now() - pane.lastOutputAt;
          const idleThreshold = this.getAdaptiveTimeout(pane);

          if (agentOutputAge > idleThreshold) {
            if (ps.activity !== "agent-waiting") {
              const bufferWorking = this.scanBufferForWorkingPatterns(pane);
              const hasChildren = await this.checkActiveChildren(procInfo.pid);
              if (bufferWorking || hasChildren) {
                ps.activity = "running";
              } else {
                ps.activity = "agent-waiting";
                ps.waitingType = ps.lastAction ? "api" : "unknown";
                if (!this.isVisible && !this.muted) {
                  this.state.needsAttention = true;
                  this.state.notification = "needs-input";
                  this.onNeedsAttention?.();
                }
              }
            }
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
          ps.lastAction = null;
          ps.waitingType = "unknown";
          ps.actionCount = 0;
          ps.agentJustStarted = false;
          if (prevActivity !== "idle") {
            logger.debug(`[pollPane] pane=${pane.id} activity ${prevActivity} -> idle (grace elapsed)`);
          }
        }
      }

      if (fullCwd && fullCwd !== pane.lastFullCwd) {
        pane.lastFullCwd = fullCwd;
        // Project name only changes when the CWD changes
        if (pane === this.focusedPane) {
          try {
            const projectName = await invokeWithTimeout<string>(
              "get_project_info",
              { dir: fullCwd },
              timeout,
            );
            this.state.projectName = projectName || null;
          } catch (e) {
            logger.debug("Failed to get project info:", e);
          }
        }
      }

      // Fetch git status for every pane — each pane may be in a different
      // worktree / branch, so we track git state per-pane.
      if (fullCwd) {
        const prevBranch = ps.gitBranch;
        try {
          const gitStatus = await invokeWithTimeout<GitStatusInfo>(
            "get_git_status",
            { dir: fullCwd },
            timeout,
          );
          const branch = gitStatus.branch || null;
          ps.gitBranch = branch;
          ps.gitStatus = gitStatus;

          // Detect unexpected branch change in a shared directory — only warn
          // from the focused pane to avoid duplicate toasts when multiple panes
          // in the same directory all detect the change simultaneously.
          if (
            prevBranch &&
            branch &&
            prevBranch !== branch &&
            !pane.worktreePath &&
            pane === this.focusedPane
          ) {
            const siblingsAffected = this.panes.filter(
              (p) => p !== pane && !p.worktreePath && p.lastFullCwd === fullCwd,
            );
            if (siblingsAffected.length > 0) {
              showToast(
                `Branch changed to "${branch}" — ${siblingsAffected.length} other pane${siblingsAffected.length > 1 ? "s" : ""} in the same directory affected. Use Split to Branch (⌘⇧\\) for isolation.`,
                "warn",
                6000,
              );
            }
          }
        } catch {
          // Fallback to simple branch detection for non-git dirs
          try {
            const gitBranch = await invokeWithTimeout<string>("get_git_branch", { dir: fullCwd }, timeout);
            ps.gitBranch = gitBranch || null;
            ps.gitStatus = null;
          } catch (e) {
            logger.debug("Failed to get git branch:", e);
          }
        }
        // Update the per-pane branch badge overlay
        pane.updateBranchBadge();
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

  /** Check if a process has active child processes (async IPC to Rust).
   *  Returns false on error to avoid blocking state transitions. */
  private async checkActiveChildren(pid: number): Promise<boolean> {
    try {
      return await invokeWithTimeout<boolean>(
        "has_active_children",
        { pid },
        this.config.advanced.ipcTimeoutMs,
      );
    } catch {
      return false;
    }
  }

  /** Compute an adaptive idle timeout based on the pane's observed output cadence. */
  private getAdaptiveTimeout(pane: Pane): number {
    return computeAdaptiveTimeout(pane.outputGaps, {
      minMs: Tab.MIN_AGENT_IDLE_MS,
      maxMs: Tab.MAX_AGENT_IDLE_MS,
      defaultMs: Tab.DEFAULT_AGENT_IDLE_MS,
    });
  }

  /** Check whether the terminal buffer shows working patterns. */
  private scanBufferForWorkingPatterns(pane: Pane): boolean {
    return hasWorkingPatterns(pane.getLastLines(8));
  }

  /** Derive tab-level state from all pane states */
  private deriveTabState() {
    const fps = this.focusedPane.state;

    // Tab folder = focused pane's (follows the user)
    this.state.folderName = fps.folderName;
    this.state.processName = fps.processName;
    this.state.isIdle = fps.isIdle;

    // Tab activity and details come from the focused pane — the user's
    // current context. Errors and waiting states from other panes are
    // surfaced only if the focused pane is idle, so important signals
    // aren't hidden but the tab reflects what the user is looking at.
    this.state.activity = fps.activity;
    this.state.agentName = fps.agentName;
    this.state.agentStartedAt = fps.agentStartedAt;
    this.state.serverPort = fps.serverPort;
    this.state.lastError = fps.lastError;
    this.state.lastAction = fps.lastAction;
    this.state.waitingType = fps.waitingType;
    this.state.actionCount = fps.actionCount;

    // If the focused pane is idle, surface important states from other panes
    if (fps.activity === "idle" || fps.activity === "completed") {
      for (const pane of this.panes) {
        if (pane === this.focusedPane) continue;
        const ps = pane.state;
        if (ps.activity === "error" || ps.activity === "agent-waiting") {
          this.state.activity = ps.activity;
          if (ps.agentName) this.state.agentName = ps.agentName;
          if (ps.lastError) this.state.lastError = ps.lastError;
          if (ps.waitingType) this.state.waitingType = ps.waitingType;
          break;
        }
      }
    }

    // Derive git state from focused pane (backward compat — tab.state.gitBranch
    // still works for sidebar, workspace panel, jump-to-branch, etc.)
    this.state.gitBranch = fps.gitBranch;
    this.state.gitStatus = fps.gitStatus;

    logger.debug(
      `[deriveTabState] tab=${this.id} activity=${this.state.activity} agent=${this.state.agentName} folder=${this.state.folderName}`,
    );
  }

  toggleSearch() {
    this.focusedPane.toggleSearch();
  }

  writeToPty(data: string) {
    this.focusedPane.writeToPty(data);
  }

  /** Write directly to the focused pane's terminal display (not the PTY). */
  writeToTerminal(data: string) {
    this.focusedPane.writeToDisplay(data);
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

    // Preserve worktree metadata from the old pane
    const oldWorktreePath = pane.worktreePath;
    const oldRepoRoot = pane.repoRoot;

    // Create replacement pane in the same CWD
    const newPane = this.createPane(cwd);
    newPane.worktreePath = oldWorktreePath;
    newPane.repoRoot = oldRepoRoot;

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
    this.updateFocusedClass(newPane);
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
    this.transitioning = true;
    this.state.needsAttention = false;
    this.state.notification = null;

    // If we're showing a tab that was in "completed" state while backgrounded,
    // start the fade timer now.
    if (this.state.activity === "completed") {
      setTimeout(() => {
        if (this.state.activity === "completed") {
          this.state.activity = "idle";
          this.state.actionCount = 0;
          this.updateTitle();
        }
      }, this.config.advanced.completedFadeMs);
    }
    this.element.classList.add("active");

    // --- 5-frame show() pipeline with scroll lock (#184) ---
    //
    // The scroll lock (acquired in hide()) spans the entire pipeline.
    // While locked: onScroll is suppressed, fitCore() uses the locked
    // position, and flushWrites() corrects scroll after each write.
    // The lock is released in Frame 3, which is the ONLY point where
    // the authoritative scroll restoration happens.
    //
    // Frame 0: CSS visible, restore DOM scrollTop
    // Frame 1: forceFit (uses locked position), WebGL activation
    // Frame 2: flush queued writes (scroll lock corrects _sync() corruption)
    // Frame 3: unlockScroll (single authoritative scroll restoration)
    // Frame 4: focus terminal

    // Track the rAF chain so hide() can cancel if user switches away quickly.
    this.showRafId = requestAnimationFrame(() => {
      // Frame 1: Restore DOM scrollTop, fit, WebGL, repaint
      for (const pane of this.panes) pane.restoreScrollPosition();
      for (const pane of this.panes) pane.forceFit();
      for (const pane of this.panes) pane.activateWebGL(true);
      this.refreshAllPanes();

      this.showRafId = requestAnimationFrame(() => {
        // Frame 2: Flush queued writes — scroll lock corrects any _sync()
        // corruption after each write, so scroll position stays stable.
        for (const pane of this.panes) pane.setVisible(true);

        this.showRafId = requestAnimationFrame(() => {
          // Frame 3: Unlock scroll — the single authoritative restoration.
          // All destabilizing operations (fit, write, WebGL) are complete.
          for (const pane of this.panes) pane.unlockScroll();
          this.transitioning = false;

          this.showRafId = requestAnimationFrame(() => {
            // Frame 4: Focus terminal
            this.showRafId = null;
            if (this.isVisible) this.focusedPane.focus();
          });
        });
      });
    });
  }

  hide() {
    this.isVisible = false;
    // Lock scroll position BEFORE any hiding operations — this captures
    // the authoritative viewportY while the terminal is still in a stable
    // state.  The lock persists until show() completes all destabilizing
    // operations (fit, write, WebGL), then unlockScroll() performs the
    // single authoritative restoration. (#184)
    for (const pane of this.panes) pane.lockScroll();
    // Save DOM scrollTop before hiding — defense-in-depth alongside
    // visibility:hidden which preserves scrollTop at the CSS level (#177).
    for (const pane of this.panes) pane.saveScrollPosition();
    this.element.classList.remove("active");
    // Cancel any pending show() rAF to prevent stale focus stealing
    if (this.showRafId !== null) {
      cancelAnimationFrame(this.showRafId);
      this.showRafId = null;
    }
    // Mark panes hidden so writes are queued without rAF flushing —
    // this dramatically reduces CPU for background tabs under heavy load (#170).
    for (const pane of this.panes) pane.setVisible(false);
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

  /** Force a full refresh of all pane viewports — used to recover from
   *  silent renderer failures (e.g. WebGL context loss that didn't fire
   *  the onContextLoss event, or canvas blanking in Tauri's WebView). */
  refreshAllPanes() {
    for (const pane of this.panes) {
      pane.terminal.refresh(0, pane.terminal.rows - 1);
    }
  }

  /** Serialize the split tree for session persistence. */
  serializeSplits(): SessionSplitNode | undefined {
    if (this.panes.length <= 1) return undefined;
    return this.serializeNode(this.root);
  }

  private serializeNode(node: SplitNode): SessionSplitNode {
    if (node.type === "leaf") {
      const leaf: SessionSplitLeaf = { type: "leaf", cwd: node.pane.lastFullCwd ?? "" };
      if (node.pane.worktreePath) leaf.worktreePath = node.pane.worktreePath;
      if (node.pane.repoRoot) leaf.repoRoot = node.pane.repoRoot;
      return leaf;
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

    // Apply per-pane worktree metadata from session leaves
    if (node.children[0].type === "leaf") {
      if (node.children[0].worktreePath) originalPane.worktreePath = node.children[0].worktreePath;
      if (node.children[0].repoRoot) originalPane.repoRoot = node.children[0].repoRoot;
    }
    if (node.children[1].type === "leaf") {
      if (node.children[1].worktreePath) newPane.worktreePath = node.children[1].worktreePath;
      if (node.children[1].repoRoot) newPane.repoRoot = node.children[1].repoRoot;
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
