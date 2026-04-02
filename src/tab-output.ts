import type { OutputEvent } from "./matchers";
import type { TabState, PaneState } from "./tab-state";
import { logger } from "./logger";

/**
 * Context for output event handling — avoids coupling to the Tab class.
 */
export interface OutputEventContext {
  tabId: string;
  tabState: TabState;
  isVisible: boolean;
  muted: boolean;
  /** True when the tab was shown within the last ~2s — suppresses spurious notifications
   *  from events that fire during the show() rAF pipeline (#278) */
  recentlyShown: boolean;
  config: { completedFadeMs: number };
  deriveTabState(): void;
  updateTitle(): void;
  onNeedsAttention?(): void;
}

/**
 * Handle an output event from a pane's OutputAnalyzer.
 * Updates both pane-level and tab-level state, manages notifications
 * and completed-fade timers.
 *
 * Returns a fade timer (for "agent-completed" events) that the caller
 * must track and clear on subsequent events to prevent stacking.
 */
export function handleOutputEvent(
  event: OutputEvent,
  ctx: OutputEventContext,
  paneState: PaneState | undefined,
  existingFadeTimer: ReturnType<typeof setTimeout> | undefined,
): ReturnType<typeof setTimeout> | undefined {
  logger.debug(`[handleOutputEvent] tab=${ctx.tabId} type=${event.type} agent=${event.agentName ?? "none"}`);

  let fadeTimer = existingFadeTimer;

  // Update per-pane state
  if (paneState) {
    if (paneState.agentJustStarted) paneState.agentJustStarted = false;

    switch (event.type) {
      case "agent-waiting":
        paneState.activity = "agent-waiting";
        paneState.waitingType = event.detail.match(/\[Y\/n\]|Approve|Allow|Continue|proceed/i)
          ? "user"
          : "unknown";
        if (event.agentName) paneState.agentName = event.agentName;
        paneState.lastAction = null;
        break;
      case "agent-working":
        if (paneState.activity === "agent-waiting" || paneState.activity === "idle") {
          paneState.activity = "running";
        }
        paneState.waitingType = "unknown";
        if (event.agentName) paneState.agentName = event.agentName;
        if (event.detail) {
          const action = event.detail.slice(0, 60);
          if (action !== paneState.lastAction) {
            paneState.actionCount++;
            paneState.lastAction = action;
          }
        }
        break;
      case "server-started":
        paneState.activity = "server-running";
        if (event.port) paneState.serverPort = event.port;
        break;
      case "server-crashed":
        paneState.activity = "error";
        paneState.lastError = "Server crashed";
        break;
      case "error":
        paneState.activity = "error";
        paneState.lastError = event.detail.slice(0, 50);
        break;
      case "agent-completed": {
        paneState.activity = "completed";
        paneState.lastAction = null;
        if (fadeTimer) clearTimeout(fadeTimer);
        fadeTimer = setTimeout(() => {
          fadeTimer = undefined;
          if (paneState.activity === "completed") {
            paneState.activity = "idle";
            paneState.actionCount = 0;
            ctx.deriveTabState();
            ctx.updateTitle();
          }
        }, ctx.config.completedFadeMs);
        break;
      }
    }
  }

  // Update tab-level state
  const ts = ctx.tabState;
  // Notification guard: only set needsAttention/notification when the tab is
  // truly in the background. recentlyShown prevents spurious notifications
  // from events that fire during the show() rAF pipeline (#278).
  const canNotify = !ctx.isVisible && !ctx.muted && !ctx.recentlyShown;
  switch (event.type) {
    case "agent-waiting":
      ts.activity = "agent-waiting";
      ts.waitingType = paneState?.waitingType ?? "unknown";
      if (event.agentName) ts.agentName = event.agentName;
      if (canNotify) {
        ts.needsAttention = true;
        ts.notification = "needs-input";
      }
      break;
    case "agent-working":
      if (ts.activity === "agent-waiting") ts.activity = "running";
      ts.waitingType = "unknown";
      if (event.agentName) ts.agentName = event.agentName;
      if (event.detail) {
        const action = event.detail.slice(0, 60);
        if (action !== ts.lastAction) {
          ts.actionCount++;
          ts.lastAction = action;
        }
      }
      break;
    case "server-started":
      ts.activity = "server-running";
      if (event.port) ts.serverPort = event.port;
      if (canNotify) {
        ts.notification = "server-started";
        setTimeout(() => {
          if (ts.notification === "server-started") {
            ts.notification = null;
            ctx.updateTitle();
          }
        }, 5000);
      }
      break;
    case "server-crashed":
      ts.activity = "error";
      ts.lastError = "Server crashed";
      if (canNotify) {
        ts.needsAttention = true;
        ts.notification = "server-crashed";
      }
      break;
    case "error":
      ts.activity = "error";
      ts.lastError = event.detail.slice(0, 50);
      if (canNotify) {
        ts.needsAttention = true;
        ts.notification = "error";
      }
      break;
    case "agent-completed":
      ts.activity = "completed";
      ts.lastAction = null;
      if (canNotify) {
        ts.needsAttention = true;
        ts.notification = "completed";
      }
      if (ctx.isVisible) {
        setTimeout(() => {
          if (ts.activity === "completed") {
            ts.activity = "idle";
            ts.actionCount = 0;
            ctx.updateTitle();
          }
        }, ctx.config.completedFadeMs);
      }
      break;
  }

  ctx.updateTitle();
  return fadeTimer;
}

/**
 * Parse agent status from the terminal title string (OSC 0/2).
 * Claude Code sets titles like "Reading src/auth.ts".
 */
export function parseAgentTitle(
  title: string,
  paneState: PaneState,
  tabState: TabState,
  updateTitle: () => void,
): void {
  if (!title || !paneState.agentName) return;

  const toolMatch = title.match(/^(Reading|Writing|Editing|Creating|Searching|Running|Thinking)\b(.{0,60})/);
  if (toolMatch) {
    const action = toolMatch[0].trim();
    paneState.lastAction = action;
    tabState.lastAction = action;
    // Track recent actions for focus mode (#342) — keep last 5
    if (!paneState.recentActions.length || paneState.recentActions[0] !== action) {
      paneState.recentActions.unshift(action);
      if (paneState.recentActions.length > 5) paneState.recentActions.length = 5;
    }
    updateTitle();
  }
}
