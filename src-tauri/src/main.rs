mod process_info;
mod server_check;

use std::fs;
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

#[tauri::command]
fn read_config() -> Result<String, String> {
    let path = config_path();
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok(String::new())
    }
}

#[tauri::command]
fn write_config(contents: String) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_session() -> Result<String, String> {
    let path = session_path();
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok(String::new())
    }
}

#[tauri::command]
fn write_session(contents: String) -> Result<(), String> {
    let path = session_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_session() -> Result<(), String> {
    let path = session_path();
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn validate_dir(path: String) -> bool {
    let p = std::path::Path::new(&path);
    p.is_dir()
}

#[tauri::command]
fn validate_shell(path: String) -> Result<bool, String> {
    use std::os::unix::fs::PermissionsExt;
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Ok(false);
    }
    let meta = fs::metadata(p).map_err(|e| e.to_string())?;
    // Check it's a file and executable (any execute bit set)
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
            server_check::check_port,
            validate_dir,
            validate_shell,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            match event {
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                    // Always clear session on quit so the app starts fresh.
                    // This runs on the Rust side, so it works even when JS is frozen.
                    // Handle both ExitRequested AND Exit to cover all quit paths
                    // (Cmd+Q, window close, Dock quit, system shutdown).
                    let _ = clear_session();
                }
                tauri::RunEvent::WindowEvent {
                    event: tauri::WindowEvent::CloseRequested { .. },
                    ..
                } => {
                    let _ = clear_session();
                }
                _ => {}
            }
        });
}
