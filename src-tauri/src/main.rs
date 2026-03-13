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

fn main() {
    // Clean env vars that prevent tools from running inside our PTYs
    std::env::remove_var("CLAUDECODE");

    tauri::Builder::default()
        .plugin(tauri_plugin_pty::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            read_config,
            write_config,
            read_session,
            write_session,
            process_info::get_foreground_process,
            process_info::get_process_cwd,
            process_info::get_process_cwd_full,
            process_info::get_project_info,
            server_check::check_port,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
