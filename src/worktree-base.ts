import { homeDir } from "@tauri-apps/api/path";

/**
 * Resolve the absolute base directory where new worktrees should be created.
 *
 * This is the single source of truth for translating the user's
 * `worktree.directory` config value into a concrete filesystem path. The
 * three modes encode the full design space without ambiguity (#416):
 *
 *   - `""` (default)        → `<dirname(repoRoot)>/.clawterm-worktrees/<basename(repoRoot)>/`
 *                             ("auto" — sibling of the repo, namespaced by repo name)
 *   - `"/abs"` or `"~/foo"` → `<expanded-abs>/<basename(repoRoot)>/`
 *                             ("absolute" — central cache, namespaced by repo)
 *   - `"foo"` or `".foo"`   → `<repoRoot>/foo/`
 *                             ("legacy in-repo" — preserved for users with a
 *                             reason to opt back in, NOT recommended because it
 *                             breaks tools that walk the repo tree, see #415)
 *
 * The auto mode is the fix for #415: tools that walk the main repo (Biome,
 * Vitest, tsc, ESLint) cannot discover worktree config files because they
 * live outside the walked tree. The repo-name namespace prevents collisions
 * between repos that share a parent directory.
 *
 * Edge cases handled:
 *   - Repo at filesystem root (`/repo`)        → home fallback
 *   - Parent directory of repo not writable    → home fallback
 *   - Trailing slashes / `./` prefixes         → normalized in all branches
 *
 * @param repoRoot   Absolute path to the **main** repository root (never a
 *                   worktree path; the caller is responsible for resolving
 *                   the main repo root via `--git-common-dir` if necessary).
 * @param configDir  The user's `worktree.directory` config value.
 * @param opts       Optional overrides for testability (home dir lookup,
 *                   writable probe).
 * @returns Absolute path to the directory that will contain the new
 *          worktree subdirectories. The directory is **not** created — that
 *          is the caller's responsibility (and is what `git worktree add`
 *          does anyway).
 */
export async function resolveWorktreeBase(
  repoRoot: string,
  configDir: string,
  opts?: ResolveWorktreeBaseOptions,
): Promise<string> {
  const homeLookup = opts?.homeDir ?? homeDir;
  const isWritable = opts?.isWritable ?? defaultIsWritable;
  return resolveWorktreeBaseImpl(repoRoot, configDir, homeLookup, isWritable);
}

/** Injection points for unit tests — production code never passes these. */
export interface ResolveWorktreeBaseOptions {
  /** Override for Tauri's homeDir() (e.g. in tests). Returns absolute path. */
  homeDir?: () => Promise<string>;
  /** Override for the writable-parent probe. Returns true if the path is writable. */
  isWritable?: (path: string) => Promise<boolean>;
}

async function resolveWorktreeBaseImpl(
  repoRoot: string,
  configDir: string,
  homeLookup: () => Promise<string>,
  isWritable: (p: string) => Promise<boolean>,
): Promise<string> {
  const normalizedRoot = stripTrailingSlashes(repoRoot);
  const lastSlash = normalizedRoot.lastIndexOf("/");
  const repoName = lastSlash >= 0 ? normalizedRoot.slice(lastSlash + 1) : normalizedRoot;
  const parent = lastSlash > 0 ? normalizedRoot.slice(0, lastSlash) : "";

  // Mode 1: auto (default — sibling of repo, hidden, namespaced by repo name)
  if (!configDir) {
    if (!parent || !(await isWritable(parent))) {
      // Fall back to user home (e.g. repo at filesystem root, read-only parent)
      const home = stripTrailingSlashes(await homeLookup());
      return `${home}/.clawterm-worktrees/${repoName}`;
    }
    return `${parent}/.clawterm-worktrees/${repoName}`;
  }

  // Mode 2: absolute (or tilde-prefixed).
  //
  // Tilde is only treated as a home-dir shortcut for the two well-formed
  // cases — "~" alone or "~/" prefix. Other tilde forms (notably "~user",
  // POSIX shorthand for another user's home) are NOT supported here, because
  // expanding them correctly would require a per-user lookup we don't have,
  // and silently concatenating "~foo" → "<our-home>foo" produces a malformed
  // path. Anything weird falls through to legacy mode where the user can see
  // the literal string in their resolved path. (#416 review)
  const isTildePath = configDir === "~" || configDir.startsWith("~/");
  if (configDir.startsWith("/") || isTildePath) {
    let expanded = configDir;
    if (isTildePath) {
      const home = stripTrailingSlashes(await homeLookup());
      // "~"     → "<home>"
      // "~/foo" → "<home>/foo"
      expanded = home + configDir.slice(1);
    }
    return `${stripTrailingSlashes(expanded)}/${repoName}`;
  }

  // Mode 3: relative (legacy in-repo) — strip leading "./" and trailing slashes
  const relative = configDir.replace(/^\.?\/+/, "");
  return `${normalizedRoot}/${stripTrailingSlashes(relative)}`;
}

function stripTrailingSlashes(p: string): string {
  return p.replace(/\/+$/, "") || p;
}

/** Default writable probe.
 *
 *  In production we assume the repo's parent directory is writable — the
 *  alternative would be a Tauri IPC round-trip on every dialog open, and
 *  the failure mode is rare (repo at `/`, network mount with no write
 *  perms). If the resolved base really is unwritable, `git worktree add`
 *  will fail with a clear error in the existing error path. The
 *  parent-empty case (repo at filesystem root) is handled separately
 *  in the resolver. Tests inject their own probe via the `opts` argument. */
async function defaultIsWritable(_path: string): Promise<boolean> {
  return true;
}
