type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let minLevel: LogLevel = "debug";

/** In-memory ring buffer of recent log entries for export/debugging. */
const LOG_BUFFER_MAX = 2000;
const logBuffer: string[] = [];

function timestamp(): string {
  return new Date().toISOString();
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

function appendToBuffer(entry: string): void {
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_MAX) {
    logBuffer.splice(0, logBuffer.length - LOG_BUFFER_MAX);
  }
}

export const logger = {
  setLevel(level: LogLevel) {
    minLevel = level;
  },

  debug(msg: string, ...args: unknown[]) {
    const entry = `[${timestamp()}] DEBUG ${msg}`;
    appendToBuffer(entry);
    if (shouldLog("debug")) console.debug(entry, ...args);
  },

  info(msg: string, ...args: unknown[]) {
    const entry = `[${timestamp()}] INFO ${msg}`;
    appendToBuffer(entry);
    if (shouldLog("info")) console.info(entry, ...args);
  },

  warn(msg: string, ...args: unknown[]) {
    const entry = `[${timestamp()}] WARN ${msg}`;
    appendToBuffer(entry);
    if (shouldLog("warn")) console.warn(entry, ...args);
  },

  error(msg: string, ...args: unknown[]) {
    const entry = `[${timestamp()}] ERROR ${msg}`;
    appendToBuffer(entry);
    if (shouldLog("error")) console.error(entry, ...args);
  },

  /** Get all buffered log entries as a single string for export. */
  getBufferedLogs(): string {
    return logBuffer.join("\n");
  },

  /** Get the number of buffered entries. */
  getBufferSize(): number {
    return logBuffer.length;
  },
};
