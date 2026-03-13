export interface OutputEvent {
  type: "agent-waiting" | "server-started" | "server-crashed" | "error" | "agent-completed";
  detail: string;
  timestamp: number;
  port?: number;
  agentName?: string;
}

export interface OutputMatcher {
  id: string;
  pattern: RegExp;
  type: OutputEvent["type"];
  extract?: (match: RegExpMatchArray) => Partial<OutputEvent>;
  cooldownMs: number;
}

// Map process names to agent identifiers
export const AGENT_PROCESS_MAP: Record<string, string> = {
  claude: "claude",
  "claude-code": "claude",
  aider: "aider",
  copilot: "copilot",
  cursor: "cursor",
};

function extractValidPort(m: RegExpMatchArray, group = 1): Partial<OutputEvent> {
  const port = parseInt(m[group], 10);
  if (port < 1 || port > 65535) return {};
  return { port };
}

export const DEFAULT_MATCHERS: OutputMatcher[] = [
  // Agent waiting patterns
  {
    id: "claude-approve",
    pattern: /Do you want to proceed|approve|may I|\[Y\/n\]|Y\/n\b/i,
    type: "agent-waiting",
    extract: () => ({ agentName: "claude" }),
    cooldownMs: 3000,
  },
  {
    id: "generic-confirm",
    pattern: /Are you sure|Continue\?|\[yes\/no\]|Press enter to continue/i,
    type: "agent-waiting",
    cooldownMs: 3000,
  },
  {
    id: "aider-edit",
    pattern: /Edit .{0,200}?\(Y\)es/i,
    type: "agent-waiting",
    extract: () => ({ agentName: "aider" }),
    cooldownMs: 3000,
  },

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
  {
    id: "server-port-alt",
    pattern: /(?:port|PORT)\s+(\d{3,5})/,
    type: "server-started",
    extract: (m) => extractValidPort(m),
    cooldownMs: 10000,
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

  // Agent completed
  {
    id: "claude-completed",
    pattern: /Task completed|I've (?:completed|finished|made the changes)/i,
    type: "agent-completed",
    extract: () => ({ agentName: "claude" }),
    cooldownMs: 5000,
  },
];
