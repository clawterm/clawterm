export type TabActivity = "idle" | "running" | "agent-waiting" | "server-running" | "foreground-busy" | "error" | "completed";

/** Structured git status from the Rust backend */
export interface GitStatusInfo {
  branch: string;
  modified: number;
  staged: number;
  untracked: number;
  ahead: number;
  behind: number;
  is_worktree: boolean;
}

/** Why the agent is waiting */
export type WaitingType = "user" | "api" | "unknown";

/** Claude Code statusLine protocol data — piped via OSC or sideband (#348) */
export interface StatusLineData {
  contextUsedPercent: number;
  costUsd: number;
  modelName: string;
}

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
  /** True when OSC 9;4 progress bar is active — reliable working indicator.
   *  When set, the heuristic idle detection (adaptive timeout + buffer scan)
   *  is skipped in favor of the ground-truth OSC signal. */
  oscProgressActive: boolean;
  /** Git branch this pane is on (per-pane tracking for worktree isolation) */
  gitBranch: string | null;
  /** Structured git status for this pane's CWD */
  gitStatus: GitStatusInfo | null;
  /** Claude Code statusLine data — context usage, cost, model (#348) */
  statusLine: StatusLineData | null;
  /** Rolling history of recent agent actions for focus mode (#342) */
  recentActions: string[];
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
    oscProgressActive: false,
    gitBranch: null,
    gitStatus: null,
    statusLine: null,
    recentActions: [],
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
  /** Structured git status (modified/staged/ahead/behind counts) */
  gitStatus: GitStatusInfo | null;
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
    gitStatus: null,
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

/** Format elapsed time as compact M:SS or H:MM:SS (#335) */
export function formatElapsed(startMs: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  const s = secs % 60;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}:${s.toString().padStart(2, "0")}`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}:${(mins % 60).toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
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
 *  Always returns a string — every pane gets a line in the sidebar.
 *  When showBranch is true, prepends the branch name (used when panes are on different branches). */
export function computePaneStatusLine(state: PaneState, showBranch = false): string {
  const prefix = showBranch && state.gitBranch ? `[${state.gitBranch}] ` : "";
  if (state.agentJustStarted && state.agentName) {
    return `${prefix}starting ${state.agentName}...`;
  }
  if (state.activity === "agent-waiting") {
    const name = state.agentName ?? "agent";
    const elapsed = state.agentStartedAt ? ` (${formatElapsed(state.agentStartedAt)})` : "";
    const reason = state.waitingType === "user" ? "waiting for input" : "waiting";
    return `${prefix}${name} ${reason}${elapsed}`;
  }
  if (state.activity === "running" && state.agentName) {
    const elapsed = state.agentStartedAt ? ` (${formatElapsed(state.agentStartedAt)})` : "";
    if (state.lastAction) {
      return `${prefix}${state.agentName}: ${state.lastAction}${elapsed}`;
    }
    return `${prefix}${state.agentName} working...${elapsed}`;
  }
  if (state.activity === "server-running" && state.serverPort) {
    return `${prefix}localhost:${state.serverPort}`;
  }
  if (state.activity === "error" && state.lastError) {
    return `${prefix}${state.lastError}`;
  }
  if (state.activity === "running" && state.processName) {
    return `${prefix}${state.processName}`;
  }
  return `${prefix}idle`;
}

/** Structured pane status — individual fields for independent styling (#350) */
export interface PaneStatusParts {
  prefix: string | null; // branch prefix like "[main]"
  agent: string | null; // agent name like "claude"
  action: string | null; // action text like "Reading src/auth.ts"
  elapsed: string | null; // formatted elapsed time like "3:42"
  actionCount: number; // completed actions count (#335)
  fallback: string | null; // non-agent status like "idle", "localhost:3000"
  activity: TabActivity;
}

/** Compute structured status parts for a pane (for structured DOM rendering).
 *  Replaces the flat computePaneStatusLine for cases where independent styling
 *  of agent name, action, and elapsed time is needed (#350). */
export function computePaneStatusParts(state: PaneState, showBranch = false): PaneStatusParts {
  const prefix = showBranch && state.gitBranch ? `[${state.gitBranch}]` : null;
  const elapsed = state.agentStartedAt ? formatElapsed(state.agentStartedAt) : null;
  const count = state.actionCount;

  if (state.agentJustStarted && state.agentName) {
    return {
      prefix,
      agent: state.agentName,
      action: "starting...",
      elapsed: null,
      actionCount: 0,
      fallback: null,
      activity: state.activity,
    };
  }
  if (state.activity === "agent-waiting") {
    const name = state.agentName ?? "agent";
    const reason = state.waitingType === "user" ? "waiting for input" : "waiting";
    return {
      prefix,
      agent: name,
      action: reason,
      elapsed,
      actionCount: count,
      fallback: null,
      activity: state.activity,
    };
  }
  if (state.activity === "running" && state.agentName) {
    return {
      prefix,
      agent: state.agentName,
      action: state.lastAction ?? "working...",
      elapsed,
      actionCount: count,
      fallback: null,
      activity: state.activity,
    };
  }
  if (state.activity === "server-running" && state.serverPort) {
    return {
      prefix,
      agent: null,
      action: null,
      elapsed: null,
      actionCount: 0,
      fallback: `localhost:${state.serverPort}`,
      activity: state.activity,
    };
  }
  if (state.activity === "error" && state.lastError) {
    return {
      prefix,
      agent: null,
      action: null,
      elapsed: null,
      actionCount: 0,
      fallback: state.lastError,
      activity: state.activity,
    };
  }
  if (state.activity === "running" && state.processName) {
    return {
      prefix,
      agent: null,
      action: null,
      elapsed: null,
      actionCount: 0,
      fallback: state.processName,
      activity: state.activity,
    };
  }
  return {
    prefix,
    agent: null,
    action: null,
    elapsed: null,
    actionCount: 0,
    fallback: "idle",
    activity: state.activity,
  };
}

/** Deterministic branch color from a fixed warm palette */
const BRANCH_COLORS = [
  "#ff6b6b",
  "#30d158",
  "#ff9f0a",
  "#ff453a",
  "#bf5af2",
  "#e0a4ff",
  "#ff375f",
  "#ffd60a",
];
const branchColorCache = new Map<string, string>();
export function branchColor(branch: string): string {
  const cached = branchColorCache.get(branch);
  if (cached) return cached;
  let hash = 0;
  for (let i = 0; i < branch.length; i++) {
    hash = ((hash << 5) - hash + branch.charCodeAt(i)) | 0;
  }
  const color = BRANCH_COLORS[Math.abs(hash) % BRANCH_COLORS.length];
  branchColorCache.set(branch, color);
  return color;
}

// State-specific icons — shape + animation + color for triple-channel scanning (#347).
// 10px viewBox for clarity at sidebar sizes.
const ICON_SIZE = 10;
const svg = (inner: string) =>
  `<svg width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}" fill="none" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

export const ACTIVITY_ICONS: Record<TabActivity, { svg: string; cssClass: string; label: string }> = {
  idle: {
    // Small filled dot — neutral, at rest
    svg: svg(`<circle cx="5" cy="5" r="2.5" fill="currentColor"/>`),
    cssClass: "activity-idle",
    label: "Idle",
  },
  running: {
    // Linear-inspired spinner — faint track + orbiting dot
    svg: svg(
      `<circle cx="5" cy="5" r="3.5" stroke="currentColor" stroke-width="1" opacity="0.15" fill="none"/>` +
        `<circle r="1" fill="currentColor"><animateMotion dur="1.2s" repeatCount="indefinite" path="M5,1.5 A3.5,3.5 0 1,1 4.99,1.5" rotate="auto"/></circle>`,
    ),
    cssClass: "activity-running",
    label: "Running",
  },
  "agent-waiting": {
    // Exclamation mark — universal "needs attention" symbol
    svg: svg(
      `<rect x="4" y="1.5" width="2" height="4.5" rx="1" fill="currentColor"/>` +
        `<circle cx="5" cy="8" r="1.2" fill="currentColor"/>`,
    ),
    cssClass: "activity-agent-waiting",
    label: "Agent waiting",
  },
  "server-running": {
    // Globe — circle with meridian + equator, standard web/server symbol
    svg: svg(
      `<circle cx="5" cy="5" r="4" stroke="currentColor" stroke-width="1.2" fill="none"/>` +
        `<ellipse cx="5" cy="5" rx="2" ry="4" stroke="currentColor" stroke-width="1" fill="none"/>` +
        `<line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" stroke-width="1"/>`,
    ),
    cssClass: "activity-server",
    label: "Server running",
  },
  error: {
    // X mark — two crossed lines
    svg: svg(
      `<path d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
    ),
    cssClass: "activity-error",
    label: "Error",
  },
  "foreground-busy": {
    // Filled dot — same as idle but signals a non-agent process is running
    svg: svg(`<circle cx="5" cy="5" r="2.5" fill="currentColor"/>`),
    cssClass: "activity-foreground-busy",
    label: "Process running",
  },
  completed: {
    // Checkmark — simple check
    svg: svg(
      `<path d="M2.5 5.5L4.5 7.5L7.5 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
    ),
    cssClass: "activity-completed",
    label: "Completed",
  },
};
