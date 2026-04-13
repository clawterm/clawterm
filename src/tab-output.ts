import type { OutputEvent } from "./matchers";
import type { TabState } from "./tab-state";
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
  updateTitle(): void;
  onNeedsAttention?(): void;
}

/**
 * Handle an output event from a pane's OutputAnalyzer.
 * Updates tab-level state for server and error events.
 */
export function handleOutputEvent(
  event: OutputEvent,
  ctx: OutputEventContext,
): void {
  logger.debug(`[handleOutputEvent] tab=${ctx.tabId} type=${event.type}`);

  // Update tab-level state
  const ts = ctx.tabState;
  const canNotify = !ctx.isVisible && !ctx.muted && !ctx.recentlyShown;
  switch (event.type) {
    case "server-started":
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
      ts.lastError = "Server crashed";
      if (canNotify) {
        ts.needsAttention = true;
        ts.notification = "server-crashed";
      }
      break;
    case "error":
      ts.lastError = event.detail.slice(0, 50);
      if (canNotify) {
        ts.needsAttention = true;
        ts.notification = "error";
      }
      break;
  }

  ctx.updateTitle();
}
