import { type OutputEvent, type OutputMatcher, DEFAULT_MATCHERS } from "./matchers";

// eslint-disable-next-line no-control-regex
const ANSI_RE =
  /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[\x20-\x2f][\x40-\x7e]|\x08/g;

export class OutputAnalyzer {
  private buffer = "";
  private readonly bufferSize: number;
  private matchers: OutputMatcher[];
  private lastFired: Map<string, number> = new Map();
  private overlapWindow = "";
  private listener: ((event: OutputEvent) => void) | null = null;

  constructor(bufferSize = 4096, customMatchers?: OutputMatcher[]) {
    this.bufferSize = bufferSize;
    this.matchers = customMatchers ?? DEFAULT_MATCHERS;
  }

  onEvent(fn: (event: OutputEvent) => void) {
    this.listener = fn;
  }

  feed(data: Uint8Array) {
    const text = new TextDecoder().decode(data);
    const clean = text.replace(ANSI_RE, "");

    // Append to rolling buffer, truncate from front
    this.buffer += clean;
    if (this.buffer.length > this.bufferSize) {
      this.buffer = this.buffer.slice(this.buffer.length - this.bufferSize);
    }

    // Match against chunk + overlap from previous chunk (catches split patterns)
    const matchText = this.overlapWindow + clean;

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
          ...(matcher.extract?.(match) ?? {}),
        };
        this.listener?.(event);
      }
    }

    // Keep last 256 chars as overlap for next chunk
    this.overlapWindow = clean.length >= 256 ? clean.slice(-256) : (this.overlapWindow + clean).slice(-256);
  }

  getBuffer(): string {
    return this.buffer;
  }

  dispose() {
    this.listener = null;
    this.buffer = "";
    this.overlapWindow = "";
    this.lastFired.clear();
  }
}
