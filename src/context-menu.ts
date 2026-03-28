export interface ContextMenuItem {
  label: string;
  action: () => void;
  separator?: boolean;
  disabled?: boolean;
}

let activeMenu: HTMLDivElement | null = null;
let activeItems: HTMLDivElement[] = [];
let focusedIndex = -1;

function closeActiveMenu() {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
    activeItems = [];
    focusedIndex = -1;
  }
}

function focusItem(index: number) {
  if (activeItems.length === 0) return;
  // Clamp
  index = Math.max(0, Math.min(index, activeItems.length - 1));
  // Remove previous highlight
  if (focusedIndex >= 0 && focusedIndex < activeItems.length) {
    activeItems[focusedIndex].classList.remove("focused");
  }
  focusedIndex = index;
  activeItems[focusedIndex].classList.add("focused");
  activeItems[focusedIndex].scrollIntoView({ block: "nearest" });
}

// Close on any click outside
document.addEventListener("click", closeActiveMenu);
document.addEventListener("contextmenu", closeActiveMenu);

// Keyboard navigation for context menus
document.addEventListener("keydown", (e) => {
  if (!activeMenu) return;

  if (e.key === "Escape") {
    closeActiveMenu();
    return;
  }

  // Trap Tab within the menu to prevent focus escaping to background elements
  if (e.key === "Tab") {
    e.preventDefault();
    return;
  }

  if (e.key === "ArrowDown") {
    e.preventDefault();
    focusItem(focusedIndex + 1);
    return;
  }

  if (e.key === "ArrowUp") {
    e.preventDefault();
    focusItem(focusedIndex - 1);
    return;
  }

  if (e.key === "Enter") {
    e.preventDefault();
    if (focusedIndex >= 0 && focusedIndex < activeItems.length) {
      activeItems[focusedIndex].click();
    }
    return;
  }
});

export function showContextMenu(x: number, y: number, items: ContextMenuItem[]) {
  closeActiveMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.setAttribute("role", "menu");

  const actionableItems: HTMLDivElement[] = [];

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement("div");
      sep.className = "context-menu-separator";
      sep.setAttribute("role", "separator");
      menu.appendChild(sep);
    }

    const el = document.createElement("div");
    el.className = "context-menu-item";
    el.setAttribute("role", "menuitem");
    if (item.disabled) {
      el.classList.add("disabled");
      el.setAttribute("aria-disabled", "true");
    }
    el.textContent = item.label;

    if (!item.disabled) {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        closeActiveMenu();
        item.action();
      });
      el.addEventListener("mouseenter", () => {
        const idx = actionableItems.indexOf(el);
        if (idx >= 0) focusItem(idx);
      });
      actionableItems.push(el);
    }

    menu.appendChild(el);
  }

  // Position: ensure menu stays in viewport
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    const edgeOffset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--space-2")) || 4;
    menu.style.left = `${window.innerWidth - rect.width - edgeOffset}px`;
  }
  if (rect.bottom > window.innerHeight) {
    const edgeOffset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--space-2")) || 4;
    menu.style.top = `${window.innerHeight - rect.height - edgeOffset}px`;
  }

  activeMenu = menu;
  activeItems = actionableItems;
  // Auto-focus first item
  if (actionableItems.length > 0) {
    focusItem(0);
  }
}
