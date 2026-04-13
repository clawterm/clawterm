import { describe, it, expect } from "vitest";
import { DEFAULT_MATCHERS } from "../src/matchers";

describe("DEFAULT_MATCHERS", () => {
  it("has unique ids", () => {
    const ids = DEFAULT_MATCHERS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all matchers have positive cooldowns", () => {
    for (const m of DEFAULT_MATCHERS) {
      expect(m.cooldownMs).toBeGreaterThan(0);
    }
  });

  describe("server-generic pattern", () => {
    const matcher = DEFAULT_MATCHERS.find((m) => m.id === "server-generic")!;

    it("matches localhost URL", () => {
      const match = "listening on http://localhost:3000".match(matcher.pattern);
      expect(match).not.toBeNull();
      expect(matcher.extract?.(match!)).toEqual({ port: 3000 });
    });

    it("matches 127.0.0.1 URL", () => {
      const match = "running at http://127.0.0.1:8080".match(matcher.pattern);
      expect(match).not.toBeNull();
      expect(matcher.extract?.(match!)).toEqual({ port: 8080 });
    });

    it("matches 0.0.0.0", () => {
      const match = "ready on http://0.0.0.0:4000".match(matcher.pattern);
      expect(match).not.toBeNull();
      expect(matcher.extract?.(match!)).toEqual({ port: 4000 });
    });
  });

  describe("server-framework pattern", () => {
    const matcher = DEFAULT_MATCHERS.find((m) => m.id === "server-framework")!;

    it("matches Vite style output", () => {
      const match = "  Local:   http://localhost:5173".match(matcher.pattern);
      expect(match).not.toBeNull();
      expect(matcher.extract?.(match!)).toEqual({ port: 5173 });
    });
  });

  describe("error patterns", () => {
    const eaddrinuse = DEFAULT_MATCHERS.find((m) => m.id === "error-eaddrinuse")!;
    const fatal = DEFAULT_MATCHERS.find((m) => m.id === "error-fatal")!;
    const npm = DEFAULT_MATCHERS.find((m) => m.id === "error-npm")!;

    it("matches EADDRINUSE", () => {
      expect("Error: EADDRINUSE".match(eaddrinuse.pattern)).not.toBeNull();
    });

    it("matches FATAL", () => {
      expect("FATAL: out of memory".match(fatal.pattern)).not.toBeNull();
    });

    it("matches panic:", () => {
      expect("thread 'main' panic: oh no".match(fatal.pattern)).not.toBeNull();
    });

    it("matches npm ERR!", () => {
      expect("npm ERR! code ERESOLVE".match(npm.pattern)).not.toBeNull();
    });
  });
});
