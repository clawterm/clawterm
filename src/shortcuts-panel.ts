import type { Config } from "./config";
import { modLabel } from "./utils";

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

export function createShortcutsPanel(config: Config): HTMLDivElement {
  const panel = document.createElement("div");
  panel.className = "shortcuts-panel";

  const header = document.createElement("div");
  header.className = "shortcuts-header";
  header.textContent = "Keyboard Shortcuts";
  panel.appendChild(header);

  const hint = document.createElement("div");
  hint.className = "shortcuts-hint";
  hint.textContent = "Edit in ~/.config/clawterm/config.json";
  panel.appendChild(hint);

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
