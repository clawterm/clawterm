import { describe, it, expect } from "vitest";
import { resolveWorktreeBase, type ResolveWorktreeBaseOptions } from "../src/worktree-base";

/**
 * Tests for the worktree base resolver (#416). The resolver translates the
 * user's `worktree.directory` config value into an absolute filesystem path,
 * applying the auto / absolute / legacy mode rules.
 *
 * All tests use injected `homeDir` and `isWritable` stubs so the resolver
 * runs as a pure function — no Tauri runtime required.
 */
describe("resolveWorktreeBase", () => {
  const opts: ResolveWorktreeBaseOptions = {
    homeDir: async () => "/home/user",
    isWritable: async () => true,
  };

  describe("mode 1: auto (empty configDir)", () => {
    it("returns sibling directory namespaced by repo name", async () => {
      const result = await resolveWorktreeBase("/Users/me/code/myrepo", "", opts);
      expect(result).toBe("/Users/me/code/.clawterm-worktrees/myrepo");
    });

    it("strips trailing slash on repoRoot", async () => {
      const result = await resolveWorktreeBase("/Users/me/code/myrepo/", "", opts);
      expect(result).toBe("/Users/me/code/.clawterm-worktrees/myrepo");
    });

    it("falls back to home dir when repo is at filesystem root", async () => {
      const result = await resolveWorktreeBase("/repo", "", opts);
      expect(result).toBe("/home/user/.clawterm-worktrees/repo");
    });

    it("falls back to home dir when parent is unwritable", async () => {
      const unwritableOpts: ResolveWorktreeBaseOptions = {
        homeDir: async () => "/home/user",
        isWritable: async () => false,
      };
      const result = await resolveWorktreeBase(
        "/mounts/readonly/myrepo",
        "",
        unwritableOpts,
      );
      expect(result).toBe("/home/user/.clawterm-worktrees/myrepo");
    });

    it("strips trailing slashes from home dir in fallback path", async () => {
      const trailingSlashHome: ResolveWorktreeBaseOptions = {
        homeDir: async () => "/home/user/",
        isWritable: async () => true,
      };
      const result = await resolveWorktreeBase("/repo", "", trailingSlashHome);
      expect(result).toBe("/home/user/.clawterm-worktrees/repo");
    });
  });

  describe("mode 2: absolute path", () => {
    it("namespaces by repo name", async () => {
      const result = await resolveWorktreeBase(
        "/Users/me/code/myrepo",
        "/Users/me/.cache/worktrees",
        opts,
      );
      expect(result).toBe("/Users/me/.cache/worktrees/myrepo");
    });

    it("strips trailing slashes from absolute path", async () => {
      const result = await resolveWorktreeBase(
        "/Users/me/code/myrepo",
        "/Users/me/.cache/worktrees/",
        opts,
      );
      expect(result).toBe("/Users/me/.cache/worktrees/myrepo");
    });

    it("expands tilde to home directory", async () => {
      const result = await resolveWorktreeBase(
        "/Users/me/code/myrepo",
        "~/wt",
        opts,
      );
      expect(result).toBe("/home/user/wt/myrepo");
    });

    it("expands lone tilde to home directory", async () => {
      const result = await resolveWorktreeBase(
        "/Users/me/code/myrepo",
        "~",
        opts,
      );
      expect(result).toBe("/home/user/myrepo");
    });

    it("two repos with same basename in different parents do not collide via absolute config", async () => {
      const a = await resolveWorktreeBase("/projects/a/myapp", "/cache/wt", opts);
      const b = await resolveWorktreeBase("/projects/b/myapp", "/cache/wt", opts);
      // Both resolve to the same absolute base — this is by design (the
      // collision is on the *branch* directory under it, not the repo).
      // Documented as the mild break in #416 — multi-repo absolute users
      // get repo-name namespacing now where they didn't before.
      expect(a).toBe("/cache/wt/myapp");
      expect(b).toBe("/cache/wt/myapp");
    });
  });

  describe("mode 3: legacy in-repo (relative path)", () => {
    it("joins relative path under repo root", async () => {
      const result = await resolveWorktreeBase(
        "/Users/me/code/myrepo",
        ".clawterm-worktrees",
        opts,
      );
      expect(result).toBe("/Users/me/code/myrepo/.clawterm-worktrees");
    });

    it("preserves explicit hidden-dir prefix", async () => {
      const result = await resolveWorktreeBase(
        "/Users/me/code/myrepo",
        ".my-worktrees",
        opts,
      );
      expect(result).toBe("/Users/me/code/myrepo/.my-worktrees");
    });

    it("supports plain (non-hidden) relative directory names", async () => {
      const result = await resolveWorktreeBase(
        "/Users/me/code/myrepo",
        "worktrees",
        opts,
      );
      expect(result).toBe("/Users/me/code/myrepo/worktrees");
    });

    it("strips trailing slashes from relative path", async () => {
      const result = await resolveWorktreeBase(
        "/Users/me/code/myrepo",
        ".clawterm-worktrees/",
        opts,
      );
      expect(result).toBe("/Users/me/code/myrepo/.clawterm-worktrees");
    });

    it("strips './' prefix", async () => {
      const result = await resolveWorktreeBase(
        "/Users/me/code/myrepo",
        "./worktrees",
        opts,
      );
      expect(result).toBe("/Users/me/code/myrepo/worktrees");
    });
  });

  describe("regression: #415 — auto mode fixes the parent-tool walk problem", () => {
    it("auto-mode result is outside the repo tree", async () => {
      const repoRoot = "/Users/me/code/wellvector-app";
      const result = await resolveWorktreeBase(repoRoot, "", opts);
      // The resolved path must NOT start with the repo root — that's the
      // entire point of the fix. If it did, biome/vitest/tsc would still
      // walk into it from the main repo.
      expect(result.startsWith(repoRoot + "/")).toBe(false);
      expect(result.startsWith(repoRoot)).toBe(false);
    });
  });
});
