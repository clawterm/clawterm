import { invoke } from "@tauri-apps/api/core";

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
    [key: string]: string;
  };
}

const DEFAULT_CONFIG: Config = {
  shell: "/bin/zsh",
  font: {
    family: "Menlo, Monaco, monospace",
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
    newTab: "cmd+t",
    closeTab: "cmd+w",
    nextTab: "cmd+shift+]",
    prevTab: "cmd+shift+[",
    reloadConfig: "cmd+shift+r",
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
    return deepMerge(DEFAULT_CONFIG, userConfig);
  } catch (e) {
    console.warn("Failed to load config, using defaults:", e);
    return { ...DEFAULT_CONFIG };
  }
}

export function matchesKeybinding(e: KeyboardEvent, binding: string): boolean {
  const parts = binding.toLowerCase().split("+");
  const wantMeta = parts.includes("cmd") || parts.includes("ctrl");
  const wantShift = parts.includes("shift");
  const wantAlt = parts.includes("alt") || parts.includes("opt");
  const key = parts[parts.length - 1];

  const metaOk = wantMeta ? e.metaKey || e.ctrlKey : !e.metaKey && !e.ctrlKey;
  const shiftOk = wantShift ? e.shiftKey : !e.shiftKey;
  const altOk = wantAlt ? e.altKey : !e.altKey;
  const keyOk = e.key.toLowerCase() === key;

  return metaOk && shiftOk && altOk && keyOk;
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
