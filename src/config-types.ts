import type { NotificationsConfig } from "./notifications";

export interface UserMatcher {
  id: string;
  pattern: string;
  type: "agent-waiting" | "agent-working" | "server-started" | "server-crashed" | "error" | "agent-completed";
  cooldownMs?: number;
}

export interface Config {
  configVersion: number;
  shell: string;
  shellArgs: string[];
  font: {
    family: string;
    size: number;
    lineHeight: number;
  };
  cursor: {
    style: "bar" | "block" | "underline";
    blink: boolean;
  };
  scrollback: number;
  copyOnSelect: boolean;
  sidebar: {
    width: number;
    position: "left" | "right";
    /** Group tabs by state: agents, servers, shells (#334). Default: true */
    groupByState: boolean;
    /** Expand active tab with rich agent details (#342). Default: false */
    expandActiveTab: boolean;
  };
  keybindings: {
    newTab: string;
    closeTab: string;
    nextTab: string;
    prevTab: string;
    reloadConfig: string;
    cycleAttention: string;
    search: string;
    quickSwitch: string;
    splitHorizontal: string;
    splitVertical: string;
    closePane: string;
    focusNextPane: string;
    focusPrevPane: string;
    commandPalette: string;
    zoomIn: string;
    zoomOut: string;
    zoomReset: string;
    restoreTab: string;
    nextProject: string;
    prevProject: string;
    newProject: string;
    [key: string]: string;
  };
  quickCommands: Record<string, string>;
  startupCommands: Record<string, string>;
  maxTabs: number;
  maxPanes: number;
  outputAnalysis: {
    enabled: boolean;
    bufferSize: number;
    customMatchers: UserMatcher[];
    /** Show event markers in the scrollbar gutter. Default: false (#349) */
    showEventGutter: boolean;
  };
  notifications: NotificationsConfig;
  updates: {
    autoCheck: boolean;
    checkIntervalMs: number;
    autoInstall: boolean;
  };
  worktree: {
    directory: string;
    postCreateHooks: string[];
    autoCleanup: boolean;
    defaultAgent: string;
  };
  advanced: {
    pollIntervalMs: number;
    backgroundPollIntervalMs: number;
    healthCheckIntervalMs: number;
    completedFadeMs: number;
    ipcTimeoutMs: number;
  };
}
