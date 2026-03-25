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

/** Ordered list of preset names for the theme picker. */
export const PRESET_NAMES = Object.keys(PRESETS);

/**
 * Resolve a theme by merging: preset defaults → user overrides.
 * Returns a complete theme section ready for config.theme.
 */
export function resolveTheme(
  presetName: string,
  userOverrides: Partial<Config["theme"]>,
): Config["theme"] & { preset: string } {
  const preset = PRESETS[presetName];
  if (!preset) {
    logger.warn(`Unknown theme preset "${presetName}", falling back to default-dark`);
    return resolveTheme("default-dark", userOverrides);
  }

  // Deep merge: preset → user overrides
  const sidebar = { ...preset.sidebar, ...(userOverrides.sidebar ?? {}) };
  const terminal = { ...preset.terminal, ...(userOverrides.terminal ?? {}) };
  const ui = { ...preset.ui, ...(userOverrides.ui ?? {}) };

  return { preset: presetName, sidebar, terminal, ui };
}
