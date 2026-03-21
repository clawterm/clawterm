export type TabActivity = "idle" | "running" | "agent-waiting" | "server-running" | "error" | "completed";

/** Why the agent is waiting */
export type WaitingType = "user" | "api" | "unknown";

/** Per-pane state — tracks each pane's activity independently */
export interface PaneState {
  folderName: string;
  processName: string;
  isIdle: boolean;
  activity: TabActivity;
  agentName: string | null;
  serverPort: number | null;
  lastError: string | null;
  agentStartedAt: number | null;
  /** Last known agent action (e.g., "Reading src/auth.ts", "Running npm test") */
  lastAction: string | null;
  /** Why the agent is waiting — user prompt, API call, or unknown */
  waitingType: WaitingType;
  /** Count of distinct agent actions observed during this session */
  actionCount: number;
  /** Whether the agent was just detected (first poll cycle) */
  agentJustStarted: boolean;
}

export function createDefaultPaneState(): PaneState {
  return {
    folderName: "~",
    processName: "",
    isIdle: true,
    activity: "idle",
    agentName: null,
    serverPort: null,
    lastError: null,
    agentStartedAt: null,
    lastAction: null,
    waitingType: "unknown",
    actionCount: 0,
    agentJustStarted: false,
  };
}

/** Notification type for background tab badges */
export type NotificationType =
  | "completed"
  | "error"
  | "needs-input"
  | "server-started"
  | "server-crashed"
  | null;

export interface TabState {
  folderName: string;
  processName: string;
  isIdle: boolean;
  needsAttention: boolean;
  activity: TabActivity;
  agentName: string | null;
  serverPort: number | null;
  projectName: string | null;
  lastError: string | null;
  gitBranch: string | null;
  /** Timestamp when the current agent session started */
  agentStartedAt: number | null;
  /** Last known agent action (e.g., "Reading src/auth.ts") */
  lastAction: string | null;
  /** Why the agent is waiting */
  waitingType: WaitingType;
  /** Count of distinct agent actions in this session */
  actionCount: number;
  /** Notification type for background badges — persists until tab is focused */
  notification: NotificationType;
}

export function createDefaultTabState(): TabState {
  return {
    folderName: "~",
    processName: "",
    isIdle: true,
    needsAttention: false,
    activity: "idle",
    agentName: null,
    serverPort: null,
    projectName: null,
    lastError: null,
    gitBranch: null,
    agentStartedAt: null,
    lastAction: null,
    waitingType: "unknown",
    actionCount: 0,
    notification: null,
  };
}

/** Tab title shown in sidebar — project or folder name with a leading slash */
export function computeFolderTitle(state: TabState): string {
  const folder = state.projectName || state.folderName || "~";
  if (folder === "~" || folder === "/") return folder;
  return `/${folder}`;
}

export function computeDisplayTitle(state: TabState): string {
  const project = state.projectName || state.folderName || "~";

  if (state.serverPort) return `${project} :${state.serverPort}`;
  if (state.agentName) {
    const suffix = state.activity === "agent-waiting" ? " [waiting]" : "";
    return `${project} — ${state.agentName}${suffix}`;
  }
  if (state.isIdle) return project;
  return `${project} — ${state.processName}`;
}

function formatElapsed(startMs: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export function computeSubtitle(state: TabState): string | null {
  if (state.activity === "agent-waiting") {
    const elapsed = state.agentStartedAt ? ` (${formatElapsed(state.agentStartedAt)})` : "";
    const reason = state.waitingType === "user" ? "waiting for input" : "waiting";
    return `${reason}${elapsed}`;
  }
  if (state.serverPort) return `localhost:${state.serverPort}`;
  if (state.lastError) return state.lastError;
  if (state.agentName && state.activity === "running") {
    const elapsed = state.agentStartedAt ? ` ${formatElapsed(state.agentStartedAt)}` : "";
    const actions = state.actionCount > 0 ? ` \u00b7 ${state.actionCount} actions` : "";
    if (state.lastAction) {
      return `${state.lastAction}${elapsed}${actions}`;
    }
    return `${state.agentName}${elapsed}${actions}`;
  }
  if (!state.isIdle && state.processName && state.activity === "running") return state.processName;
  return null;
}

/** Compute a single status line for a pane (shown in sidebar under tab title).
 *  Always returns a string — every pane gets a line in the sidebar. */
export function computePaneStatusLine(state: PaneState): string {
  if (state.agentJustStarted && state.agentName) {
    return `starting ${state.agentName}...`;
  }
  if (state.activity === "agent-waiting") {
    const name = state.agentName ?? "agent";
    const elapsed = state.agentStartedAt ? ` (${formatElapsed(state.agentStartedAt)})` : "";
    const reason = state.waitingType === "user" ? "waiting for input" : "waiting";
    return `${name} ${reason}${elapsed}`;
  }
  if (state.activity === "running" && state.agentName) {
    const elapsed = state.agentStartedAt ? ` (${formatElapsed(state.agentStartedAt)})` : "";
    if (state.lastAction) {
      return `${state.agentName}: ${state.lastAction}${elapsed}`;
    }
    return `${state.agentName} working...${elapsed}`;
  }
  if (state.activity === "server-running" && state.serverPort) {
    return `localhost:${state.serverPort}`;
  }
  if (state.activity === "error" && state.lastError) {
    return state.lastError;
  }
  if (state.activity === "running" && state.processName) {
    return state.processName;
  }
  return "idle";
}

// Minimal 8x8 dot icons — state conveyed through color and CSS animation,
// not shape.  Keeps the sidebar clean and avoids visual noise.
const svg = (inner: string) =>
  `<svg width="8" height="8" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

export const ACTIVITY_ICONS: Record<TabActivity, { svg: string; cssClass: string; label: string }> = {
  idle: {
    svg: svg(`<circle cx="4" cy="4" r="3" fill="currentColor"/>`),
    cssClass: "activity-idle",
    label: "Idle",
  },
  running: {
    svg: svg(`<circle cx="4" cy="4" r="3" fill="currentColor"/>`),
    cssClass: "activity-running",
    label: "Running",
  },
  "agent-waiting": {
    svg: svg(`<circle cx="4" cy="4" r="3" fill="currentColor"/>`),
    cssClass: "activity-agent-waiting",
    label: "Agent waiting",
  },
  "server-running": {
    svg: svg(`<circle cx="4" cy="4" r="3" fill="currentColor"/>`),
    cssClass: "activity-server",
    label: "Server running",
  },
  error: {
    svg: svg(`<circle cx="4" cy="4" r="3" fill="currentColor"/>`),
    cssClass: "activity-error",
    label: "Error",
  },
  completed: {
    svg: svg(`<circle cx="4" cy="4" r="3" fill="currentColor"/>`),
    cssClass: "activity-completed",
    label: "Completed",
  },
};
