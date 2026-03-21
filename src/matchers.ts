export interface OutputEvent {
  type: "agent-waiting" | "agent-working" | "server-started" | "server-crashed" | "error" | "agent-completed";
  detail: string;
  timestamp: number;
  port?: number;
  agentName?: string;
  /** Terminal line number when this event was detected */
  line?: number;
  /** Context lines captured around the event (for agent prompts) */
  contextLines?: string[];
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
  codex: "codex",
  gemini: "gemini",
};

// Agent-specific accent colors for sidebar indicators
export const AGENT_COLORS: Record<string, string> = {
  claude: "#ff9f0a",
  aider: "#30d158",
  copilot: "#bf5af2",
  cursor: "#0a84ff",
  codex: "#10a37f",
  gemini: "#4285f4",
};

function extractValidPort(m: RegExpMatchArray, group = 1): Partial<OutputEvent> {
  const port = parseInt(m[group], 10);
  if (port < 1 || port > 65535) return {};
  return { port };
}

export const DEFAULT_MATCHERS: OutputMatcher[] = [
  // Agent waiting patterns — must be specific to avoid false positives when
  // agents mention these words in their own output (e.g., "I'll approve the
  // changes" or "may I suggest...").  Match only actual interactive prompts.
  {
    id: "claude-approve",
    pattern: /(?:Do you want to proceed|Approve\?|Allow\?)\s*[[(][YyNn]/i,
    type: "agent-waiting",
    extract: () => ({ agentName: "claude" }),
    cooldownMs: 5000,
  },
  {
    id: "claude-yn-prompt",
    pattern: /\[Y\/n\]\s*$/m,
    type: "agent-waiting",
    extract: () => ({ agentName: "claude" }),
    cooldownMs: 5000,
  },
  {
    id: "generic-confirm",
    pattern: /(?:Are you sure|Continue)\?\s*[[(][YyNn]|Press enter to continue/i,
    type: "agent-waiting",
    cooldownMs: 5000,
  },
  {
    id: "aider-edit",
    pattern: /Edit .{0,200}?\(Y\)es/i,
    type: "agent-waiting",
    extract: () => ({ agentName: "aider" }),
    cooldownMs: 5000,
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

  // Agent working patterns — these emit "agent-working" events that reset the
  // idle timer, preventing false "waiting" transitions during tool execution.
  {
    id: "claude-tool-use",
    // Anchored to start-of-line (after optional whitespace/spinner) to avoid
    // matching generic log lines like "Reading config file..." from any program.
    pattern: /^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]?\s*(?:Running|Reading|Writing|Editing|Searching|Creating)\s(.{1,80})/m,
    type: "agent-working",
    extract: (m) => ({
      agentName: "claude",
      detail: m[0]
        .trim()
        .replace(/\.{3,}$/, "")
        .replace(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*/, ""),
    }),
    cooldownMs: 3000,
  },
  {
    id: "claude-spinner",
    pattern: /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s/,
    type: "agent-working",
    extract: () => ({ agentName: "claude" }),
    cooldownMs: 2000,
  },
  {
    id: "aider-working",
    pattern: /Thinking\.\.\.|Applying edits|Working\.\.\./i,
    type: "agent-working",
    extract: () => ({ agentName: "aider" }),
    cooldownMs: 3000,
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
