import type { TerminalTheme, UITheme } from "../config-types";

/** A complete theme preset — everything needed to skin the app. */
export interface ThemePreset {
  name: string;
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
}
