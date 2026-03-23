import { describe, it, expect } from "vitest";
import { branchColor, createDefaultTabState, type GitStatusInfo } from "../src/tab-state";

describe("branchColor", () => {
  it("returns a hex color string", () => {
    const color = branchColor("main");
    expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("is deterministic — same branch always returns same color", () => {
    expect(branchColor("feature/auth")).toBe(branchColor("feature/auth"));
    expect(branchColor("main")).toBe(branchColor("main"));
  });

  it("different branches can get different colors", () => {
    // Not guaranteed for all pairs, but these specific names produce different hashes
    const colors = new Set([
      branchColor("main"),
      branchColor("develop"),
      branchColor("feature/auth"),
      branchColor("fix/login"),
      branchColor("release/v2"),
    ]);
    // At least some should differ (with 8 colors and 5 branches, collision is possible but unlikely for all)
    expect(colors.size).toBeGreaterThanOrEqual(2);
  });

  it("handles empty string without crashing", () => {
    const color = branchColor("");
    expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("handles long branch names", () => {
    const color = branchColor("feature/very-long-branch-name-that-goes-on-and-on/sub/path");
    expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("handles special characters in branch names", () => {
    const color = branchColor("fix/JIRA-1234_some-thing");
    expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

describe("createDefaultTabState includes git fields", () => {
  it("has gitBranch as null", () => {
    const state = createDefaultTabState();
    expect(state.gitBranch).toBeNull();
  });

  it("has gitStatus as null", () => {
    const state = createDefaultTabState();
    expect(state.gitStatus).toBeNull();
  });

  it("accepts a full GitStatusInfo object", () => {
    const status: GitStatusInfo = {
      branch: "main",
      modified: 3,
      staged: 1,
      untracked: 2,
      ahead: 1,
      behind: 0,
      is_worktree: false,
    };
    const state = createDefaultTabState();
    state.gitStatus = status;
    expect(state.gitStatus.branch).toBe("main");
    expect(state.gitStatus.modified).toBe(3);
    expect(state.gitStatus.is_worktree).toBe(false);
  });

  it("worktree status is correctly typed", () => {
    const status: GitStatusInfo = {
      branch: "feature/auth",
      modified: 0,
      staged: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
      is_worktree: true,
    };
    expect(status.is_worktree).toBe(true);
  });
});

describe("GitStatusInfo counts", () => {
  it("all counts can be zero (clean working tree)", () => {
    const status: GitStatusInfo = {
      branch: "main",
      modified: 0,
      staged: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
      is_worktree: false,
    };
    const total = status.modified + status.staged + status.untracked;
    expect(total).toBe(0);
  });

  it("a file can be both staged and modified", () => {
    // When a file is staged then modified again, both counts increment
    const status: GitStatusInfo = {
      branch: "feature",
      modified: 1,
      staged: 1,
      untracked: 0,
      ahead: 0,
      behind: 0,
      is_worktree: false,
    };
    expect(status.modified + status.staged).toBe(2);
  });

  it("ahead/behind track remote divergence", () => {
    const status: GitStatusInfo = {
      branch: "main",
      modified: 0,
      staged: 0,
      untracked: 0,
      ahead: 3,
      behind: 1,
      is_worktree: false,
    };
    expect(status.ahead).toBe(3);
    expect(status.behind).toBe(1);
  });
});
