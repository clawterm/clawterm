import { invoke } from "@tauri-apps/api/core";
import type { NotificationsConfig } from "./notifications";
import { logger } from "./logger";
import { modKey, isMac } from "./utils";

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

export interface Config {
  shell: string;
  font: {
    family: string;
    size: number;
    lineHeight: number;
  };
  cursor: {
    style: "bar" | "block" | "underline";
    blink: boolean;
  };
  sidebar: {
    width: number;
    position: "left" | "right";
  };
  theme: {
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
    [key: string]: string;
  };
  maxTabs: number;
  outputAnalysis: {
    enabled: boolean;
    bufferSize: number;
  };
  notifications: NotificationsConfig;
  advanced: {
    pollIntervalMs: number;
    backgroundPollIntervalMs: number;
    healthCheckIntervalMs: number;
    completedFadeMs: number;
    ipcTimeoutMs: number;
  };
}

const DEFAULT_CONFIG: Config = {
  shell: isMac ? "/bin/zsh" : "bash",
  font: {
    family: isMac ? "Menlo, Monaco, monospace" : "'Cascadia Code', 'Consolas', 'DejaVu Sans Mono', monospace",
    size: 14,
    lineHeight: 1.3,
  },
  cursor: {
    style: "bar",
    blink: true,
  },
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
  },
  maxTabs: 20,
  outputAnalysis: {
    enabled: true,
    bufferSize: 4096,
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
  advanced: {
    pollIntervalMs: 2000,
    backgroundPollIntervalMs: 5000,
    healthCheckIntervalMs: 10000,
    completedFadeMs: 5000,
    ipcTimeoutMs: 5000,
  },
};

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object"
    ) {
      result[key] = deepMerge(target[key], source[key]);
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

  return result;
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

    const userConfig = JSON.parse(text);
    return validateConfig(deepMerge(DEFAULT_CONFIG, userConfig));
  } catch (e) {
    logger.warn("Failed to load config, using defaults:", e);
    return { ...DEFAULT_CONFIG };
  }
}

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
  const shiftOk = wantShift ? e.shiftKey : !e.shiftKey;
  const altOk = wantAlt ? e.altKey : !e.altKey;
  const keyOk = e.key.toLowerCase() === key;

  return cmdOk && ctrlOk && shiftOk && altOk && keyOk;
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
}
