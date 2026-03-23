import { matchesKeybinding, type Config } from "./config";
import { isPrimaryMod } from "./utils";

/**
 * Actions that the keybinding handler can trigger.
 * Each maps to a method on TerminalManager.
 */
export interface KeybindingActions {
  createTab(): void;
  closeActiveTab(): void;
  nextTab(): void;
  prevTab(): void;
  reloadConfig(): void;
  cycleAttentionTabs(): void;
  toggleSearch(): void;
  showQuickSwitch(): void;
  openCommandPalette(): void;
  splitHorizontal(): void;
  splitVertical(): void;
  closeActivePane(): void;
  focusNextPane(): void;
  focusPrevPane(): void;
  resizePane(direction: "left" | "right" | "up" | "down"): void;
  focusPaneByIndex(index: number): void;
  switchToTabIndex(index: number): void;
  writeToActivePty(text: string): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomReset(): void;
  restoreClosedTab(): void;
  openWorktreeDialog(): void;
}

/**
 * Creates a key event handler that dispatches keybindings to actions.
 * Returns true if the event should pass through to xterm, false if handled.
 */
export function createKeyHandler(
  getConfig: () => Config,
  actions: KeybindingActions,
): (e: KeyboardEvent) => boolean {
  return (e: KeyboardEvent): boolean => {
    if (e.type !== "keydown") return true;

    const kb = getConfig().keybindings;

    if (matchesKeybinding(e, kb.newTab)) {
      e.preventDefault();
      actions.createTab();
      return false;
    }

    if (matchesKeybinding(e, kb.closeTab)) {
      e.preventDefault();
      actions.closeActiveTab();
      return false;
    }

    if (matchesKeybinding(e, kb.nextTab)) {
      e.preventDefault();
      actions.nextTab();
      return false;
    }

    if (matchesKeybinding(e, kb.prevTab)) {
      e.preventDefault();
      actions.prevTab();
      return false;
    }

    if (matchesKeybinding(e, kb.reloadConfig)) {
      e.preventDefault();
      actions.reloadConfig();
      return false;
    }

    if (matchesKeybinding(e, kb.cycleAttention)) {
      e.preventDefault();
      actions.cycleAttentionTabs();
      return false;
    }

    if (matchesKeybinding(e, kb.search)) {
      e.preventDefault();
      actions.toggleSearch();
      return false;
    }

    if (matchesKeybinding(e, kb.quickSwitch)) {
      e.preventDefault();
      actions.showQuickSwitch();
      return false;
    }

    if (matchesKeybinding(e, kb.commandPalette)) {
      e.preventDefault();
      actions.openCommandPalette();
      return false;
    }

    if (matchesKeybinding(e, kb.splitHorizontal)) {
      e.preventDefault();
      actions.splitHorizontal();
      return false;
    }

    if (matchesKeybinding(e, kb.splitVertical)) {
      e.preventDefault();
      actions.splitVertical();
      return false;
    }

    if (matchesKeybinding(e, kb.closePane)) {
      e.preventDefault();
      actions.closeActivePane();
      return false;
    }

    if (matchesKeybinding(e, kb.focusNextPane)) {
      e.preventDefault();
      actions.focusNextPane();
      return false;
    }

    if (matchesKeybinding(e, kb.focusPrevPane)) {
      e.preventDefault();
      actions.focusPrevPane();
      return false;
    }

    if (matchesKeybinding(e, kb.zoomIn)) {
      e.preventDefault();
      actions.zoomIn();
      return false;
    }

    if (matchesKeybinding(e, kb.zoomOut)) {
      e.preventDefault();
      actions.zoomOut();
      return false;
    }

    if (matchesKeybinding(e, kb.zoomReset)) {
      e.preventDefault();
      actions.zoomReset();
      return false;
    }

    if (matchesKeybinding(e, kb.restoreTab)) {
      e.preventDefault();
      actions.restoreClosedTab();
      return false;
    }

    if (kb.newWorktreeTab && matchesKeybinding(e, kb.newWorktreeTab)) {
      e.preventDefault();
      actions.openWorktreeDialog();
      return false;
    }

    // Mod+Shift+Arrow: resize focused pane
    if (isPrimaryMod(e) && e.shiftKey && !e.altKey) {
      const resizeMap: Record<string, "left" | "right" | "up" | "down"> = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
        ArrowDown: "down",
      };
      const dir = resizeMap[e.key];
      if (dir) {
        e.preventDefault();
        actions.resizePane(dir);
        return false;
      }
    }

    // Mod+Alt+1-9: jump to pane by number
    if (isPrimaryMod(e) && e.altKey && !e.shiftKey && e.key >= "1" && e.key <= "9") {
      e.preventDefault();
      actions.focusPaneByIndex(parseInt(e.key) - 1);
      return false;
    }

    // Mod+1-9: switch to tab by index
    if (isPrimaryMod(e) && !e.shiftKey && !e.altKey && e.key >= "1" && e.key <= "9") {
      e.preventDefault();
      actions.switchToTabIndex(parseInt(e.key) - 1);
      return false;
    }

    // Quick commands — user-defined keybindings that type into the terminal
    const quickCommands = getConfig().quickCommands;
    if (quickCommands) {
      for (const [binding, text] of Object.entries(quickCommands)) {
        if (matchesKeybinding(e, binding)) {
          e.preventDefault();
          actions.writeToActivePty(text);
          return false;
        }
      }
    }

    return true; // not handled, pass to xterm
  };
}
