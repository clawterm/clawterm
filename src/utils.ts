import { invoke } from "@tauri-apps/api/core";

/**
 * Invoke a Tauri command with a timeout. Rejects if the command
 * doesn't resolve within `ms` milliseconds.
 */
export function invokeWithTimeout<T>(cmd: string, args?: Record<string, unknown>, ms = 5000): Promise<T> {
  return Promise.race([
    invoke<T>(cmd, args),
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`IPC timeout: ${cmd} exceeded ${ms}ms`)), ms),
    ),
  ]);
}

/** The primary modifier key label for display */
export const modLabel = "\u2318";

/** The primary modifier key name for keybinding strings */
export const modKey = "cmd";

/**
 * Trap Tab focus within a container element.
 * Returns a cleanup function to remove the listener.
 */
export function trapFocus(container: HTMLElement): () => void {
  const handler = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const focusable = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  container.addEventListener("keydown", handler);
  return () => container.removeEventListener("keydown", handler);
}
