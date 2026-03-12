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
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("server-started");
  });

  it("detects agent-waiting pattern", () => {
    analyzer.feed(toBytes("Do you want to proceed? [Y/n]\n"));
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("agent-waiting");
  });

  it("detects error patterns", () => {
    analyzer.feed(toBytes("FATAL: something went wrong\n"));
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("error");
  });

  it("respects cooldown", () => {
    analyzer.feed(toBytes("Do you want to proceed? [Y/n]\n"));
    expect(events.length).toBe(1);
    // Feed same pattern immediately - should be suppressed by cooldown
    analyzer.feed(toBytes("Do you want to proceed? [Y/n]\n"));
    expect(events.length).toBe(1);
  });

  it("strips ANSI codes before matching", () => {
    analyzer.feed(toBytes("\x1b[32mServer listening on http://localhost:8080\x1b[0m\n"));
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("server-started");
  });

  it("maintains rolling buffer with max size", () => {
    const analyzer = new OutputAnalyzer(100);
    analyzer.onEvent(() => {});
    const longText = "x".repeat(200);
    analyzer.feed(toBytes(longText));
    expect(analyzer.getBuffer().length).toBe(100);
  });

  it("detects patterns across chunk boundaries", () => {
    // Split "localhost:3000" across two chunks
    analyzer.feed(toBytes("Server listening on http://local"));
    expect(events.length).toBe(0);
    analyzer.feed(toBytes("host:3000\n"));
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("server-started");
  });

  it("cleanup on dispose", () => {
    analyzer.dispose();
    expect(analyzer.getBuffer()).toBe("");
  });
});
