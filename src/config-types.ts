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
  overlayBackdrop: string;
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
  /** Opacity scale — controls dimming/emphasis across the UI. */
  opacityDim: number;
  opacityMuted: number;
  opacitySubtle: number;
  opacitySoft: number;
  opacityMedium: number;
  opacityStrong: number;
  /** Spacing scale — consistent padding/margin/gap system (in px). */
  space1: number;
  space2: number;
  space3: number;
  space4: number;
  space5: number;
  space6: number;
  space7: number;
  space8: number;
  space9: number;
  space10: number;
  /** Hover background intensity. */
  hoverSubtle: string;
  hoverDefault: string;
  hoverStrong: string;
  /** Scrollbar thumb colors. */
  scrollbarThumb: string;
  scrollbarThumbHover: string;
  /** Disabled state opacity. */
  disabledOpacity: string;
  /** Animation durations. */
  animFast: string;
  animNormal: string;
  /** Easing function. */
  animEase: string;
  /** Font weight scale. */
  fontWeightMedium: number;
  fontWeightSemibold: number;
  /** Letter spacing scale. */
  letterSpacingNormal: string;
  letterSpacingWide: string;
  /** Icon sizes. */
  iconSm: number;
  iconMd: number;
  iconLg: number;
  /** Scrollbar width. */
  scrollbarWidth: number;
  /** Platform window control colors. */
  trafficClose: string;
  trafficMinimize: string;
  trafficMaximize: string;
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
    /** Group tabs by state: agents, servers, shells (#334). Default: true */
    groupByState: boolean;
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
    /** Show event markers in the scrollbar gutter. Default: false (#349) */
    showEventGutter: boolean;
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
