import { describe, it, expect } from "vitest";
import { computeAdaptiveTimeout, hasWorkingPatterns, IDLE_DEFAULTS } from "../src/tab-polling";

describe("computeAdaptiveTimeout", () => {
  it("returns default when fewer than minGaps gaps", () => {
    expect(computeAdaptiveTimeout([])).toBe(IDLE_DEFAULTS.DEFAULT_MS);
    expect(computeAdaptiveTimeout([100, 200])).toBe(IDLE_DEFAULTS.DEFAULT_MS);
    expect(computeAdaptiveTimeout([100, 200, 300, 400])).toBe(IDLE_DEFAULTS.DEFAULT_MS);
  });

  it("computes 2x p95 for normal output cadence", () => {
    // 10 gaps of 1000ms each — p95 is 1000, so result should be 2000
    // But min is 15000, so it clamps to 15000
    const gaps = Array(10).fill(1000);
    expect(computeAdaptiveTimeout(gaps)).toBe(IDLE_DEFAULTS.MIN_MS);
  });

  it("respects minimum threshold", () => {
    const gaps = Array(10).fill(100);
    expect(computeAdaptiveTimeout(gaps)).toBe(IDLE_DEFAULTS.MIN_MS);
  });

  it("respects maximum threshold", () => {
    // Gaps of 50s each — p95 × 2 = 100s, should clamp to 60s max
    const gaps = Array(10).fill(50_000);
    expect(computeAdaptiveTimeout(gaps)).toBe(IDLE_DEFAULTS.MAX_MS);
  });

  it("uses 95th percentile, not max", () => {
    // 19 gaps of 5000ms + 1 outlier of 100000ms
    // p95 index = floor(20 * 0.95) = 19, which is the outlier
    // But with 20 gaps where 19 are 5000, sorted[19] = 100000
    // Actually let's use a clearer example:
    // 95 gaps of 8000ms + 5 gaps of 50000ms = 100 total
    // p95 index = floor(100 * 0.95) = 95, sorted[95] = 50000
    // Result = min(50000 * 2, 60000) = 60000
    const gaps = [...Array(95).fill(8000), ...Array(5).fill(50_000)];
    expect(computeAdaptiveTimeout(gaps)).toBe(IDLE_DEFAULTS.MAX_MS);
  });

  it("scales with output cadence for mid-range gaps", () => {
    // 20 gaps of 10000ms — p95 = 10000, result = 20000
    const gaps = Array(20).fill(10_000);
    expect(computeAdaptiveTimeout(gaps)).toBe(20_000);
  });

  it("accepts custom options", () => {
    const gaps = Array(2).fill(1000);
    // 2 gaps, minGaps=3 → returns custom default
    expect(computeAdaptiveTimeout(gaps, { minGaps: 3, defaultMs: 5000 })).toBe(5000);
    // 3 gaps of 1000ms, minGaps=2, minMs=500 → p95=1000, result=max(500, 2000)=2000
    const gaps3 = Array(3).fill(1000);
    expect(computeAdaptiveTimeout(gaps3, { minGaps: 2, minMs: 500 })).toBe(2000);
  });
});

describe("hasWorkingPatterns", () => {
  it("returns false for empty lines", () => {
    expect(hasWorkingPatterns([])).toBe(false);
  });

  it("detects braille spinners", () => {
    expect(hasWorkingPatterns(["⠋ Thinking..."])).toBe(true);
    expect(hasWorkingPatterns(["⠸ Loading"])).toBe(true);
  });

  it("detects tool use keywords", () => {
    expect(hasWorkingPatterns(["Reading src/main.ts"])).toBe(true);
    expect(hasWorkingPatterns(["Writing output.json"])).toBe(true);
    expect(hasWorkingPatterns(["Compiling project"])).toBe(true);
    expect(hasWorkingPatterns(["Building artifacts"])).toBe(true);
    expect(hasWorkingPatterns(["Testing components"])).toBe(true);
  });

  it("does not match generic words removed to reduce false positives", () => {
    expect(hasWorkingPatterns(["Processing..."])).toBe(false);
  });

  it("returns false for plain shell output", () => {
    expect(hasWorkingPatterns(["$ ls", "file1.txt", "file2.txt"])).toBe(false);
  });

  it("returns false for prompt lines", () => {
    expect(hasWorkingPatterns(["user@host:~$"])).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(hasWorkingPatterns(["BUILDING project"])).toBe(true);
    expect(hasWorkingPatterns(["thinking about it"])).toBe(true);
  });
});
