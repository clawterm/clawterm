mod git_info;
mod process_info;
mod project_info;
mod server_check;
mod worktree;

use std::fs;
use std::io::Write;
use std::path::PathBuf;

fn clawterm_dir() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| {
            let home = dirs::home_dir().expect("Could not determine home directory");
            home.join(".config")
        });
    config_dir.join("clawterm")
}

fn config_path() -> PathBuf {
    clawterm_dir().join("config.json")
}

fn session_path() -> PathBuf {
    clawterm_dir().join("session.json")
}

/// Write a file with restricted permissions.
/// On Unix: mode 0o600 (owner-only read/write).
/// On Windows: standard ACLs apply (no chmod equivalent needed).
fn write_private(path: &PathBuf, contents: &str) -> Result<(), String> {
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }

    let mut f = opts.open(path).map_err(|e| e.to_string())?;
    f.write_all(contents.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_config() -> Result<String, String> {
    let path = config_path();
    match fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn write_config(contents: String) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    write_private(&path, &contents)
}

#[tauri::command]
fn read_session() -> Result<String, String> {
    let path = session_path();
    match fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn write_session(contents: String) -> Result<(), String> {
    let path = session_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    write_private(&path, &contents)
}

#[tauri::command]
fn clear_session() -> Result<(), String> {
    let path = session_path();
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn list_custom_themes() -> Result<Vec<(String, String)>, String> {
    let dir = clawterm_dir().join("themes");
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut themes = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string();
            let contents = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            themes.push((name, contents));
        }
    }
    themes.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(themes)
}

#[tauri::command]
fn save_custom_theme(name: String, contents: String) -> Result<(), String> {
    let dir = clawterm_dir().join("themes");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.json", name));
    write_private(&path, &contents)
}

#[tauri::command]
fn validate_dir(path: String) -> bool {
    // Canonicalize to resolve symlinks, then check the real path
    match fs::canonicalize(&path) {
        Ok(real) => real.is_dir(),
        Err(_) => false,
    }
}

#[tauri::command]
fn validate_shell(path: String) -> Result<bool, String> {
    // Canonicalize to resolve symlinks and validate the real target
    let real = match fs::canonicalize(&path) {
        Ok(p) => p,
        Err(_) => return Ok(false),
    };
    let meta = fs::metadata(&real).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // Check it's a regular file and executable (any execute bit set)
        Ok(meta.is_file() && (meta.permissions().mode() & 0o111 != 0))
    }

    #[cfg(windows)]
    {
        // On Windows, executables are identified by extension, not permission bits
        let is_executable = real
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| matches!(ext.to_lowercase().as_str(), "exe" | "cmd" | "bat" | "com"))
            .unwrap_or(false);
        Ok(meta.is_file() && is_executable)
    }
}

fn main() {
    // Clean env vars that prevent tools from running inside our PTYs
    std::env::remove_var("CLAUDECODE");

    // Set terminal env vars so child PTYs inherit them.
    // TERM is only meaningful on Unix (ConPTY handles VT translation on Windows).
    #[cfg(unix)]
    {
        std::env::set_var("TERM", "xterm-256color");
        std::env::set_var("COLORTERM", "truecolor");
    }
    std::env::set_var("TERM_PROGRAM", "clawterm");

    // On Windows, ensure HOME is set from USERPROFILE if not already present.
    // Many Unix-origin tools (git, npm, cargo) expect HOME even on Windows.
    #[cfg(windows)]
    {
        if std::env::var_os("HOME").is_none() {
            if let Some(profile) = std::env::var_os("USERPROFILE") {
                std::env::set_var("HOME", profile);
            }
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_pty::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            read_config,
            write_config,
            list_custom_themes,
            save_custom_theme,
            read_session,
            write_session,
            clear_session,
            process_info::get_foreground_process,
            process_info::get_process_cwd,
            process_info::get_process_cwd_full,
            process_info::has_active_children,
            process_info::poll_pane_info,
            git_info::get_git_branch,
            git_info::get_git_status,
            project_info::get_project_info,
            server_check::check_port,
            worktree::list_worktrees,
            worktree::create_worktree,
            worktree::remove_worktree,
            worktree::list_branches,
            worktree::prune_worktrees,
            worktree::find_repo_root,
            validate_dir,
            validate_shell,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // Session is now flushed by the JS side (flushSession) before dispose.
            // No Rust-side session clearing needed.
        });
}
