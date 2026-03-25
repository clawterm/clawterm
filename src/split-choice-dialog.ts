import { trapFocus } from "./utils";

let activeDialog: HTMLDivElement | null = null;

/**
 * Show a lightweight dialog letting the user choose between
 * creating a new worktree or splitting on the same branch.
 *
 * - Left arrow (or click) → "New Worktree"
 * - Right arrow (or click) → "Same Branch"
 * - Escape → cancel
 */
export function showSplitChoiceDialog(
  branchName: string,
  onChoice: (mode: "worktree" | "same-branch") => void,
): void {
  // Dismiss any existing dialog first (prevent double-open)
  if (activeDialog) {
    activeDialog.remove();
    activeDialog = null;
  }

  const overlay = document.createElement("div");
  overlay.className = "close-confirm-overlay split-choice-overlay";
  activeDialog = overlay;

  const dialog = document.createElement("div");
  dialog.className = "close-confirm-dialog split-choice-dialog";

  const titleEl = document.createElement("div");
  titleEl.className = "close-confirm-title split-choice-title";
  titleEl.textContent = `Split from ${branchName}`;

  const choicesEl = document.createElement("div");
  choicesEl.className = "split-choice-options";

  const worktreeBtn = document.createElement("button");
  worktreeBtn.className = "split-choice-btn";
  worktreeBtn.innerHTML =
    `<span class="split-choice-key">\u2190</span>` +
    `<span class="split-choice-label">New Worktree</span>` +
    `<span class="split-choice-hint">New branch &amp; directory</span>`;

  const sameBranchBtn = document.createElement("button");
  sameBranchBtn.className = "split-choice-btn";
  sameBranchBtn.innerHTML =
    `<span class="split-choice-key">\u2192</span>` +
    `<span class="split-choice-label">Same Branch</span>` +
    `<span class="split-choice-hint">Stay on ${branchName}</span>`;

  choicesEl.appendChild(worktreeBtn);
  choicesEl.appendChild(sameBranchBtn);
  dialog.appendChild(titleEl);
  dialog.appendChild(choicesEl);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const removeTrap = trapFocus(dialog);

  const dismiss = () => {
    removeTrap();
    overlay.remove();
    if (activeDialog === overlay) activeDialog = null;
  };

  const choose = (mode: "worktree" | "same-branch") => {
    dismiss();
    onChoice(mode);
  };

  worktreeBtn.addEventListener("click", () => choose("worktree"));
  sameBranchBtn.addEventListener("click", () => choose("same-branch"));

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) dismiss();
  });

  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      dismiss();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      choose("worktree");
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      choose("same-branch");
    } else if (e.key === "Tab") {
      // Allow tab between the two buttons but don't escape
      e.stopPropagation();
    }
  });

  // Focus the dialog so keyboard events work immediately
  worktreeBtn.focus();
}
