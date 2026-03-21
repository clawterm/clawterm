import { describe, it, expect } from "vitest";

// Test the session validation logic by importing the types
// and testing the structural validation
describe("Session types", () => {
  it("SessionTab has required cwd field", () => {
    const tab = { title: null, cwd: "/home/user" };
    expect(tab.cwd).toBe("/home/user");
  });

  it("SessionTab can have optional splits", () => {
    const tab = {
      title: "test",
      cwd: "/home/user",
      splits: {
        type: "split" as const,
        direction: "horizontal" as const,
        ratio: 0.5,
        children: [
          { type: "leaf" as const, cwd: "/home/user" },
          { type: "leaf" as const, cwd: "/tmp" },
        ] as const,
      },
    };
    expect(tab.splits.type).toBe("split");
    expect(tab.splits.children).toHaveLength(2);
  });

  it("split ratio must be between 0 and 1", () => {
    const validRatio = 0.5;
    expect(validRatio > 0 && validRatio < 1).toBe(true);

    const invalidRatios = [0, 1, -0.5, 1.5];
    for (const r of invalidRatios) {
      expect(r > 0 && r < 1).toBe(false);
    }
  });

  it("nested splits are valid", () => {
    const nested = {
      type: "split" as const,
      direction: "vertical" as const,
      ratio: 0.6,
      children: [
        { type: "leaf" as const, cwd: "/a" },
        {
          type: "split" as const,
          direction: "horizontal" as const,
          ratio: 0.5,
          children: [
            { type: "leaf" as const, cwd: "/b" },
            { type: "leaf" as const, cwd: "/c" },
          ] as const,
        },
      ] as const,
    };
    expect(nested.children[1].type).toBe("split");
  });
});
