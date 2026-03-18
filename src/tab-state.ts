export type TabActivity =
  | "idle"
  | "running"
  | "agent-waiting"
  | "agent-maybe-idle"
  | "server-running"
  | "error"
  | "completed";

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
  };
}

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
    const suffix =
      state.activity === "agent-waiting"
        ? " [waiting]"
        : state.activity === "agent-maybe-idle"
          ? " [idle?]"
          : "";
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
    return `waiting for input${elapsed}`;
  }
  if (state.activity === "agent-maybe-idle") {
    const elapsed = state.agentStartedAt ? ` (${formatElapsed(state.agentStartedAt)})` : "";
    return `possibly idle${elapsed}`;
  }
  if (state.serverPort) return `localhost:${state.serverPort}`;
  if (state.lastError) return state.lastError;
  if (state.agentName && state.activity === "running") {
    const elapsed = state.agentStartedAt ? ` ${formatElapsed(state.agentStartedAt)}` : "";
    if (state.lastAction) {
      return `${state.lastAction}${elapsed}`;
    }
    return `${state.agentName}${elapsed}`;
  }
  if (!state.isIdle && state.processName && state.activity === "running") return state.processName;
  return null;
}

/** Compute a single status line for a pane (shown in sidebar under tab title).
 *  Always returns a string — every pane gets a line in the sidebar. */
export function computePaneStatusLine(state: PaneState): string {
  if (state.activity === "agent-waiting") {
    const name = state.agentName ?? "agent";
    const elapsed = state.agentStartedAt ? ` (${formatElapsed(state.agentStartedAt)})` : "";
    return `${name} waiting for input${elapsed}`;
  }
  if (state.activity === "agent-maybe-idle") {
    const name = state.agentName ?? "agent";
    const elapsed = state.agentStartedAt ? ` (${formatElapsed(state.agentStartedAt)})` : "";
    return `${name} possibly idle${elapsed}`;
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

// Minimal 12x12 SVG icons (Linear/Vercel style)
const svg = (inner: string) =>
  `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

export const ACTIVITY_ICONS: Record<TabActivity, { svg: string; cssClass: string; label: string }> = {
  idle: {
    // Terminal prompt: >_
    svg: svg(
      `<path d="M2.5 3.5L5 6L2.5 8.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><line x1="6.5" y1="9" x2="9.5" y2="9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`,
    ),
    cssClass: "activity-idle",
    label: "Idle",
  },
  running: {
    // Spinning/active dot with ring
    svg: svg(
      `<circle cx="6" cy="6" r="2" fill="currentColor"/><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1" opacity="0.4"/>`,
    ),
    cssClass: "activity-running",
    label: "Running",
  },
  "agent-waiting": {
    // Pause icon (two bars)
    svg: svg(
      `<rect x="3" y="2.5" width="2" height="7" rx="0.5" fill="currentColor"/><rect x="7" y="2.5" width="2" height="7" rx="0.5" fill="currentColor"/>`,
    ),
    cssClass: "activity-agent-waiting",
    label: "Agent waiting",
  },
  "agent-maybe-idle": {
    // Dimmed/uncertain variant — same dot+ring as running but with lower opacity
    svg: svg(
      `<circle cx="6" cy="6" r="2" fill="currentColor" opacity="0.5"/><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1" opacity="0.25"/>`,
    ),
    cssClass: "activity-agent-maybe-idle",
    label: "Agent may be idle",
  },
  "server-running": {
    // Signal/broadcast icon
    svg: svg(
      `<circle cx="6" cy="6" r="2" fill="currentColor"/><path d="M3 3a4.24 4.24 0 0 0 0 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M9 3a4.24 4.24 0 0 1 0 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`,
    ),
    cssClass: "activity-server",
    label: "Server running",
  },
  error: {
    // Warning triangle
    svg: svg(
      `<path d="M6 2L11 10H1L6 2Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><line x1="6" y1="5.5" x2="6" y2="7.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="6" cy="9" r="0.5" fill="currentColor"/>`,
    ),
    cssClass: "activity-error",
    label: "Error",
  },
  completed: {
    // Checkmark
    svg: svg(
      `<path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`,
    ),
    cssClass: "activity-completed",
    label: "Completed",
  },
};
