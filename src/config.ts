import { invoke } from "@tauri-apps/api/core";
import { logger } from "./logger";
import { modKey, isWindows } from "./utils";
import { showToast } from "./toast";
import { resolveTheme, PRESET_NAMES, getAllThemeNames, loadCustomThemes } from "./themes/resolve";

// Re-export types so existing `import type { Config } from "./config"` still works
export type { Config, TerminalTheme, UITheme, UserMatcher } from "./config-types";
export { PRESET_NAMES, getAllThemeNames, loadCustomThemes };
import type { Config } from "./config-types";

/** Current config schema version. Bump when adding/changing config fields. */
const CONFIG_VERSION = 1;

/** Return the default shell for the current platform. */
function defaultShell(): string {
  if (isWindows) {
    // Prefer PowerShell 7 (pwsh) if available, else Windows PowerShell
    return "powershell.exe";
  }
  return "/bin/zsh";
}

/** Return appropriate default shell args based on shell name. */
function defaultShellArgs(shell: string): string[] {
  const basename = shell.split(/[/\\]/).pop()?.toLowerCase() ?? "";
  // PowerShell: suppress startup banner
  if (basename === "pwsh.exe" || basename === "powershell.exe" || basename === "pwsh") return ["-NoLogo"];
  // cmd.exe: no args needed
  if (basename === "cmd.exe") return [];
  // Most POSIX shells support --login for sourcing profile files.
  // Nushell uses -l, fish supports --login.
  if (basename === "nu" || basename === "nushell") return ["-l"];
  return ["--login"];
}

/** Default font family — JetBrains Mono everywhere, system monospace as fallback. */
const defaultFontFamily = '"JetBrains Mono Variable", "JetBrains Mono", monospace';

const _defaultShell = defaultShell();

const DEFAULT_CONFIG: Config = {
  configVersion: CONFIG_VERSION,
  shell: _defaultShell,
  shellArgs: defaultShellArgs(_defaultShell),
  font: {
    family: defaultFontFamily,
    size: 14,
    lineHeight: 1.3,
  },
  cursor: {
    style: "bar",
    blink: false,
  },
  scrollback: 5000,
  copyOnSelect: false,
  sidebar: {
    width: 200,
    position: "left",
  },
  theme: {
    sidebar: {
      background: "#000000",
      border: "rgba(255, 255, 255, 0.08)",
      tabActive: "rgba(255, 255, 255, 0.1)",
      tabHover: "rgba(255, 255, 255, 0.06)",
      tabText: "rgba(255, 255, 255, 0.45)",
      tabTextActive: "rgba(255, 255, 255, 0.9)",
      accentColor: "#0a84ff",
    },
    terminal: {
      background: "#000000",
      foreground: "#f8f8f2",
      cursor: "#f8f8f2",
      cursorAccent: "#000000",
      selectionBackground: "#44475a",
      selectionForeground: "#ffffff",
      black: "#000000",
      red: "#ff5555",
      green: "#00ff87",
      yellow: "#ffff00",
      blue: "#5f87ff",
      magenta: "#ff00ff",
      cyan: "#00ffff",
      white: "#f8f8f2",
      brightBlack: "#545454",
      brightRed: "#ff4444",
      brightGreen: "#00ff00",
      brightYellow: "#ffff55",
      brightBlue: "#87afff",
      brightMagenta: "#ff87ff",
      brightCyan: "#55ffff",
      brightWhite: "#ffffff",
    },
    ui: {
      fontSize: 12,
      windowBorderRadius: "10px",
      windowBorderColor: "rgba(255, 255, 255, 0.12)",
      titlebarHeight: 38,
      statusBarHeight: 24,
      panePadding: "4px 2px 2px 6px",
      paneFocusOutline: "rgba(10, 132, 255, 0.6)",
      paneUnfocusedOpacity: 0.7,
      splitDividerWidth: 9,
      colorOrange: "#ff9f0a",
      colorRed: "#ff453a",
      colorGreen: "#30d158",
      transitionSpeed: "0.12s",
      surfaceElevated: "rgb(30, 30, 30)",
      surfaceModal: "rgba(25, 25, 25, 0.97)",
      surfacePanel: "rgba(15, 15, 15, 0.95)",
      overlayBackdrop: "rgba(0, 0, 0, 0.4)",
      surfaceBadge: "rgba(0, 0, 0, 0.6)",
      shadowSm: "0 2px 8px rgba(0, 0, 0, 0.3)",
      shadowLg: "0 4px 16px rgba(0, 0, 0, 0.4)",
      accentSubtle: "rgba(10, 132, 255, 0.08)",
      accentBorder: "rgba(10, 132, 255, 0.2)",
      accentMuted: "rgba(10, 132, 255, 0.4)",
      redMuted: "rgba(255, 69, 58, 0.4)",
      orangeMuted: "rgba(255, 159, 10, 0.4)",
      radiusSm: 4,
      radiusMd: 6,
      radiusLg: 10,
      opacityDim: 0.4,
      opacityMuted: 0.5,
      opacitySubtle: 0.6,
      opacitySoft: 0.7,
      opacityMedium: 0.8,
      opacityStrong: 0.9,
      space1: 2,
      space2: 4,
      space3: 6,
      space4: 8,
      space5: 10,
      space6: 12,
      space7: 16,
      space8: 20,
      space9: 24,
      space10: 32,
      animFast: "0.15s",
      animNormal: "0.3s",
      animPulse: "1.5s",
      animBreathe: "3s",
      fontWeightRegular: 400,
      fontWeightMedium: 500,
      fontWeightSemibold: 600,
      letterSpacingNormal: "0.05em",
      letterSpacingWide: "0.06em",
      iconSm: 12,
      iconMd: 14,
      iconLg: 20,
      scrollbarWidth: 4,
      trafficClose: "#ff5f57",
      trafficMinimize: "#febc2e",
      trafficMaximize: "#28c840",
      textColor: "255, 255, 255",
    },
  },
  keybindings: {
    newTab: `${modKey}+t`,
    closeTab: `${modKey}+w`,
    nextTab: `${modKey}+shift+]`,
    prevTab: `${modKey}+shift+[`,
    reloadConfig: `${modKey}+shift+r`,
    cycleAttention: `${modKey}+shift+a`,
    search: `${modKey}+f`,
    quickSwitch: `${modKey}+p`,
    splitHorizontal: `${modKey}+d`,
    splitVertical: `${modKey}+shift+d`,
    closePane: `${modKey}+shift+w`,
    focusNextPane: `${modKey}+]`,
    focusPrevPane: `${modKey}+[`,
    commandPalette: `${modKey}+shift+p`,
    zoomIn: `${modKey}+=`,
    zoomOut: `${modKey}+-`,
    zoomReset: `${modKey}+0`,
    restoreTab: `${modKey}+shift+t`,
    newWorktreeTab: `${modKey}+shift+n`,
    toggleWorkspacePanel: `${modKey}+shift+b`,
    jumpToBranch: `${modKey}+shift+g`,
  },
  quickCommands: {
    [`${modKey}+shift+c`]: "claude --dangerously-skip-permissions\n",
  },
  startupCommands: {},
  maxTabs: 20,
  maxPanes: 8,
  worktree: {
    directory: ".clawterm-worktrees",
    postCreateHooks: [],
    autoCleanup: false,
    defaultAgent: "",
  },
  outputAnalysis: {
    enabled: true,
    bufferSize: 4096,
    customMatchers: [],
  },
  notifications: {
    enabled: true,
    sound: true,
    types: {
      completion: { enabled: true, sound: false },
      agentWaiting: { enabled: true, sound: true },
      serverStarted: { enabled: true, sound: false },
      serverCrashed: { enabled: true, sound: true },
      error: { enabled: true, sound: false },
    },
  },
  updates: {
    autoCheck: true,
    checkIntervalMs: 60_000,
  },
  advanced: {
    pollIntervalMs: 1000,
    backgroundPollIntervalMs: 5000,
    healthCheckIntervalMs: 10000,
    completedFadeMs: 5000,
    ipcTimeoutMs: 5000,
  },
};

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object"
    ) {
      result[key] = deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

const CURSOR_STYLES = ["bar", "block", "underline"];

export function validateConfig(config: Config): Config {
  const result = { ...config };
  const warn = (field: string, msg: string) =>
    logger.warn(`Config: invalid ${field} — ${msg}. Using default.`);

  // Shell
  if (typeof result.shell !== "string" || result.shell.length === 0) {
    warn("shell", "must be a non-empty string");
    result.shell = DEFAULT_CONFIG.shell;
  }

  // Shell args — default based on shell name if not explicitly set
  if (!Array.isArray(result.shellArgs)) {
    result.shellArgs = defaultShellArgs(result.shell);
  } else {
    result.shellArgs = result.shellArgs.filter((a) => typeof a === "string");
  }

  // Font
  if (typeof result.font.size !== "number" || result.font.size < 6 || result.font.size > 72) {
    warn("font.size", "must be 6–72");
    result.font = { ...result.font, size: DEFAULT_CONFIG.font.size };
  }
  if (
    typeof result.font.lineHeight !== "number" ||
    result.font.lineHeight < 0.5 ||
    result.font.lineHeight > 3
  ) {
    warn("font.lineHeight", "must be 0.5–3");
    result.font = { ...result.font, lineHeight: DEFAULT_CONFIG.font.lineHeight };
  }

  // Scrollback
  if (typeof result.scrollback !== "number" || result.scrollback < 100 || result.scrollback > 100000) {
    warn("scrollback", "must be 100–100000");
    result.scrollback = DEFAULT_CONFIG.scrollback;
  }

  // Cursor
  if (!CURSOR_STYLES.includes(result.cursor.style)) {
    warn("cursor.style", `must be one of: ${CURSOR_STYLES.join(", ")}`);
    result.cursor = { ...result.cursor, style: DEFAULT_CONFIG.cursor.style };
  }

  // Sidebar
  if (typeof result.sidebar.width !== "number" || result.sidebar.width < 100 || result.sidebar.width > 600) {
    warn("sidebar.width", "must be 100–600");
    result.sidebar = { ...result.sidebar, width: DEFAULT_CONFIG.sidebar.width };
  }
  if (result.sidebar.position !== "left" && result.sidebar.position !== "right") {
    warn("sidebar.position", "must be 'left' or 'right'");
    result.sidebar = { ...result.sidebar, position: DEFAULT_CONFIG.sidebar.position };
  }

  // Keybindings — validate format (modifier+key)
  const KEYBINDING_RE = /^(?:(?:cmd|ctrl|shift|alt|opt)\+)*[a-z0-9[\]\\/\-=`,.';\s]+$/i;
  if (result.keybindings) {
    for (const [key, val] of Object.entries(result.keybindings)) {
      if (typeof val !== "string" || !KEYBINDING_RE.test(val)) {
        warn(`keybindings.${key}`, `invalid format "${val}"`);
        const defaultVal = (DEFAULT_CONFIG.keybindings as Record<string, string>)[key];
        if (defaultVal) {
          (result.keybindings as Record<string, string>)[key] = defaultVal;
        }
      }
    }
  }

  // Quick commands — validate keybinding format and string values
  if (result.quickCommands && typeof result.quickCommands === "object") {
    for (const [key, val] of Object.entries(result.quickCommands)) {
      if (!KEYBINDING_RE.test(key)) {
        warn(`quickCommands key "${key}"`, "invalid keybinding format");
        delete (result.quickCommands as Record<string, string>)[key];
      } else if (typeof val !== "string") {
        warn(`quickCommands.${key}`, "value must be a string");
        delete (result.quickCommands as Record<string, string>)[key];
      }
    }
  }

  // Startup commands — validate string values
  if (result.startupCommands && typeof result.startupCommands === "object") {
    for (const [key, val] of Object.entries(result.startupCommands)) {
      if (typeof val !== "string") {
        warn(`startupCommands.${key}`, "value must be a string");
        delete (result.startupCommands as Record<string, string>)[key];
      }
    }
  }

  // Advanced numeric fields — clamp to sane ranges
  const clampNum = (field: keyof Config["advanced"], min: number, max: number) => {
    const val = result.advanced[field];
    if (typeof val !== "number" || val < min || val > max) {
      warn(`advanced.${field}`, `must be ${min}–${max}`);
      result.advanced = { ...result.advanced, [field]: DEFAULT_CONFIG.advanced[field] };
    }
  };
  // Ensure nested theme objects exist before accessing fields
  if (!result.theme || typeof result.theme !== "object") {
    result.theme = { ...DEFAULT_CONFIG.theme };
  }
  if (!result.theme.sidebar || typeof result.theme.sidebar !== "object") {
    result.theme.sidebar = { ...DEFAULT_CONFIG.theme.sidebar };
  }
  if (!result.theme.terminal || typeof result.theme.terminal !== "object") {
    result.theme.terminal = { ...DEFAULT_CONFIG.theme.terminal };
  }
  if (!result.theme.ui || typeof result.theme.ui !== "object") {
    result.theme.ui = { ...DEFAULT_CONFIG.theme.ui };
  }

  // UI theme numeric fields
  const ui = result.theme.ui;
  if (typeof ui.titlebarHeight !== "number" || ui.titlebarHeight < 28 || ui.titlebarHeight > 60) {
    warn("theme.ui.titlebarHeight", "must be 28–60");
    result.theme = { ...result.theme, ui: { ...ui, titlebarHeight: DEFAULT_CONFIG.theme.ui.titlebarHeight } };
  }
  if (typeof ui.statusBarHeight !== "number" || ui.statusBarHeight < 16 || ui.statusBarHeight > 48) {
    warn("theme.ui.statusBarHeight", "must be 16–48");
    result.theme = {
      ...result.theme,
      ui: { ...ui, statusBarHeight: DEFAULT_CONFIG.theme.ui.statusBarHeight },
    };
  }
  if (
    typeof ui.paneUnfocusedOpacity !== "number" ||
    ui.paneUnfocusedOpacity < 0.3 ||
    ui.paneUnfocusedOpacity > 1
  ) {
    warn("theme.ui.paneUnfocusedOpacity", "must be 0.3–1");
    result.theme = {
      ...result.theme,
      ui: { ...ui, paneUnfocusedOpacity: DEFAULT_CONFIG.theme.ui.paneUnfocusedOpacity },
    };
  }
  if (typeof ui.splitDividerWidth !== "number" || ui.splitDividerWidth < 3 || ui.splitDividerWidth > 20) {
    warn("theme.ui.splitDividerWidth", "must be 3–20");
    result.theme = {
      ...result.theme,
      ui: { ...ui, splitDividerWidth: DEFAULT_CONFIG.theme.ui.splitDividerWidth },
    };
  }

  // Clamp maxPanes — WebGL is now lazy (only active tab uses GPU contexts)
  // so we can allow more panes.  Still cap to prevent extreme resource usage.
  if (typeof result.maxPanes !== "number" || result.maxPanes < 1 || result.maxPanes > 16) {
    result.maxPanes = DEFAULT_CONFIG.maxPanes;
  }

  clampNum("pollIntervalMs", 500, 30000);
  clampNum("backgroundPollIntervalMs", 1000, 60000);
  clampNum("healthCheckIntervalMs", 2000, 120000);
  clampNum("completedFadeMs", 1000, 30000);
  clampNum("ipcTimeoutMs", 2000, 30000);

  return result;
}

/**
 * Migrate config from older schema versions to the current version.
 * Each migration function handles one version bump. Runs in order
 * so configs from any past version reach the current schema.
 */
function migrateConfig(config: Record<string, unknown>): void {
  const version = typeof config.configVersion === "number" ? config.configVersion : 0;

  if (version >= CONFIG_VERSION) return;

  // Migration 0 → 1: add configVersion, updates section
  if (version < 1) {
    config.configVersion = 1;
    if (!config.updates) {
      config.updates = { autoCheck: true, checkIntervalMs: 60_000 };
    }
    logger.debug("Migrated config from v0 to v1");
  }

  // Future migrations go here:
  // if (version < 2) { ... }
}

export async function loadConfig(): Promise<Config> {
  try {
    const text = await invoke<string>("read_config");

    if (!text) {
      // No config file exists, write defaults
      await invoke("write_config", {
        contents: JSON.stringify(DEFAULT_CONFIG, null, 2),
      });
      return { ...DEFAULT_CONFIG };
    }

    const userConfig: Record<string, unknown> = JSON.parse(text);

    // Run migrations if config version is older than current
    migrateConfig(userConfig);

    // If user set a custom shell but didn't specify shellArgs, derive smart defaults
    if (userConfig.shell && !userConfig.shellArgs) {
      userConfig.shellArgs = defaultShellArgs(userConfig.shell as string);
    }
    const merged = deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, userConfig) as unknown as Config;

    // Resolve theme preset: if user specified a preset, use it as the base
    // and merge any individual theme overrides on top.
    const userTheme = (userConfig.theme ?? {}) as Partial<Config["theme"]>;
    const presetName = userTheme.preset ?? "default-dark";
    merged.theme = resolveTheme(presetName, userTheme);

    const validated = validateConfig(merged);

    // Check shell path exists and is executable on disk
    try {
      const shellOk = await invoke<boolean>("validate_shell", { path: validated.shell });
      if (!shellOk) {
        logger.warn(`Config: shell "${validated.shell}" not found or not executable. Using default.`);
        showToast(`Shell "${validated.shell}" not found — using ${DEFAULT_CONFIG.shell}`, "warn");
        validated.shell = DEFAULT_CONFIG.shell;
      }
    } catch (e) {
      logger.warn("Shell validation failed:", e);
    }

    return validated;
  } catch (e) {
    logger.warn("Failed to load config, using defaults:", e);
    showToast("Config file is invalid — using defaults", "warn");
    return { ...DEFAULT_CONFIG };
  }
}

// Maps a key to its shifted counterpart for bindings like "cmd+=" that should
// also match when the user presses Cmd+Shift+= (which produces "+").
const SHIFTED_KEYS: Record<string, string> = {
  "=": "+",
  "-": "_",
  "[": "{",
  "]": "}",
  "\\": "|",
  ";": ":",
  "'": '"',
  ",": "<",
  ".": ">",
  "/": "?",
  "`": "~",
};

export function matchesKeybinding(e: KeyboardEvent, binding: string): boolean {
  const parts = binding.toLowerCase().split("+");
  const wantCmd = parts.includes("cmd");
  const wantCtrl = parts.includes("ctrl");
  const wantShift = parts.includes("shift");
  const wantAlt = parts.includes("alt") || parts.includes("opt");
  const key = parts[parts.length - 1];

  // cmd = metaKey (Mac ⌘), ctrl = ctrlKey — treated as distinct modifiers
  const cmdOk = wantCmd ? e.metaKey : !e.metaKey;
  const ctrlOk = wantCtrl ? e.ctrlKey : !e.ctrlKey;
  const altOk = wantAlt ? e.altKey : !e.altKey;
  const keyOk = e.key.toLowerCase() === key;

  // When Shift is not explicitly required by the binding but the user holds it,
  // accept the keypress if the resulting key matches the shifted variant of the
  // bound key (e.g. binding "cmd+=" also matches Cmd+Shift+= which produces "+").
  const shiftedKey = SHIFTED_KEYS[key];
  const shiftOk = wantShift ? e.shiftKey : !e.shiftKey || (shiftedKey !== undefined && e.key === shiftedKey);
  const keyOkFinal = keyOk || (!wantShift && e.key === shiftedKey);

  return cmdOk && ctrlOk && shiftOk && altOk && keyOkFinal;
}

export function applyThemeToCSS(config: Config) {
  const root = document.documentElement;
  const s = config.theme.sidebar;
  root.style.setProperty("--sidebar-bg", s.background);
  root.style.setProperty("--sidebar-border", s.border);
  root.style.setProperty("--sidebar-tab-active", s.tabActive);
  root.style.setProperty("--sidebar-tab-hover", s.tabHover);
  root.style.setProperty("--sidebar-tab-text", s.tabText);
  root.style.setProperty("--sidebar-tab-text-active", s.tabTextActive);
  root.style.setProperty("--sidebar-accent", s.accentColor);
  root.style.setProperty("--sidebar-width", `${config.sidebar.width}px`);
  root.style.setProperty("--terminal-bg", config.theme.terminal.background);

  // UI theme
  const u = config.theme.ui;
  root.style.setProperty("--window-border-radius", u.windowBorderRadius);
  root.style.setProperty("--window-border-color", u.windowBorderColor);
  root.style.setProperty("--titlebar-height", `${u.titlebarHeight}px`);
  root.style.setProperty("--status-bar-height", `${u.statusBarHeight}px`);
  root.style.setProperty("--pane-padding", u.panePadding);
  root.style.setProperty("--pane-focus-outline", u.paneFocusOutline);
  root.style.setProperty("--pane-unfocused-opacity", String(u.paneUnfocusedOpacity));
  root.style.setProperty("--split-divider-width", `${u.splitDividerWidth}px`);
  root.style.setProperty("--color-orange", u.colorOrange);
  root.style.setProperty("--color-red", u.colorRed);
  root.style.setProperty("--color-green", u.colorGreen);
  root.style.setProperty("--transition-speed", u.transitionSpeed);

  // Type scale — derived from base font size
  const base = u.fontSize;
  root.style.setProperty("--font-2xs", `${Math.round(base * 0.67)}px`);
  root.style.setProperty("--font-xs", `${Math.round(base * 0.83)}px`);
  root.style.setProperty("--font-sm", `${Math.round(base * 0.92)}px`);
  root.style.setProperty("--font-base", `${base}px`);
  root.style.setProperty("--font-md", `${Math.round(base * 1.08)}px`);
  root.style.setProperty("--font-lg", `${Math.round(base * 1.17)}px`);
  root.style.setProperty("--font-xl", `${Math.round(base * 1.25)}px`);
  root.style.setProperty("--font-2xl", `${Math.round(base * 1.67)}px`);

  // Surface, shadow & accent tokens
  root.style.setProperty("--surface-elevated", u.surfaceElevated);
  root.style.setProperty("--surface-modal", u.surfaceModal);
  root.style.setProperty("--surface-panel", u.surfacePanel);
  root.style.setProperty("--overlay-backdrop", u.overlayBackdrop);
  root.style.setProperty("--surface-badge", u.surfaceBadge);
  root.style.setProperty("--shadow-sm", u.shadowSm);
  root.style.setProperty("--shadow-lg", u.shadowLg);
  root.style.setProperty("--accent-subtle", u.accentSubtle);
  root.style.setProperty("--accent-border", u.accentBorder);
  root.style.setProperty("--accent-muted", u.accentMuted);
  root.style.setProperty("--red-muted", u.redMuted);
  root.style.setProperty("--orange-muted", u.orangeMuted);

  // Border radii
  root.style.setProperty("--radius-sm", `${u.radiusSm}px`);
  root.style.setProperty("--radius-md", `${u.radiusMd}px`);
  root.style.setProperty("--radius-lg", `${u.radiusLg}px`);

  // Opacity scale
  root.style.setProperty("--opacity-dim", String(u.opacityDim));
  root.style.setProperty("--opacity-muted", String(u.opacityMuted));
  root.style.setProperty("--opacity-subtle", String(u.opacitySubtle));
  root.style.setProperty("--opacity-soft", String(u.opacitySoft));
  root.style.setProperty("--opacity-medium", String(u.opacityMedium));
  root.style.setProperty("--opacity-strong", String(u.opacityStrong));

  // Spacing scale
  for (const [i, key] of ["space1", "space2", "space3", "space4", "space5", "space6", "space7", "space8", "space9", "space10"].entries()) {
    root.style.setProperty(`--space-${i + 1}`, `${u[key as keyof typeof u]}px`);
  }

  // Animation durations
  root.style.setProperty("--anim-fast", u.animFast);
  root.style.setProperty("--anim-normal", u.animNormal);
  root.style.setProperty("--anim-pulse", u.animPulse);
  root.style.setProperty("--anim-breathe", u.animBreathe);

  // Font weights
  root.style.setProperty("--font-weight-regular", String(u.fontWeightRegular));
  root.style.setProperty("--font-weight-medium", String(u.fontWeightMedium));
  root.style.setProperty("--font-weight-semibold", String(u.fontWeightSemibold));

  // Letter spacing
  root.style.setProperty("--letter-spacing-normal", u.letterSpacingNormal);
  root.style.setProperty("--letter-spacing-wide", u.letterSpacingWide);

  // Icon sizes
  root.style.setProperty("--icon-sm", `${u.iconSm}px`);
  root.style.setProperty("--icon-md", `${u.iconMd}px`);
  root.style.setProperty("--icon-lg", `${u.iconLg}px`);

  // Scrollbar
  root.style.setProperty("--scrollbar-width", `${u.scrollbarWidth}px`);

  // Platform window control colors
  root.style.setProperty("--traffic-close", u.trafficClose);
  root.style.setProperty("--traffic-minimize", u.trafficMinimize);
  root.style.setProperty("--traffic-maximize", u.trafficMaximize);


  // Text alpha scale — theme-aware (white for dark themes, black for light)
  const tc = u.textColor;
  for (const step of [4, 6, 8, 10, 12, 15, 20, 30, 35, 40, 45, 50, 60, 70, 80, 85, 90]) {
    root.style.setProperty(`--text-${String(step).padStart(2, "0")}`, `rgba(${tc}, ${step / 100})`);
  }
}
