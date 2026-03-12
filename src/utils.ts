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
