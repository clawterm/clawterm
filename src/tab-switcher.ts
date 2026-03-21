import { trapFocus } from "./utils";

export interface SwitcherTab {
  id: string;
  title: string;
  subtitle: string | null;
  activity: string;
}

export class TabSwitcher {
  private overlay: HTMLDivElement;
  private input: HTMLInputElement;
  private list: HTMLDivElement;
  private removeTrap: (() => void) | null = null;
  private tabs: SwitcherTab[] = [];
  private filtered: SwitcherTab[] = [];
  private selectedIndex = 0;
  private onSelect: ((id: string) => void) | null = null;

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.className = "tab-switcher-overlay";
    this.overlay.style.display = "none";

    const modal = document.createElement("div");
    modal.className = "tab-switcher-modal";

    this.input = document.createElement("input");
    this.input.className = "tab-switcher-input";
    this.input.type = "text";
    this.input.placeholder = "Switch to tab...";
    this.input.setAttribute("aria-label", "Search tabs");
    this.input.setAttribute("role", "combobox");
    this.input.setAttribute("aria-expanded", "true");
    this.input.setAttribute("aria-controls", "tab-switcher-listbox");
    this.input.setAttribute("aria-autocomplete", "list");

    this.list = document.createElement("div");
    this.list.className = "tab-switcher-list";
    this.list.id = "tab-switcher-listbox";
    this.list.setAttribute("role", "listbox");

    modal.appendChild(this.input);
    modal.appendChild(this.list);
    this.overlay.appendChild(modal);
    document.body.appendChild(this.overlay);

    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.hide();
    });

    this.input.addEventListener("input", () => {
      this.filter();
      this.render();
    });

    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.hide();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.filtered.length - 1);
        this.render();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this.render();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (this.filtered[this.selectedIndex]) {
          this.onSelect?.(this.filtered[this.selectedIndex].id);
          this.hide();
        }
      }
    });
  }

  show(tabs: SwitcherTab[], selectCallback: (id: string) => void) {
    this.tabs = tabs;
    this.onSelect = selectCallback;
    this.selectedIndex = 0;
    this.input.value = "";
    this.filter();
    this.render();

    this.overlay.style.display = "flex";
    this.removeTrap = trapFocus(this.overlay);
    this.input.focus();
  }

  hide() {
    this.overlay.style.display = "none";
    this.removeTrap?.();
    this.removeTrap = null;
  }

  dispose() {
    this.overlay.remove();
    this.onSelect = null;
    // Break references for GC after disposal — the object must not be used after this.
    const self = this as unknown as Record<string, unknown>;
    self.overlay = null;
    self.input = null;
    self.list = null;
  }

  private filter() {
    const query = this.input.value.toLowerCase();
    if (!query) {
      this.filtered = [...this.tabs];
    } else {
      this.filtered = this.tabs.filter((t) => {
        const text = `${t.title} ${t.subtitle ?? ""}`.toLowerCase();
        // Simple fuzzy: all chars of query appear in order
        let qi = 0;
        for (let i = 0; i < text.length && qi < query.length; i++) {
          if (text[i] === query[qi]) qi++;
        }
        return qi === query.length;
      });
    }
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(this.filtered.length - 1, 0));
  }

  private render() {
    this.list.innerHTML = "";
    for (let i = 0; i < this.filtered.length; i++) {
      const tab = this.filtered[i];
      const el = document.createElement("div");
      el.className = "tab-switcher-item";
      el.setAttribute("role", "option");
      el.setAttribute("aria-selected", i === this.selectedIndex ? "true" : "false");
      if (i === this.selectedIndex) el.classList.add("selected");

      const title = document.createElement("span");
      title.className = "tab-switcher-item-title";
      title.textContent = tab.title;
      el.appendChild(title);

      if (tab.subtitle) {
        const sub = document.createElement("span");
        sub.className = "tab-switcher-item-subtitle";
        sub.textContent = tab.subtitle;
        el.appendChild(sub);
      }

      el.addEventListener("click", () => {
        this.onSelect?.(tab.id);
        this.hide();
      });

      el.addEventListener("mouseenter", () => {
        this.selectedIndex = i;
        this.render();
      });

      this.list.appendChild(el);
    }
  }
}
