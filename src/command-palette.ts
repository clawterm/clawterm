export interface PaletteCommand {
  id: string;
  label: string;
  category?: string;
  action: () => void;
}

let overlay: HTMLDivElement | null = null;

export function showCommandPalette(commands: PaletteCommand[]): void {
  if (overlay) {
    // Check if the overlay is still in the DOM (could have been removed externally)
    if (!overlay.isConnected) {
      overlay = null;
    } else {
      dismissPalette();
      return;
    }
  }

  overlay = document.createElement("div");
  overlay.className = "palette-overlay";

  const modal = document.createElement("div");
  modal.className = "palette-modal";

  const input = document.createElement("input");
  input.className = "palette-input";
  input.type = "text";
  input.placeholder = "Type a command\u2026";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-controls", "palette-listbox");
  input.setAttribute("aria-autocomplete", "list");

  const list = document.createElement("div");
  list.className = "palette-list";
  list.id = "palette-listbox";
  list.setAttribute("role", "listbox");

  modal.appendChild(input);
  modal.appendChild(list);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  let filtered = [...commands];
  let selectedIdx = 0;

  function render() {
    list.innerHTML = "";
    for (let i = 0; i < filtered.length; i++) {
      const cmd = filtered[i];
      const item = document.createElement("div");
      item.className = "palette-item" + (i === selectedIdx ? " selected" : "");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", i === selectedIdx ? "true" : "false");
      item.id = `palette-opt-${i}`;

      if (cmd.category) {
        const cat = document.createElement("span");
        cat.className = "palette-category";
        cat.textContent = cmd.category;
        item.appendChild(cat);
      }

      const label = document.createElement("span");
      label.className = "palette-label";
      label.textContent = cmd.label;
      item.appendChild(label);

      item.addEventListener("click", () => {
        dismissPalette();
        cmd.action();
      });
      item.addEventListener("mouseenter", () => {
        selectedIdx = i;
        render();
      });
      list.appendChild(item);
    }
  }

  function filter() {
    const query = input.value.toLowerCase();
    if (!query) {
      filtered = [...commands];
    } else {
      filtered = commands.filter(
        (c) =>
          c.label.toLowerCase().includes(query) || (c.category && c.category.toLowerCase().includes(query)),
      );
    }
    selectedIdx = 0;
    render();
  }

  input.addEventListener("input", filter);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      dismissPalette();
      return;
    }
    // Trap Tab within the palette to prevent focus escaping to background elements
    if (e.key === "Tab") {
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, filtered.length - 1);
      render();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
      render();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[selectedIdx]) {
        const cmd = filtered[selectedIdx];
        dismissPalette();
        cmd.action();
      }
      return;
    }
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) dismissPalette();
  });

  render();
  input.focus();
}

function dismissPalette() {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
}

/**
 * Show a theme picker sub-palette with live preview.
 * Arrow through presets to preview them; Enter to persist, Escape to revert.
 */
export function showThemePalette(
  presets: string[],
  activePreset: string,
  onPreview: (name: string) => void,
  onSelect: (name: string) => void,
  onCancel: () => void,
): void {
  if (overlay) {
    if (!overlay.isConnected) overlay = null;
    else {
      dismissPalette();
      return;
    }
  }

  overlay = document.createElement("div");
  overlay.className = "palette-overlay";

  const modal = document.createElement("div");
  modal.className = "palette-modal";

  const input = document.createElement("input");
  input.className = "palette-input";
  input.type = "text";
  input.placeholder = "Search themes\u2026";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "true");

  const list = document.createElement("div");
  list.className = "palette-list";
  list.setAttribute("role", "listbox");

  modal.appendChild(input);
  modal.appendChild(list);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  let filtered = [...presets];
  let selectedIdx = Math.max(0, filtered.indexOf(activePreset));

  function render() {
    list.innerHTML = "";
    for (let i = 0; i < filtered.length; i++) {
      const name = filtered[i];
      const item = document.createElement("div");
      item.className = "palette-item" + (i === selectedIdx ? " selected" : "");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", i === selectedIdx ? "true" : "false");

      if (name === activePreset) {
        const dot = document.createElement("span");
        dot.className = "palette-category";
        dot.textContent = "\u25cf";
        item.appendChild(dot);
      }

      const label = document.createElement("span");
      label.className = "palette-label";
      // Display name: "default-dark" → "Default Dark"
      label.textContent = name
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      item.appendChild(label);

      item.addEventListener("click", () => {
        dismissPalette();
        onSelect(filtered[i]);
      });
      item.addEventListener("mouseenter", () => {
        selectedIdx = i;
        render();
        onPreview(filtered[i]);
      });
      list.appendChild(item);
    }
  }

  function filter() {
    const query = input.value.toLowerCase();
    if (!query) {
      filtered = [...presets];
    } else {
      filtered = presets.filter((p) => p.toLowerCase().includes(query));
    }
    selectedIdx = 0;
    render();
    if (filtered[0]) onPreview(filtered[0]);
  }

  input.addEventListener("input", filter);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      dismissPalette();
      onCancel();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, filtered.length - 1);
      render();
      onPreview(filtered[selectedIdx]);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
      render();
      onPreview(filtered[selectedIdx]);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[selectedIdx]) {
        const name = filtered[selectedIdx];
        dismissPalette();
        onSelect(name);
      }
      return;
    }
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      dismissPalette();
      onCancel();
    }
  });

  render();
  input.focus();
}
