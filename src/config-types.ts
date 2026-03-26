import type { NotificationsConfig } from "./notifications";

export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface UserMatcher {
  id: string;
  pattern: string;
  type: "agent-waiting" | "agent-working" | "server-started" | "server-crashed" | "error" | "agent-completed";
  cooldownMs?: number;
}

export interface UITheme {
  /** Base font size for the UI chrome (not the terminal). The type scale derives from this. */
  fontSize: number;
  windowBorderRadius: string;
  windowBorderColor: string;
  titlebarHeight: number;
  statusBarHeight: number;
  panePadding: string;
  paneFocusOutline: string;
  paneUnfocusedOpacity: number;
  splitDividerWidth: number;
  colorOrange: string;
  colorRed: string;
  colorGreen: string;
  transitionSpeed: string;
  surfaceElevated: string;
  surfaceModal: string;
  surfacePanel: string;
  overlayBackdrop: string;
  surfaceBadge: string;
  shadowSm: string;
  shadowLg: string;
  accentSubtle: string;
  accentBorder: string;
  accentMuted: string;
  redMuted: string;
  orangeMuted: string;
  radiusSm: number;
  radiusMd: number;
  radiusLg: number;
  /** Base RGB for the text alpha scale (e.g. "255, 255, 255" for dark themes, "0, 0, 0" for light). */
  textColor: string;
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
  };
  theme: {
    /** Built-in theme preset name. User overrides below are merged on top. */
    preset?: string;
    sidebar: {
      background: string;
      border: string;
      tabActive: string;
      tabHover: string;
      tabText: string;
      tabTextActive: string;
      accentColor: string;
    };
    terminal: TerminalTheme;
    ui: UITheme;
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
  };
  notifications: NotificationsConfig;
  updates: {
    autoCheck: boolean;
    checkIntervalMs: number;
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
