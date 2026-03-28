import type { ThemePreset } from "./types";
import type { Config } from "../config-types";
import { defaultDark } from "./presets/default-dark";
import { midnight } from "./presets/midnight";
import { solarizedDark } from "./presets/solarized-dark";
import { solarizedLight } from "./presets/solarized-light";
import { dracula } from "./presets/dracula";
import { nord } from "./presets/nord";
import { gruvboxDark } from "./presets/gruvbox-dark";
import { tokyoNight } from "./presets/tokyo-night";
import { catppuccinMocha } from "./presets/catppuccin-mocha";
import { rosePine } from "./presets/rose-pine";
import { invoke } from "@tauri-apps/api/core";
import { logger } from "../logger";

/** Built-in theme presets keyed by slug. */
export const PRESETS: Record<string, ThemePreset> = {
  "default-dark": defaultDark,
  midnight,
  "solarized-dark": solarizedDark,
  "solarized-light": solarizedLight,
  dracula,
  nord,
  "gruvbox-dark": gruvboxDark,
  "tokyo-night": tokyoNight,
  "catppuccin-mocha": catppuccinMocha,
  "rose-pine": rosePine,
};

/** Ordered list of built-in preset names. */
export const PRESET_NAMES = Object.keys(PRESETS);

/** Custom themes loaded from ~/.config/clawterm/themes/*.json */
const customThemes: Record<string, ThemePreset> = {};

/** All available theme names (built-in + custom). Updated by loadCustomThemes(). */
let allThemeNames: string[] = [...PRESET_NAMES];

/** Get the full ordered list of theme names (built-in + custom). */
export function getAllThemeNames(): string[] {
  return allThemeNames;
}

/**
 * Load custom theme files from ~/.config/clawterm/themes/.
 * Call on startup and after config reload.
 */
export async function loadCustomThemes(): Promise<void> {
  try {
    const entries = await invoke<[string, string][]>("list_custom_themes");
    // Clear previous custom themes
    for (const key of Object.keys(customThemes)) delete customThemes[key];

    for (const [name, contents] of entries) {
      try {
        const parsed = JSON.parse(contents);
        // Validate: must have sidebar, terminal, and ui with key fields present
        if (
          parsed.sidebar?.background &&
          parsed.sidebar?.accentColor &&
          parsed.terminal?.background &&
          parsed.terminal?.foreground &&
          parsed.ui?.surfaceElevated
        ) {
          if (!parsed.name) parsed.name = name;
          // Fill missing ui fields from default-dark to prevent runtime errors
          const base = PRESETS["default-dark"];
          parsed.sidebar = { ...base.sidebar, ...parsed.sidebar };
          parsed.terminal = { ...base.terminal, ...parsed.terminal };
          parsed.ui = { ...base.ui, ...parsed.ui };
          customThemes[name] = parsed as ThemePreset;
        } else {
          logger.warn(`Custom theme "${name}" missing required fields, skipping`);
        }
      } catch (e) {
        logger.warn(`Custom theme "${name}" has invalid JSON, skipping:`, e);
      }
    }

    allThemeNames = [...PRESET_NAMES, ...Object.keys(customThemes)];
  } catch (e) {
    logger.warn("Failed to load custom themes:", e);
  }
}

/**
 * Resolve a theme by merging: preset defaults → user overrides.
 * Checks built-in presets first, then custom themes.
 * Returns a complete theme section ready for config.theme.
 */
export function resolveTheme(
  presetName: string,
  userOverrides: Partial<Config["theme"]>,
): Config["theme"] & { preset: string } {
  const preset = PRESETS[presetName] ?? customThemes[presetName];
  if (!preset) {
    logger.warn(`Unknown theme preset "${presetName}", falling back to default-dark`);
    return resolveTheme("default-dark", userOverrides);
  }

  // Deep merge: preset → user overrides
  const sidebar = { ...preset.sidebar, ...(userOverrides.sidebar ?? {}) };
  const terminal = { ...preset.terminal, ...(userOverrides.terminal ?? {}) };
  const ui = { ...preset.ui, ...(userOverrides.ui ?? {}) };

  // Auto-derive accent tokens from the resolved accent color so presets
  // with non-red accents stay self-consistent instead of mixing colors.
  const accent = sidebar.accentColor;
  const rgb = hexToRGB(accent);
  if (rgb) {
    const [r, g, b] = rgb;
    ui.accentSubtle = `rgba(${r}, ${g}, ${b}, 0.08)`;
    ui.accentBorder = `rgba(${r}, ${g}, ${b}, 0.2)`;
    ui.accentMuted = `rgba(${r}, ${g}, ${b}, 0.35)`;
    ui.paneFocusOutline = `rgba(${r}, ${g}, ${b}, 0.5)`;
  }

  return { preset: presetName, sidebar, terminal, ui };
}

/** Parse a hex color string (#RGB, #RRGGBB) to [r, g, b] or null. */
function hexToRGB(hex: string): [number, number, number] | null {
  const m = hex.match(/^#?([0-9a-f]{3,8})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length < 6) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
