mod process_info;
mod server_check;

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

/// Write a file with owner-only permissions (0o600) to prevent other users from reading it.
fn write_private(path: &PathBuf, contents: &str) -> Result<(), String> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| e.to_string())?;
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
fn validate_dir(path: String) -> bool {
    // Canonicalize to resolve symlinks, then check the real path
    match fs::canonicalize(&path) {
        Ok(real) => real.is_dir(),
        Err(_) => false,
    }
}

#[tauri::command]
fn validate_shell(path: String) -> Result<bool, String> {
    use std::os::unix::fs::PermissionsExt;
    // Canonicalize to resolve symlinks and validate the real target
    let real = match fs::canonicalize(&path) {
        Ok(p) => p,
        Err(_) => return Ok(false),
    };
    let meta = fs::metadata(&real).map_err(|e| e.to_string())?;
    // Check it's a regular file and executable (any execute bit set)
    Ok(meta.is_file() && (meta.permissions().mode() & 0o111 != 0))
}

fn main() {
    // Clean env vars that prevent tools from running inside our PTYs
    std::env::remove_var("CLAUDECODE");

    // Set terminal env vars so child PTYs inherit them.
    // TERM is also set via the PTY `name` option, but we set it here as a
    // safety net (Tauri apps launched from Finder have no TERM).
    std::env::set_var("TERM", "xterm-256color");
    std::env::set_var("COLORTERM", "truecolor");
    std::env::set_var("TERM_PROGRAM", "clawterm");

    tauri::Builder::default()
        .plugin(tauri_plugin_pty::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            read_config,
            write_config,
            read_session,
            write_session,
            clear_session,
            process_info::get_foreground_process,
            process_info::get_process_cwd,
            process_info::get_process_cwd_full,
            process_info::get_project_info,
            process_info::get_git_branch,
            process_info::has_active_children,
            server_check::check_port,
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
