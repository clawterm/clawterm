type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let minLevel: LogLevel = "debug";

function timestamp(): string {
  return new Date().toISOString();
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

export const logger = {
  setLevel(level: LogLevel) {
    minLevel = level;
  },

  debug(msg: string, ...args: unknown[]) {
    if (shouldLog("debug")) console.debug(`[${timestamp()}] DEBUG ${msg}`, ...args);
  },

  info(msg: string, ...args: unknown[]) {
    if (shouldLog("info")) console.info(`[${timestamp()}] INFO ${msg}`, ...args);
  },

  warn(msg: string, ...args: unknown[]) {
    if (shouldLog("warn")) console.warn(`[${timestamp()}] WARN ${msg}`, ...args);
  },

  error(msg: string, ...args: unknown[]) {
    if (shouldLog("error")) console.error(`[${timestamp()}] ERROR ${msg}`, ...args);
  },
};
