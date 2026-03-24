use serde::Serialize;

/// Parse a HEAD file to extract the branch name or short commit hash.
fn parse_head_file(head_path: &std::path::Path) -> String {
    if let Ok(content) = std::fs::read_to_string(head_path) {
        let content = content.trim();
        if let Some(branch) = content.strip_prefix("ref: refs/heads/") {
            return branch.to_string();
        }
        if content.len() >= 8 {
            return content[..8].to_string();
        }
    }
    String::new()
}

/// Read the current git branch for a directory by parsing .git/HEAD.
/// Walks up the directory tree to find the nearest .git entry.
/// Handles both regular repos and worktrees (.git file with gitdir pointer).
#[tauri::command]
pub fn get_git_branch(dir: String) -> String {
    let mut path = match std::fs::canonicalize(&dir) {
        Ok(p) => p,
        Err(_) => return String::new(),
    };

    loop {
        let git_entry = path.join(".git");
        if git_entry.exists() {
            if git_entry.is_dir() {
                return parse_head_file(&git_entry.join("HEAD"));
            } else if git_entry.is_file() {
                if let Ok(content) = std::fs::read_to_string(&git_entry) {
                    let content = content.trim();
                    if let Some(gitdir) = content.strip_prefix("gitdir: ") {
                        let gitdir_path = if std::path::Path::new(gitdir).is_absolute() {
                            std::path::PathBuf::from(gitdir)
                        } else {
                            path.join(gitdir)
                        };
                        return parse_head_file(&gitdir_path.join("HEAD"));
                    }
                }
                return String::new();
            }
        }
        if !path.pop() {
            break;
        }
    }

    String::new()
}

/// Structured git status for a directory.
#[derive(Serialize)]
pub struct GitStatus {
    pub branch: String,
    pub modified: u32,
    pub staged: u32,
    pub untracked: u32,
    pub ahead: u32,
    pub behind: u32,
    pub is_worktree: bool,
}

/// Get structured git status using `git status --porcelain=v2 --branch`.
#[tauri::command]
pub fn get_git_status(dir: String) -> Result<GitStatus, String> {
    let path = match std::fs::canonicalize(&dir) {
        Ok(p) => p,
        Err(e) => return Err(format!("invalid dir: {}", e)),
    };

    let output = std::process::Command::new("git")
        .args(["--no-optional-locks", "status", "--porcelain=v2", "--branch"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("git status failed: {}", e))?;

    if !output.status.success() {
        return Err("not a git repo".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut branch = String::new();
    let mut modified: u32 = 0;
    let mut staged: u32 = 0;
    let mut untracked: u32 = 0;
    let mut ahead: u32 = 0;
    let mut behind: u32 = 0;

    for line in stdout.lines() {
        if let Some(rest) = line.strip_prefix("# branch.head ") {
            branch = rest.to_string();
        } else if let Some(rest) = line.strip_prefix("# branch.ab ") {
            for part in rest.split_whitespace() {
                if let Some(n) = part.strip_prefix('+') {
                    ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix('-') {
                    behind = n.parse().unwrap_or(0);
                }
            }
        } else if line.starts_with("1 ") || line.starts_with("2 ") {
            let xy: &str = line.split_whitespace().nth(1).unwrap_or("..");
            let x = xy.as_bytes().first().copied().unwrap_or(b'.');
            let y = xy.as_bytes().get(1).copied().unwrap_or(b'.');
            if x != b'.' {
                staged += 1;
            }
            if y != b'.' {
                modified += 1;
            }
        } else if line.starts_with("? ") {
            untracked += 1;
        }
    }

    let is_worktree = path.join(".git").is_file();

    Ok(GitStatus {
        branch,
        modified,
        staged,
        untracked,
        ahead,
        behind,
        is_worktree,
    })
}
