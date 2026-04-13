export interface OutputEvent {
  type: "server-started" | "server-crashed" | "error";
  detail: string;
  timestamp: number;
  port?: number;
  /** Terminal line number when this event was detected */
  line?: number;
}

export interface OutputMatcher {
  id: string;
  pattern: RegExp;
  type: OutputEvent["type"];
  extract?: (match: RegExpMatchArray) => Partial<OutputEvent>;
  cooldownMs: number;
}

function extractValidPort(m: RegExpMatchArray, group = 1): Partial<OutputEvent> {
  const port = parseInt(m[group], 10);
  if (port < 1 || port > 65535) return {};
  return { port };
}

export const DEFAULT_MATCHERS: OutputMatcher[] = [
  // Server started patterns (with port capture)
  {
    id: "server-generic",
    pattern:
      /(?:listening on|started on|running at|ready on|available at).{0,100}?(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i,
    type: "server-started",
    extract: (m) => extractValidPort(m),
    cooldownMs: 5000,
  },
  {
    id: "server-framework",
    pattern: /Local:\s+https?:\/\/localhost:(\d+)/i,
    type: "server-started",
    extract: (m) => extractValidPort(m),
    cooldownMs: 5000,
  },
  // Error patterns
  {
    id: "error-eaddrinuse",
    pattern: /EADDRINUSE/,
    type: "error",
    extract: () => ({ detail: "Port already in use" }),
    cooldownMs: 5000,
  },
  {
    id: "error-fatal",
    pattern: /\bFATAL\b|panic:|Segmentation fault/,
    type: "error",
    cooldownMs: 5000,
  },
  {
    id: "error-npm",
    pattern: /npm ERR!|build failed/i,
    type: "error",
    cooldownMs: 5000,
  },
];
