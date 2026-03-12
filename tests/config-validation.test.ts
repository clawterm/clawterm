import { describe, it, expect, vi } from "vitest";
import { validateConfig } from "../src/config";

describe("validateConfig", () => {
  // Get a valid base config to modify
  function baseConfig() {
    return {
      shell: "/bin/zsh",
      font: { family: "Menlo", size: 14, lineHeight: 1.3 },
      cursor: { style: "bar" as const, blink: true },
      sidebar: { width: 200, position: "left" as const },
      maxTabs: 20,
      theme: {
        sidebar: {
          background: "#000000", border: "rgba(255, 255, 255, 0.08)",
          tabActive: "rgba(255, 255, 255, 0.1)", tabHover: "rgba(255, 255, 255, 0.06)",
          tabText: "rgba(255, 255, 255, 0.45)", tabTextActive: "rgba(255, 255, 255, 0.9)",
          accentColor: "#0a84ff",
        },
        terminal: {
          background: "#000000", foreground: "#f8f8f2", cursor: "#f8f8f2",
          cursorAccent: "#000000", selectionBackground: "#44475a", selectionForeground: "#ffffff",
          black: "#000000", red: "#ff5555", green: "#00ff87", yellow: "#ffff00",
          blue: "#5f87ff", magenta: "#ff00ff", cyan: "#00ffff", white: "#f8f8f2",
          brightBlack: "#545454", brightRed: "#ff4444", brightGreen: "#00ff00",
          brightYellow: "#ffff55", brightBlue: "#87afff", brightMagenta: "#ff87ff",
          brightCyan: "#55ffff", brightWhite: "#ffffff",
        },
      },
      keybindings: {
        newTab: "cmd+t", closeTab: "cmd+w", nextTab: "cmd+shift+]",
        prevTab: "cmd+shift+[", reloadConfig: "cmd+shift+r", cycleAttention: "cmd+shift+a",
        search: "cmd+f", quickSwitch: "cmd+p",
      },
      outputAnalysis: { enabled: true, bufferSize: 4096 },
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
  }

  it("returns valid config unchanged", () => {
    const config = baseConfig();
    const result = validateConfig(config as any);
    expect(result.font.size).toBe(14);
    expect(result.cursor.style).toBe("bar");
  });

  it("rejects font.size out of range", () => {
    const config = baseConfig();
    config.font.size = 200;
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = validateConfig(config as any);
    expect(result.font.size).toBe(14); // default
    spy.mockRestore();
  });

  it("rejects invalid cursor style", () => {
    const config = baseConfig();
    (config.cursor as any).style = "blink-blink";
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = validateConfig(config as any);
    expect(result.cursor.style).toBe("bar");
    spy.mockRestore();
  });

  it("rejects empty shell", () => {
    const config = baseConfig();
    config.shell = "";
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = validateConfig(config as any);
    expect(result.shell).toBe("/bin/zsh");
    spy.mockRestore();
  });

  it("rejects sidebar width out of range", () => {
    const config = baseConfig();
    config.sidebar.width = 50;
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = validateConfig(config as any);
    expect(result.sidebar.width).toBe(200);
    spy.mockRestore();
  });
});
