import { describe, it, expect, vi, beforeEach } from "vitest";
import { OutputAnalyzer } from "../src/output-analyzer";

function toBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe("OutputAnalyzer", () => {
  let analyzer: OutputAnalyzer;
  let events: Array<{ type: string; detail: string }>;

  beforeEach(() => {
    analyzer = new OutputAnalyzer(4096);
    events = [];
    analyzer.onEvent((e) => events.push({ type: e.type, detail: e.detail }));
  });

  it("detects server-started pattern", () => {
    analyzer.feed(toBytes("Server listening on http://localhost:3000\n"));
    analyzer.flush();
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("server-started");
  });

  it("detects agent-waiting pattern", () => {
    analyzer.feed(toBytes("Do you want to proceed? [Y/n]\n"));
    analyzer.flush();
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("agent-waiting");
  });

  it("detects error patterns", () => {
    analyzer.feed(toBytes("FATAL: something went wrong\n"));
    analyzer.flush();
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("error");
  });

  it("respects cooldown", () => {
    analyzer.feed(toBytes("Do you want to proceed? [Y/n]\n"));
    analyzer.flush();
    expect(events.length).toBe(1);
    // Feed same pattern immediately - should be suppressed by cooldown
    analyzer.feed(toBytes("Do you want to proceed? [Y/n]\n"));
    analyzer.flush();
    expect(events.length).toBe(1);
  });

  it("strips ANSI codes before matching", () => {
    analyzer.feed(toBytes("\x1b[32mServer listening on http://localhost:8080\x1b[0m\n"));
    analyzer.flush();
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("server-started");
  });

  it("maintains rolling buffer with max size", () => {
    const analyzer = new OutputAnalyzer(100);
    analyzer.onEvent(() => {});
    const longText = "x".repeat(200);
    analyzer.feed(toBytes(longText));
    analyzer.flush(); // Buffer is updated during debounced runMatchers()
    expect(analyzer.getBuffer().length).toBe(100);
  });

  it("detects patterns across chunk boundaries", () => {
    // Split "localhost:3000" across two chunks
    analyzer.feed(toBytes("Server listening on http://local"));
    analyzer.flush();
    expect(events.length).toBe(0);
    analyzer.feed(toBytes("host:3000\n"));
    analyzer.flush();
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("server-started");
  });

  it("cleanup on dispose", () => {
    analyzer.dispose();
    expect(analyzer.getBuffer()).toBe("");
  });

  it("suppresses oscSuperseded matchers when oscActive is true", () => {
    // The default analyzer includes claude-spinner (oscSuperseded: true)
    // Feed spinner chars — should fire normally
    analyzer.feed(toBytes("⠋ Working on something\n"));
    analyzer.flush();
    const before = events.length;
    expect(before).toBeGreaterThan(0);

    // Enable oscActive — superseded matchers should be skipped
    analyzer.oscActive = true;
    // Reset cooldowns by creating a fresh time window
    events.length = 0;
    // Wait for cooldown to expire, then feed again
    // (can't wait in test, but we can create a new analyzer)
    const analyzer2 = new OutputAnalyzer(4096);
    analyzer2.oscActive = true;
    const events2: Array<{ type: string; detail: string }> = [];
    analyzer2.onEvent((e) => events2.push({ type: e.type, detail: e.detail }));

    // Feed spinner — should NOT fire because oscActive suppresses claude-spinner
    analyzer2.feed(toBytes("⠋ Working on something\n"));
    analyzer2.flush();
    const spinnerEvents = events2.filter((e) => e.type === "agent-working");
    expect(spinnerEvents.length).toBe(0);

    // Non-superseded matchers should still fire
    analyzer2.feed(toBytes("Server listening on http://localhost:3000\n"));
    analyzer2.flush();
    const serverEvents = events2.filter((e) => e.type === "server-started");
    expect(serverEvents.length).toBe(1);
  });
});
