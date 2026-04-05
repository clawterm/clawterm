import type { Config } from "./config";
import { modLabel } from "./utils";
import { manualCheckForUpdates } from "./updater";

declare const __APP_VERSION__: string;

interface ShortcutEntry {
  label: string;
  binding: string;
}

interface ShortcutGroup {
  title: string;
  entries: ShortcutEntry[];
}

function formatBinding(raw: string): string {
  return raw
    .replace(/cmd/gi, modLabel)
    .replace(/shift/gi, "\u21E7")
    .replace(/alt|opt/gi, "\u2325")
    .replace(/ctrl/gi, "\u2303")
    .replace(/\+/g, " ")
    .toUpperCase();
}

function buildGroups(config: Config): ShortcutGroup[] {
  const kb = config.keybindings;
  return [
    {
      title: "Tabs",
      entries: [
        { label: "New tab", binding: kb.newTab },
        { label: "Close tab", binding: kb.closeTab },
        { label: "Next tab", binding: kb.nextTab },
        { label: "Previous tab", binding: kb.prevTab },
        { label: "Tab above", binding: "cmd+\u2191" },
        { label: "Tab below", binding: "cmd+\u2193" },
        { label: "Quick switch", binding: kb.quickSwitch },
        { label: "Restore closed tab", binding: kb.restoreTab },
      ],
    },
    {
      title: "Projects",
      entries: [
        { label: "Next project", binding: kb.nextProject },
        { label: "Previous project", binding: kb.prevProject },
        ...(kb.newProject ? [{ label: "New project", binding: kb.newProject }] : []),
      ],
    },
    {
      title: "Panes",
      entries: [
        { label: "Split horizontal", binding: kb.splitHorizontal },
        { label: "Split vertical", binding: kb.splitVertical },
        { label: "Close pane", binding: kb.closePane },
        { label: "Focus next pane", binding: kb.focusNextPane },
        { label: "Focus previous pane", binding: kb.focusPrevPane },
        { label: "Resize pane", binding: "cmd+shift+arrow" },
        { label: "Jump to pane 1-9", binding: "cmd+alt+1-9" },
        { label: "Balance splits", binding: "Double-click divider" },
      ],
    },
    {
      title: "Terminal",
      entries: [
        { label: "Command palette", binding: kb.commandPalette },
        { label: "Settings", binding: "cmd+," },
        { label: "Search", binding: kb.search },
        { label: "Zoom in", binding: kb.zoomIn },
        { label: "Zoom out", binding: kb.zoomOut },
        { label: "Reset zoom", binding: kb.zoomReset },
        { label: "Reload config", binding: kb.reloadConfig },
        { label: "Cycle attention tabs", binding: kb.cycleAttention },
      ],
    },
    ...(Object.keys(config.quickCommands).length > 0
      ? [
          {
            title: "Quick Commands",
            entries: Object.entries(config.quickCommands).map(([binding, cmd]) => ({
              label: cmd.replace(/\\n$/, "").replace(/\n$/, ""),
              binding,
            })),
          },
        ]
      : []),
  ];
}

export function createSettingsPanel(config: Config, onOpenConfig: () => void): HTMLDivElement {
  const panel = document.createElement("div");
  panel.className = "shortcuts-panel";

  // ── About section ──
  const aboutHeader = document.createElement("div");
  aboutHeader.className = "shortcuts-header";
  aboutHeader.textContent = "Clawterm";
  panel.appendChild(aboutHeader);

  const version = document.createElement("div");
  version.className = "shortcuts-hint";
  version.textContent = `Version ${__APP_VERSION__}`;
  panel.appendChild(version);

  const configRow = document.createElement("div");
  configRow.className = "settings-config-row";

  const configPath = document.createElement("span");
  configPath.className = "settings-config-path";
  configPath.textContent = "~/.config/clawterm/config.json";
  configRow.appendChild(configPath);

  const openBtn = document.createElement("button");
  openBtn.className = "settings-open-btn";
  openBtn.textContent = "Open";
  openBtn.addEventListener("click", onOpenConfig);
  configRow.appendChild(openBtn);

  panel.appendChild(configRow);

  // ── Updates section ──
  const updatesHeader = document.createElement("div");
  updatesHeader.className = "shortcuts-group-title";
  updatesHeader.textContent = "Updates";
  panel.appendChild(updatesHeader);

  const updatesRow = document.createElement("div");
  updatesRow.className = "settings-config-row";

  const versionLabel = document.createElement("span");
  versionLabel.className = "settings-config-path";
  versionLabel.textContent = `v${__APP_VERSION__}`;
  updatesRow.appendChild(versionLabel);

  const checkBtn = document.createElement("button");
  checkBtn.className = "settings-update-btn";
  checkBtn.textContent = "Check for Updates";
  checkBtn.addEventListener("click", async () => {
    checkBtn.textContent = "Checking\u2026";
    checkBtn.disabled = true;
    try {
      await manualCheckForUpdates();
      checkBtn.textContent = "Up to date";
      setTimeout(() => {
        checkBtn.textContent = "Check for Updates";
        checkBtn.disabled = false;
      }, 2000);
    } catch {
      checkBtn.textContent = "Check failed";
      setTimeout(() => {
        checkBtn.textContent = "Check for Updates";
        checkBtn.disabled = false;
      }, 2000);
    }
  });
  updatesRow.appendChild(checkBtn);
  panel.appendChild(updatesRow);

  // ── Keyboard Shortcuts ──
  const shortcutsHeader = document.createElement("div");
  shortcutsHeader.className = "shortcuts-group-title";
  shortcutsHeader.style.marginTop = "var(--space-9)";
  shortcutsHeader.textContent = "Keyboard Shortcuts";
  panel.appendChild(shortcutsHeader);

  const groups = buildGroups(config);

  for (const group of groups) {
    const section = document.createElement("div");
    section.className = "shortcuts-group";

    const title = document.createElement("div");
    title.className = "shortcuts-group-title";
    title.textContent = group.title;
    section.appendChild(title);

    for (const entry of group.entries) {
      const row = document.createElement("div");
      row.className = "shortcuts-row";

      const label = document.createElement("span");
      label.className = "shortcuts-label";
      label.textContent = entry.label;

      const kbd = document.createElement("kbd");
      kbd.className = "shortcuts-kbd";
      kbd.textContent = formatBinding(entry.binding);

      row.appendChild(label);
      row.appendChild(kbd);
      section.appendChild(row);
    }

    panel.appendChild(section);
  }

  return panel;
}
