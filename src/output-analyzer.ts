import { type OutputEvent, type OutputMatcher, DEFAULT_MATCHERS } from "./matchers";

// prettier-ignore
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[\x20-\x2f][\x40-\x7e]|\x08/g; // eslint-disable-line no-control-regex

/** Reuse a single TextDecoder to avoid per-chunk allocation */
const decoder = new TextDecoder();

/** Debounce interval for regex matching (ms) */
const MATCH_DEBOUNCE_MS = 100;

/** Max number of events to retain in history */
const MAX_EVENT_HISTORY = 200;

export class OutputAnalyzer {
  private buffer = "";
  private readonly bufferSize: number;
  private matchers: OutputMatcher[];
  private lastFired: Map<string, number> = new Map();
  private overlapWindow = "";
  private listener: ((event: OutputEvent) => void) | null = null;

  /** Pending text accumulated between debounced match runs */
  private pendingText = "";
  private matchTimer: ReturnType<typeof setTimeout> | null = null;

  /** Stored event history with positions for timeline rendering */
  readonly eventHistory: OutputEvent[] = [];

  /** Current terminal line (set externally by Pane) */
  currentLine = 0;
  /** Total scrollback lines (set externally by Pane) */
  totalLines = 0;

  constructor(bufferSize = 4096, customMatchers?: OutputMatcher[]) {
    this.bufferSize = bufferSize;
    this.matchers = customMatchers ?? DEFAULT_MATCHERS;
  }

  onEvent(fn: (event: OutputEvent) => void) {
    this.listener = fn;
  }

  feed(data: Uint8Array) {
    const text = decoder.decode(data, { stream: true });
    this.pendingText += text;
    if (!this.matchTimer) {
      this.matchTimer = setTimeout(() => this.runMatchers(), MATCH_DEBOUNCE_MS);
    }
  }

  private runMatchers() {
    this.matchTimer = null;
    const clean = this.pendingText.replace(ANSI_RE, "");
    this.pendingText = "";

    this.buffer += clean;
    if (this.buffer.length > this.bufferSize) {
      this.buffer = this.buffer.slice(this.buffer.length - this.bufferSize);
    }

    const rawMatchText = this.overlapWindow + clean;
    const matchText = rawMatchText.length > 2048 ? rawMatchText.slice(-2048) : rawMatchText;

    const now = Date.now();
    for (const matcher of this.matchers) {
      const lastTime = this.lastFired.get(matcher.id) ?? 0;
      if (now - lastTime < matcher.cooldownMs) continue;

      const match = matchText.match(matcher.pattern);
      if (match) {
        this.lastFired.set(matcher.id, now);

        const event: OutputEvent = {
          type: matcher.type,
          detail: match[0],
          timestamp: now,
          line: this.currentLine,
          ...(matcher.extract?.(match) ?? {}),
        };

        this.eventHistory.push(event);
        if (this.eventHistory.length > MAX_EVENT_HISTORY) {
          this.eventHistory.shift();
        }

        this.listener?.(event);
      }
    }

    this.overlapWindow = clean.length >= 256 ? clean.slice(-256) : (this.overlapWindow + clean).slice(-256);
  }

  /** Force-run any pending matchers immediately (useful for tests). */
  flush() {
    if (this.matchTimer) {
      clearTimeout(this.matchTimer);
      this.matchTimer = null;
    }
    if (this.pendingText) {
      this.runMatchers();
    }
  }

  getBuffer(): string {
    return this.buffer;
  }

  dispose() {
    if (this.matchTimer) {
      clearTimeout(this.matchTimer);
      this.matchTimer = null;
    }
    this.listener = null;
    this.buffer = "";
    this.pendingText = "";
    this.overlapWindow = "";
    this.lastFired.clear();
    this.eventHistory.length = 0;
  }
}
