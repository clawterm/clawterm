/**
 * OSC sequence handlers for reliable agent state detection.
 *
 * Claude Code emits OSC 9;4 (progress bar) and OSC 9;2 (desktop notification)
 * escape sequences that provide ground-truth working/idle/attention signals.
 * These are far more reliable than regex-matching terminal output text.
 *
 * xterm.js routes OSC sequences by their integer prefix. OSC 9 is a shared
 * namespace — the sub-command (2 for notification, 4 for progress) is parsed
 * from the data string.
 *
 * References:
 *   - OSC 9;4 progress bar: https://rockorager.dev/misc/osc-9-4-progress-bars/
 *   - ConEmu OSC 9 sequences: https://conemu.github.io/en/AnsiEscapeCodes.html
 */

import type { Terminal, IDisposable } from "@xterm/xterm";
import { logger } from "./logger";

// ── Types ──

export interface OscProgressEvent {
  /** Whether the agent is actively working (any non-zero state) */
  working: boolean;
  /** Whether this is an error progress state (state=2) */
  error: boolean;
  /** Raw OSC 9;4 state param: 0=remove, 1=normal, 2=error, 3=indeterminate, 4=warning */
  rawState: number;
  /** Progress value or text after the state param (often empty for indeterminate) */
  value: string;
}

export interface OscNotificationEvent {
  /** Notification text from the agent */
  text: string;
}

// ── Parsers ──

/**
 * Parse an OSC 9;4 progress bar sequence.
 * Data arrives as "4;STATE;VALUE" (the "9;" prefix is consumed by xterm.js routing).
 *
 * STATE values:
 *   0 = remove progress (done/idle)
 *   1 = normal progress (working)
 *   2 = error progress
 *   3 = indeterminate progress (working, unknown completion)
 *   4 = warning progress
 */
export function parseOsc9_4(data: string): OscProgressEvent | null {
  // data is "4;STATE" or "4;STATE;VALUE"
  const parts = data.split(";");
  if (parts.length < 2) return null;

  const rawState = parseInt(parts[1], 10);
  if (isNaN(rawState) || rawState < 0 || rawState > 4) return null;

  const value = parts.length > 2 ? parts.slice(2).join(";") : "";

  return {
    working: rawState !== 0,
    error: rawState === 2,
    rawState,
    value,
  };
}

/**
 * Parse an OSC 9;2 desktop notification sequence.
 * Data arrives as "2;TEXT" (the "9;" prefix is consumed by xterm.js routing).
 */
export function parseOsc9_2(data: string): OscNotificationEvent | null {
  // data is "2;TEXT"
  if (!data.startsWith("2;")) return null;
  const text = data.slice(2);
  if (!text) return null;

  return { text };
}

// ── Registration ──

export interface OscHandlerCallbacks {
  onProgress: (event: OscProgressEvent) => void;
  onNotification: (event: OscNotificationEvent) => void;
}

/**
 * Register OSC 9 sub-handlers on an xterm.js Terminal instance.
 * Returns disposables that the caller should track for cleanup.
 *
 * The handler returns false so xterm.js can also process the sequence
 * (e.g. for its own progress bar rendering if it ever adds one).
 */
export function registerOscHandlers(terminal: Terminal, callbacks: OscHandlerCallbacks): IDisposable[] {
  const disposable = terminal.parser.registerOscHandler(9, (data: string) => {
    if (data.startsWith("4;")) {
      const event = parseOsc9_4(data);
      if (event) {
        logger.debug(`[osc] 9;4 working=${event.working} state=${event.rawState} value="${event.value}"`);
        callbacks.onProgress(event);
      }
    } else if (data.startsWith("2;")) {
      const event = parseOsc9_2(data);
      if (event) {
        logger.debug(`[osc] 9;2 notification="${event.text}"`);
        callbacks.onNotification(event);
      }
    }
    return false;
  });

  return [disposable];
}
