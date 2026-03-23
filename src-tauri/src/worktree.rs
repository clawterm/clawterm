use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Serialize)]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: String,
    pub commit: String,
    pub is_main: bool,
}

#[derive(Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub commit: String,
    pub is_remote: bool,
    /// Whether this branch already has a worktree checked out
    pub has_worktree: bool,
}

/// List all worktrees for a repository.
#[tauri::command]
pub fn list_worktrees(repo_dir: String) -> Result<Vec<WorktreeInfo>, String> {
    let output = Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(&repo_dir)
        .output()
        .map_err(|e| format!("git worktree list failed: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut worktrees = Vec::new();
    let mut path = String::new();
    let mut commit = String::new();
    let mut branch = String::new();
    let mut is_first = true;

    for line in stdout.lines() {
        if let Some(p) = line.strip_prefix("worktree ") {
            // Save previous entry
            if !path.is_empty() {
                worktrees.push(WorktreeInfo {
                    path: path.clone(),
                    branch: branch.clone(),
                    commit: commit.clone(),
                    is_main: is_first,
                });
                is_first = false;
            }
            path = p.to_string();
            branch = String::new();
            commit = String::new();
        } else if let Some(h) = line.strip_prefix("HEAD ") {
            commit = if h.len() >= 8 { h[..8].to_string() } else { h.to_string() };
        } else if let Some(b) = line.strip_prefix("branch refs/heads/") {
            branch = b.to_string();
        } else if line == "detached" {
            branch = format!("({})", &commit);
        }
    }
    // Push last entry
    if !path.is_empty() {
        worktrees.push(WorktreeInfo {
            path,
            branch,
            commit,
            is_main: is_first,
        });
    }

    Ok(worktrees)
}

/// Create a new worktree with an optional new branch.
#[tauri::command]
pub fn create_worktree(
    repo_dir: String,
    worktree_dir: String,
    branch: String,
    base_branch: String,
    create_branch: bool,
) -> Result<String, String> {
    // Ensure parent directory exists
    if let Some(parent) = Path::new(&worktree_dir).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create worktree parent dir: {}", e))?;
    }

    let mut args = vec!["worktree", "add"];
    if create_branch {
        args.push("-b");
        args.push(&branch);
    }
    args.push(&worktree_dir);
    if create_branch {
        args.push(&base_branch);
    } else {
        args.push(&branch);
    }

    let output = Command::new("git")
        .args(&args)
        .current_dir(&repo_dir)
        .output()
        .map_err(|e| format!("git worktree add failed: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(worktree_dir)
}

/// Remove a worktree.
#[tauri::command]
pub fn remove_worktree(repo_dir: String, worktree_path: String, force: bool) -> Result<(), String> {
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(&worktree_path);

    let output = Command::new("git")
        .args(&args)
        .current_dir(&repo_dir)
        .output()
        .map_err(|e| format!("git worktree remove failed: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(())
}

/// List all branches (local and remote).
#[tauri::command]
pub fn list_branches(repo_dir: String) -> Result<Vec<BranchInfo>, String> {
    // Get worktree branches first to mark which have worktrees
    let worktree_branches: Vec<String> = list_worktrees(repo_dir.clone())
        .unwrap_or_default()
        .into_iter()
        .map(|w| w.branch)
        .collect();

    // Get actual remote names to correctly distinguish remote branches
    // from local branches containing "/" (e.g. "feature/auth")
    let remote_prefixes: Vec<String> = Command::new("git")
        .args(["remote"])
        .current_dir(&repo_dir)
        .output()
        .ok()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .map(|r| format!("{}/", r))
                .collect()
        })
        .unwrap_or_default();

    let output = Command::new("git")
        .args(["branch", "-a", "--format=%(refname:short)|%(objectname:short)"])
        .current_dir(&repo_dir)
        .output()
        .map_err(|e| format!("git branch failed: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut branches = Vec::new();

    for line in stdout.lines() {
        let parts: Vec<&str> = line.splitn(2, '|').collect();
        let name = parts.first().unwrap_or(&"").to_string();
        let commit = parts.get(1).unwrap_or(&"").to_string();
        if name.is_empty() {
            continue;
        }

        // Skip HEAD pointer entries like "origin/HEAD"
        if name.ends_with("/HEAD") {
            continue;
        }

        // A branch is remote if its name starts with a known remote prefix
        // (e.g. "origin/main"). Local branches like "feature/auth" are NOT remote.
        let is_remote = remote_prefixes.iter().any(|prefix| name.starts_with(prefix.as_str()));
        let has_worktree = if is_remote {
            false
        } else {
            worktree_branches.contains(&name)
        };

        branches.push(BranchInfo {
            name,
            commit,
            is_remote,
            has_worktree,
        });
    }

    Ok(branches)
}

/// Prune stale worktree references.
#[tauri::command]
pub fn prune_worktrees(repo_dir: String) -> Result<(), String> {
    let output = Command::new("git")
        .args(["worktree", "prune"])
        .current_dir(&repo_dir)
        .output()
        .map_err(|e| format!("git worktree prune failed: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

/// Find the root of the current worktree (or main repo root if not in a worktree).
#[tauri::command]
pub fn find_repo_root(dir: String) -> Result<String, String> {
    let output = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(&dir)
        .output()
        .map_err(|e| format!("git rev-parse failed: {}", e))?;

    if !output.status.success() {
        return Err("not a git repository".to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
