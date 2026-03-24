import { invoke } from "@tauri-apps/api/core";
import { invokeWithTimeout } from "./utils";
import { showWorktreeDialog, type WorktreeDialogResult } from "./worktree-dialog";
import type { Tab } from "./tab";
import type { Config } from "./config";
import { logger } from "./logger";
import { showToast } from "./toast";

/** Context passed to worktree actions — avoids coupling to TerminalManager. */
export interface WorktreeContext {
  getActiveTab(): Tab | null;
  config: Config;
  createTab(cwd: string): Promise<void>;
  writeToActivePty(text: string): void;
}

/** Resolve the main repo root, preferring pane.repoRoot for worktree-aware resolution. */
async function resolveRepoRoot(tab: Tab): Promise<string | null> {
  const cwd = tab.lastFullCwd;
  if (!cwd) {
    showToast("No working directory — open a tab first", "warn");
    return null;
  }
  const focusedPane = tab.getFocusedPane();
  if (focusedPane?.repoRoot) return focusedPane.repoRoot;
  try {
    return await invokeWithTimeout<string>("find_repo_root", { dir: cwd }, 3000);
  } catch {
    showToast("Not in a git repository", "warn");
    return null;
  }
}

/** Open the "New Agent Tab on Branch" dialog and create a worktree + tab. */
export async function openWorktreeDialog(ctx: WorktreeContext): Promise<void> {
  const tab = ctx.getActiveTab();
  if (!tab) return;

  const repoRoot = await resolveRepoRoot(tab);
  if (!repoRoot) return;

  const worktreeDir = ctx.config.worktree.directory;
  const defaultAgent = ctx.config.worktree.defaultAgent;

  showWorktreeDialog(repoRoot, worktreeDir, defaultAgent, (result) => {
    createAgentTab(ctx, repoRoot, result);
  });
}

/** Create a worktree, open a new tab in it, and optionally launch an agent. */
async function createAgentTab(
  ctx: WorktreeContext,
  repoRoot: string,
  result: WorktreeDialogResult,
): Promise<void> {
  try {
    await invokeWithTimeout<string>(
      "create_worktree",
      {
        repoDir: repoRoot,
        worktreeDir: result.worktreeDir,
        branch: result.branch,
        baseBranch: result.baseBranch,
        createBranch: result.createBranch,
      },
      10000,
    );

    await ctx.createTab(result.worktreeDir);

    // Store worktree metadata on the tab and its initial pane
    const tab = ctx.getActiveTab();
    if (tab) {
      tab.worktreePath = result.worktreeDir;
      tab.repoRoot = repoRoot;
      const pane = tab.getFocusedPane();
      if (pane) {
        pane.worktreePath = result.worktreeDir;
        pane.repoRoot = repoRoot;
      }
    }

    // Run post-create hooks
    for (const hook of ctx.config.worktree.postCreateHooks) {
      ctx.writeToActivePty(hook + "\n");
      await new Promise((r) => setTimeout(r, 500));
    }

    // Launch agent if configured
    if (result.launchAgent) {
      await new Promise((r) => setTimeout(r, 300));
      ctx.writeToActivePty(result.launchAgent + "\n");
    }

    showToast(`Worktree created: ${result.branch}`, "info", 3000);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showToast(`Failed to create worktree: ${msg}`, "error");
    logger.warn("createAgentTab failed:", e);
  }
}

/** Open the "Split to Branch" dialog and split the focused pane into a worktree. */
export async function openSplitToBranchDialog(
  ctx: WorktreeContext,
  direction: "horizontal" | "vertical" = "horizontal",
): Promise<void> {
  const tab = ctx.getActiveTab();
  if (!tab) return;

  const repoRoot = await resolveRepoRoot(tab);
  if (!repoRoot) return;

  const worktreeDir = ctx.config.worktree.directory;

  showWorktreeDialog(
    repoRoot,
    worktreeDir,
    "",
    (result) => {
      splitToBranch(ctx, tab, repoRoot, result, direction);
    },
    {
      title: "Split to Branch",
      showAgent: false,
      buttonLabel: "Split",
    },
  );
}

/** Create a worktree and split the focused pane into it. */
async function splitToBranch(
  ctx: WorktreeContext,
  tab: Tab,
  repoRoot: string,
  result: WorktreeDialogResult,
  direction: "horizontal" | "vertical" = "horizontal",
): Promise<void> {
  try {
    await invokeWithTimeout<string>(
      "create_worktree",
      {
        repoDir: repoRoot,
        worktreeDir: result.worktreeDir,
        branch: result.branch,
        baseBranch: result.baseBranch,
        createBranch: result.createBranch,
      },
      10000,
    );

    // Track pane count to detect if split actually succeeded
    const paneBefore = tab.getFocusedPane();
    const paneCountBefore = tab.getPanes().length;
    await tab.splitWithCwd(direction, result.worktreeDir);
    const panesAfter = tab.getPanes().length;

    // If the split failed (pane limit, PTY error), clean up the orphaned worktree
    if (panesAfter === paneCountBefore) {
      logger.warn("splitToBranch: split failed, cleaning up orphaned worktree");
      invoke("remove_worktree", {
        repoDir: repoRoot,
        worktreePath: result.worktreeDir,
        force: true,
      }).catch((e) => logger.debug("Failed to clean orphaned worktree:", e));
      showToast("Failed to split — pane limit or PTY error", "error");
      return;
    }

    // The new pane is now focused — set worktree metadata on it
    const newPane = tab.getFocusedPane();
    if (newPane && newPane !== paneBefore) {
      newPane.worktreePath = result.worktreeDir;
      newPane.repoRoot = repoRoot;
    }

    // Run post-create hooks in the new pane
    for (const hook of ctx.config.worktree.postCreateHooks) {
      tab.writeToPty(hook + "\n");
      await new Promise((r) => setTimeout(r, 500));
    }

    showToast(`Split to branch: ${result.branch}`, "info", 3000);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showToast(`Failed to split to branch: ${msg}`, "error");
    logger.warn("splitToBranch failed:", e);
  }
}
