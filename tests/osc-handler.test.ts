import { describe, it, expect } from "vitest";
import { parseOsc9_4, parseOsc9_2 } from "../src/osc-handler";

describe("parseOsc9_4", () => {
  it("parses indeterminate progress (working)", () => {
    const result = parseOsc9_4("4;3;");
    expect(result).toEqual({ working: true, error: false, rawState: 3, value: "" });
  });

  it("parses normal progress (working)", () => {
    const result = parseOsc9_4("4;1;50");
    expect(result).toEqual({ working: true, error: false, rawState: 1, value: "50" });
  });

  it("parses error progress (working + error)", () => {
    const result = parseOsc9_4("4;2;");
    expect(result).toEqual({ working: true, error: true, rawState: 2, value: "" });
  });

  it("parses warning progress (still working)", () => {
    const result = parseOsc9_4("4;4;");
    expect(result).toEqual({ working: true, error: false, rawState: 4, value: "" });
  });

  it("parses progress removal (done)", () => {
    const result = parseOsc9_4("4;0;");
    expect(result).toEqual({ working: false, error: false, rawState: 0, value: "" });
  });

  it("preserves value with semicolons", () => {
    const result = parseOsc9_4("4;1;some;complex;value");
    expect(result).toEqual({ working: true, error: false, rawState: 1, value: "some;complex;value" });
  });

  it("returns null for malformed data", () => {
    expect(parseOsc9_4("4")).toBeNull();
    expect(parseOsc9_4("")).toBeNull();
    expect(parseOsc9_4("4;abc")).toBeNull();
    expect(parseOsc9_4("4;-1")).toBeNull();
    expect(parseOsc9_4("4;5")).toBeNull();
  });
});

describe("parseOsc9_2", () => {
  it("parses notification text", () => {
    const result = parseOsc9_2("2;Task completed");
    expect(result).toEqual({ text: "Task completed" });
  });

  it("handles notification with semicolons", () => {
    const result = parseOsc9_2("2;Agent waiting; please approve");
    expect(result).toEqual({ text: "Agent waiting; please approve" });
  });

  it("returns null for empty notification", () => {
    expect(parseOsc9_2("2;")).toBeNull();
  });

  it("returns null for non-notification data", () => {
    expect(parseOsc9_2("4;1;50")).toBeNull();
    expect(parseOsc9_2("")).toBeNull();
  });
});
