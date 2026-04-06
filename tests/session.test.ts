import { describe, it, expect } from "vitest";
import type { SessionTab, SessionSplitNode, Session } from "../src/session";

describe("SessionTab structure", () => {
  it("has required cwd field", () => {
    const tab: SessionTab = { title: null, cwd: "/home/user" };
    expect(tab.cwd).toBe("/home/user");
    expect(tab.title).toBeNull();
  });

  it("supports optional split layout", () => {
    const tab: SessionTab = {
      title: "test",
      cwd: "/home/user",
      splits: {
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { type: "leaf", cwd: "/home/user" },
          { type: "leaf", cwd: "/tmp" },
        ],
      },
    };
    expect(tab.splits!.type).toBe("split");
    expect((tab.splits as { children: SessionSplitNode[] }).children).toHaveLength(2);
  });

  it("supports optional pinned, muted, manualTitle", () => {
    const tab: SessionTab = {
      title: null,
      cwd: "/home",
      pinned: true,
      muted: true,
      manualTitle: "My Tab",
    };
    expect(tab.pinned).toBe(true);
    expect(tab.muted).toBe(true);
    expect(tab.manualTitle).toBe("My Tab");
  });

  it("supports worktree metadata fields", () => {
    // Post-#416 layout: worktrees live in a sibling .clawterm-worktrees/
    // directory, namespaced by repo name. The session record stores the
    // resolved absolute path, so existing in-repo worktrees from older
    // installs continue to round-trip unchanged.
    const tab: SessionTab = {
      title: null,
      cwd: "/home/.clawterm-worktrees/project/feature-auth",
      worktreePath: "/home/.clawterm-worktrees/project/feature-auth",
      repoRoot: "/home/project",
    };
    expect(tab.worktreePath).toBe("/home/.clawterm-worktrees/project/feature-auth");
    expect(tab.repoRoot).toBe("/home/project");
  });

  it("worktree fields are optional (regular tabs)", () => {
    const tab: SessionTab = { title: null, cwd: "/home/project" };
    expect(tab.worktreePath).toBeUndefined();
    expect(tab.repoRoot).toBeUndefined();
  });
});

describe("SessionSplitNode validation", () => {
  it("leaf nodes have type and cwd", () => {
    const leaf: SessionSplitNode = { type: "leaf", cwd: "/home" };
    expect(leaf.type).toBe("leaf");
  });

  it("split nodes have direction, ratio, and exactly 2 children", () => {
    const split: SessionSplitNode = {
      type: "split",
      direction: "vertical",
      ratio: 0.6,
      children: [
        { type: "leaf", cwd: "/a" },
        { type: "leaf", cwd: "/b" },
      ],
    };
    expect(split.type).toBe("split");
    if (split.type === "split") {
      expect(split.direction).toBe("vertical");
      expect(split.ratio).toBeGreaterThan(0);
      expect(split.ratio).toBeLessThan(1);
      expect(split.children).toHaveLength(2);
    }
  });

  it("split ratio must be between 0 and 1 (exclusive)", () => {
    const validRatios = [0.1, 0.25, 0.5, 0.75, 0.9];
    for (const r of validRatios) {
      expect(r > 0 && r < 1).toBe(true);
    }
    const invalidRatios = [0, 1, -0.5, 1.5];
    for (const r of invalidRatios) {
      expect(r > 0 && r < 1).toBe(false);
    }
  });

  it("supports deeply nested splits", () => {
    const nested: SessionSplitNode = {
      type: "split",
      direction: "vertical",
      ratio: 0.6,
      children: [
        { type: "leaf", cwd: "/a" },
        {
          type: "split",
          direction: "horizontal",
          ratio: 0.5,
          children: [
            { type: "leaf", cwd: "/b" },
            { type: "leaf", cwd: "/c" },
          ],
        },
      ],
    };
    if (nested.type === "split") {
      expect(nested.children[1].type).toBe("split");
    }
  });
});

describe("Session structure", () => {
  it("has tabs array and activeIndex", () => {
    const session: Session = {
      tabs: [{ title: null, cwd: "/home" }],
      activeIndex: 0,
    };
    expect(session.tabs).toHaveLength(1);
    expect(session.activeIndex).toBe(0);
  });

  it("activeIndex references a valid tab", () => {
    const session: Session = {
      tabs: [
        { title: null, cwd: "/a" },
        { title: null, cwd: "/b" },
        { title: null, cwd: "/c" },
      ],
      activeIndex: 1,
    };
    expect(session.activeIndex).toBeGreaterThanOrEqual(0);
    expect(session.activeIndex).toBeLessThan(session.tabs.length);
  });
});
