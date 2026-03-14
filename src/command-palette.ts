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

  const list = document.createElement("div");
  list.className = "palette-list";

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
