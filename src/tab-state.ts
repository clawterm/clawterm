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

/** Claude Code statusLine protocol data — piped via OSC or sideband (#348) */
export interface StatusLineData {
  contextUsedPercent: number;
  costUsd: number;
  modelName: string;
}

/** Per-pane state — tracks each pane independently */
export interface PaneState {
  folderName: string;
  processName: string;
  isIdle: boolean;
  serverPort: number | null;
  lastError: string | null;
  /** Git branch this pane is on (per-pane tracking for worktree isolation) */
  gitBranch: string | null;
  /** Structured git status for this pane's CWD */
  gitStatus: GitStatusInfo | null;
  /** Claude Code statusLine data — context usage, cost, model (#348) */
  statusLine: StatusLineData | null;
}

export function createDefaultPaneState(): PaneState {
  return {
    folderName: "~",
    processName: "",
    isIdle: true,
    serverPort: null,
    lastError: null,
    gitBranch: null,
    gitStatus: null,
    statusLine: null,
  };
}

/** Notification type for background tab badges */
export type NotificationType =
  | "error"
  | "server-started"
  | "server-crashed"
  | null;

export interface TabState {
  folderName: string;
  processName: string;
  isIdle: boolean;
  needsAttention: boolean;
  serverPort: number | null;
  projectName: string | null;
  lastError: string | null;
  gitBranch: string | null;
  /** Structured git status (modified/staged/ahead/behind counts) */
  gitStatus: GitStatusInfo | null;
  /** Notification type for background badges — persists until tab is focused */
  notification: NotificationType;
}

export function createDefaultTabState(): TabState {
  return {
    folderName: "~",
    processName: "",
    isIdle: true,
    needsAttention: false,
    serverPort: null,
    projectName: null,
    lastError: null,
    gitBranch: null,
    gitStatus: null,
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
