import { Tab } from "./tab";
import { loadConfig, matchesKeybinding, applyThemeToCSS, type Config } from "./config";
import { getCurrentWindow } from "@tauri-apps/api/window";

export class TerminalManager {
  private tabs: Map<string, Tab> = new Map();
  private activeTabId: string | null = null;
  private tabCounter = 0;
  private config!: Config;

  async init() {
    this.config = await loadConfig();
    applyThemeToCSS(this.config);
    this.renderShell();
    this.setupResize();
    await this.createTab();
  }

  private renderShell() {
    const app = document.getElementById("app")!;
    if (this.config.sidebar.position === "right") {
      app.classList.add("sidebar-right");
    }
    app.innerHTML = `
      <div id="titlebar" data-tauri-drag-region>
        <div id="traffic-lights">
          <button class="traffic-light close" id="btn-close"></button>
          <button class="traffic-light minimize" id="btn-minimize"></button>
          <button class="traffic-light maximize" id="btn-maximize"></button>
        </div>
      </div>
      <div id="main-area">
        <div id="sidebar">
          <div id="tab-list"></div>
          <div id="sidebar-footer">
            <button id="new-tab-btn">+ New Tab</button>
          </div>
        </div>
        <div id="terminal-container"></div>
      </div>
    `;

    const win = getCurrentWindow();
    document.getElementById("btn-close")!.addEventListener("click", () => win.close());
    document.getElementById("btn-minimize")!.addEventListener("click", () => win.minimize());
    document.getElementById("btn-maximize")!.addEventListener("click", () => win.toggleMaximize());

    document.getElementById("new-tab-btn")!.addEventListener("click", () => {
      this.createTab();
    });
  }

  // Returns true if the key event should be passed through to xterm,
  // false if the manager handled it
  private handleKey = (e: KeyboardEvent): boolean => {
    if (e.type !== "keydown") return true;

    const kb = this.config.keybindings;

    if (matchesKeybinding(e, kb.newTab)) {
      e.preventDefault();
      this.createTab();
      return false;
    }

    if (matchesKeybinding(e, kb.closeTab)) {
      e.preventDefault();
      if (this.activeTabId) this.closeTab(this.activeTabId);
      return false;
    }

    if (matchesKeybinding(e, kb.nextTab)) {
      e.preventDefault();
      this.nextTab();
      return false;
    }

    if (matchesKeybinding(e, kb.prevTab)) {
      e.preventDefault();
      this.prevTab();
      return false;
    }

    if (matchesKeybinding(e, kb.reloadConfig)) {
      e.preventDefault();
      this.reloadConfig();
      return false;
    }

    // Cmd+1-9: switch to tab by index
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key >= "1" && e.key <= "9") {
      e.preventDefault();
      const index = parseInt(e.key) - 1;
      const ids = Array.from(this.tabs.keys());
      if (index < ids.length) {
        this.switchToTab(ids[index]);
      }
      return false;
    }

    return true; // not handled, pass to xterm
  };

  async createTab() {
    this.tabCounter++;
    const id = `tab-${this.tabCounter}`;
    const title = `Terminal ${this.tabCounter}`;
    const tab = new Tab(id, title, this.config, this.handleKey);

    tab.onExit = () => {
      this.closeTab(id);
    };

    this.tabs.set(id, tab);
    this.renderTabList();
    this.switchToTab(id);
    await tab.start();
    tab.focus();
  }

  private switchToTab(id: string) {
    if (this.activeTabId === id) return;

    if (this.activeTabId) {
      const current = this.tabs.get(this.activeTabId);
      if (current) current.hide();
    }

    this.activeTabId = id;
    const tab = this.tabs.get(id);
    if (tab) tab.show();

    this.renderTabList();
  }

  private nextTab() {
    const ids = Array.from(this.tabs.keys());
    if (ids.length <= 1) return;
    const currentIndex = ids.indexOf(this.activeTabId!);
    const nextIndex = (currentIndex + 1) % ids.length;
    this.switchToTab(ids[nextIndex]);
  }

  private prevTab() {
    const ids = Array.from(this.tabs.keys());
    if (ids.length <= 1) return;
    const currentIndex = ids.indexOf(this.activeTabId!);
    const prevIndex = (currentIndex - 1 + ids.length) % ids.length;
    this.switchToTab(ids[prevIndex]);
  }

  private closeTab(id: string) {
    const tab = this.tabs.get(id);
    if (!tab) return;

    tab.dispose();
    this.tabs.delete(id);

    if (this.activeTabId === id) {
      this.activeTabId = null;
      const remaining = Array.from(this.tabs.keys());
      if (remaining.length > 0) {
        this.switchToTab(remaining[remaining.length - 1]);
      } else {
        this.createTab();
        return;
      }
    }

    this.renderTabList();
  }

  private startRenameTab(id: string) {
    const tab = this.tabs.get(id);
    if (!tab) return;

    const entry = document.querySelector(`.tab-entry[data-id="${id}"]`);
    if (!entry) return;

    const titleEl = entry.querySelector(".tab-title") as HTMLElement;
    if (!titleEl) return;

    const input = document.createElement("input");
    input.className = "tab-title-input";
    input.value = tab.title;

    const commit = () => {
      const newTitle = input.value.trim() || tab.title;
      tab.title = newTitle;
      this.renderTabList();
    };

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      }
      if (e.key === "Escape") {
        this.renderTabList();
      }
    });

    titleEl.replaceWith(input);
    input.focus();
    input.select();
  }

  private renderTabList() {
    const list = document.getElementById("tab-list")!;
    list.innerHTML = "";

    for (const [id, tab] of this.tabs) {
      const entry = document.createElement("div");
      entry.className = `tab-entry${id === this.activeTabId ? " active" : ""}`;
      entry.setAttribute("data-id", id);

      const icon = document.createElement("span");
      icon.className = "tab-icon";
      icon.textContent = "\u25b8";

      const title = document.createElement("span");
      title.className = "tab-title";
      title.textContent = tab.title;

      const close = document.createElement("button");
      close.className = "tab-close";
      close.textContent = "\u00d7";
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeTab(id);
      });

      entry.appendChild(icon);
      entry.appendChild(title);
      entry.appendChild(close);
      entry.addEventListener("click", () => this.switchToTab(id));
      entry.addEventListener("dblclick", (e) => {
        e.preventDefault();
        this.startRenameTab(id);
      });
      list.appendChild(entry);
    }
  }

  private async reloadConfig() {
    this.config = await loadConfig();
    applyThemeToCSS(this.config);

    for (const tab of this.tabs.values()) {
      tab.applyConfig(this.config);
    }

    this.renderTabList();
  }

  private setupResize() {
    const observer = new ResizeObserver(() => {
      if (this.activeTabId) {
        const tab = this.tabs.get(this.activeTabId);
        if (tab) tab.fit();
      }
    });
    observer.observe(document.getElementById("terminal-container")!);
  }
}
