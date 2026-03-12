import { describe, it, expect } from "vitest";
import { matchesKeybinding } from "../src/config";

function makeKeyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: "",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("matchesKeybinding", () => {
  it("matches cmd+t with metaKey", () => {
    expect(matchesKeybinding(makeKeyEvent({ key: "t", metaKey: true }), "cmd+t")).toBe(true);
  });

  it("matches ctrl+t with ctrlKey", () => {
    expect(matchesKeybinding(makeKeyEvent({ key: "t", ctrlKey: true }), "ctrl+t")).toBe(true);
  });

  it("ctrl+t does NOT match cmd+t (distinct modifiers)", () => {
    expect(matchesKeybinding(makeKeyEvent({ key: "t", ctrlKey: true }), "cmd+t")).toBe(false);
  });

  it("cmd+t does NOT match ctrl+t", () => {
    expect(matchesKeybinding(makeKeyEvent({ key: "t", metaKey: true }), "ctrl+t")).toBe(false);
  });

  it("does not match without modifier", () => {
    expect(matchesKeybinding(makeKeyEvent({ key: "t" }), "cmd+t")).toBe(false);
  });

  it("matches cmd+shift+r", () => {
    expect(
      matchesKeybinding(makeKeyEvent({ key: "r", metaKey: true, shiftKey: true }), "cmd+shift+r"),
    ).toBe(true);
  });

  it("matches ctrl+shift+r", () => {
    expect(
      matchesKeybinding(makeKeyEvent({ key: "r", ctrlKey: true, shiftKey: true }), "ctrl+shift+r"),
    ).toBe(true);
  });

  it("does not match cmd+r for cmd+shift+r", () => {
    expect(matchesKeybinding(makeKeyEvent({ key: "r", metaKey: true }), "cmd+shift+r")).toBe(false);
  });

  it("matches alt+key", () => {
    expect(matchesKeybinding(makeKeyEvent({ key: "a", altKey: true }), "alt+a")).toBe(true);
  });

  it("matches opt+key as alias for alt", () => {
    expect(matchesKeybinding(makeKeyEvent({ key: "a", altKey: true }), "opt+a")).toBe(true);
  });

  it("rejects extra modifiers", () => {
    expect(matchesKeybinding(makeKeyEvent({ key: "t", metaKey: true, shiftKey: true }), "cmd+t")).toBe(false);
  });

  it("is case-insensitive for keys", () => {
    expect(matchesKeybinding(makeKeyEvent({ key: "T", metaKey: true }), "cmd+t")).toBe(true);
  });

  it("matches bracket keys", () => {
    expect(
      matchesKeybinding(makeKeyEvent({ key: "]", metaKey: true, shiftKey: true }), "cmd+shift+]"),
    ).toBe(true);
  });
});
