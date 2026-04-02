use std::{
    collections::BTreeMap,
    ffi::OsString,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc,
    },
};

use dashmap::DashMap;
use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, PtyPair, PtySize};
use tauri::{
    async_runtime::{spawn_blocking, Mutex},
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime,
};

#[derive(Default)]
struct PluginState {
    session_id: AtomicU32,
    /// Per-shard concurrent map — eliminates read lock contention between
    /// concurrent pane read loops (#303).
    sessions: DashMap<PtyHandler, Arc<Session>>,
}

struct Session {
    pair: Mutex<PtyPair>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    child_killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    writer: Mutex<Box<dyn std::io::Write + Send>>,
    reader: Mutex<Box<dyn std::io::Read + Send>>,
    /// OS process ID, captured at spawn time (avoids locking child mutex).
    os_pid: std::sync::atomic::AtomicU32,
}

type PtyHandler = u32;

#[tauri::command]
async fn spawn<R: Runtime>(
    file: String,
    args: Vec<String>,
    term_name: Option<String>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    env: BTreeMap<String, String>,
    encoding: Option<String>,
    handle_flow_control: Option<bool>,
    flow_control_pause: Option<String>,
    flow_control_resume: Option<String>,

    state: tauri::State<'_, PluginState>,
    _app_handle: AppHandle<R>,
) -> Result<PtyHandler, String> {
    // TODO: Support these parameters
    let _ = term_name;
    let _ = encoding;
    let _ = handle_flow_control;
    let _ = flow_control_pause;
    let _ = flow_control_resume;

    let pty_system = native_pty_system();
    // Create PTY, get the writer and reader
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(file);
    cmd.args(args);
    if let Some(cwd) = cwd {
        cmd.cwd(OsString::from(cwd));
    }
    for (k, v) in env.iter() {
        cmd.env(OsString::from(k), OsString::from(v));
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let os_pid = child.process_id().unwrap_or(0);
    let child_killer = child.clone_killer();
    let handler = state.session_id.fetch_add(1, Ordering::Relaxed);

    let pair = Arc::new(Session {
        pair: Mutex::new(pair),
        child: Mutex::new(child),
        child_killer: Mutex::new(child_killer),
        writer: Mutex::new(writer),
        reader: Mutex::new(reader),
        os_pid: std::sync::atomic::AtomicU32::new(os_pid),
    });
    state.sessions.insert(handler, pair);
    Ok(handler)
}

#[tauri::command]
async fn write(
    pid: PtyHandler,
    data: String,
    state: tauri::State<'_, PluginState>,
) -> Result<(), String> {
    let session = state
        .sessions
        .get(&pid)
        .ok_or("Unavailable pid")?
        .clone();
    spawn_blocking(move || {
        session
            .writer
            .blocking_lock()
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn read(pid: PtyHandler, state: tauri::State<'_, PluginState>) -> Result<Vec<u8>, String> {
    let session = state
        .sessions
        .get(&pid)
        .ok_or("Unavailable pid")?
        .clone();
    spawn_blocking(move || {
        let mut buf = vec![0u8; 65536];
        let n = session
            .reader
            .blocking_lock()
            .read(&mut buf)
            .map_err(|e| e.to_string())?;
        if n == 0 {
            Err(String::from("EOF"))
        } else {
            buf.truncate(n);
            Ok(buf)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn resize(
    pid: PtyHandler,
    cols: u16,
    rows: u16,
    state: tauri::State<'_, PluginState>,
) -> Result<(), String> {
    let session = state
        .sessions
        .get(&pid)
        .ok_or("Unavailable pid")?
        .clone();
    session
        .pair
        .lock()
        .await
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn kill(pid: PtyHandler, state: tauri::State<'_, PluginState>) -> Result<(), String> {
    let session = state
        .sessions
        .get(&pid)
        .ok_or("Unavailable pid")?
        .clone();
    session
        .child_killer
        .lock()
        .await
        .kill()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn exitstatus(pid: PtyHandler, state: tauri::State<'_, PluginState>) -> Result<u32, String> {
    let session = state
        .sessions
        .get(&pid)
        .ok_or("Unavailable pid")?
        .clone();
    let exitstatus = spawn_blocking(move || {
        session
            .child
            .blocking_lock()
            .wait()
            .map_err(|e| e.to_string())
            .map(|s| s.exit_code())
    })
    .await
    .map_err(|e| e.to_string())??;
    // Process has exited — remove the session from the map to prevent leaks.
    state.sessions.remove(&pid);
    Ok(exitstatus)
}

/// Explicitly remove a PTY session from the map.
/// Use this when the caller knows the session is no longer needed (e.g. after
/// the process has exited and all output has been drained).
#[tauri::command]
async fn close_session(pid: PtyHandler, state: tauri::State<'_, PluginState>) -> Result<(), String> {
    state
        .sessions
        .remove(&pid)
        .ok_or("Unknown pid")?;
    Ok(())
}

/// Get the OS process ID of the shell running in a pty session.
/// Reads from an atomic field set at spawn time — no mutex needed.
#[tauri::command]
async fn child_pid(pid: PtyHandler, state: tauri::State<'_, PluginState>) -> Result<u32, String> {
    let session = state
        .sessions
        .get(&pid)
        .ok_or("Unavailable pid")?
        .clone();
    let os_pid = session.os_pid.load(Ordering::Relaxed);
    if os_pid == 0 {
        Err("No process ID available".to_string())
    } else {
        Ok(os_pid)
    }
}

/// Get the foreground process group leader PID of the PTY.
/// Uses tcgetpgrp on the master fd — only available on Unix (POSIX).
/// On Windows, ConPTY does not expose process groups; use the
/// process tree walking in process_info.rs instead.
#[tauri::command]
async fn foreground_pid(pid: PtyHandler, state: tauri::State<'_, PluginState>) -> Result<u32, String> {
    #[cfg(unix)]
    {
        let session = state
            .sessions
            .get(&pid)
            .ok_or("Unavailable pid")?
            .clone();
        let pair = session.pair.lock().await;
        let fd = pair.master.as_raw_fd()
            .ok_or("No raw fd available")?;
        let pgid = unsafe { libc::tcgetpgrp(fd) };
        if pgid < 0 {
            Err("tcgetpgrp failed".to_string())
        } else {
            Ok(pgid as u32)
        }
    }

    #[cfg(not(unix))]
    {
        let _ = (pid, state);
        Err("foreground_pid is not supported on this platform — use process tree walking instead".to_string())
    }
}

/// Kill and remove all active PTY sessions.
/// Called on frontend unload to prevent zombie sessions across hot reloads.
#[tauri::command]
async fn clear_sessions(state: tauri::State<'_, PluginState>) -> Result<(), String> {
    // Collect Arc values first so shard read locks are released before
    // the async kill() calls — holding DashMap refs across .await can cause
    // unbounded contention if kill() is slow (#303).
    let sessions: Vec<Arc<Session>> = state.sessions.iter()
        .map(|entry| entry.value().clone())
        .collect();
    for session in sessions {
        let _ = session.child_killer.lock().await.kill();
    }
    state.sessions.clear();
    state.session_id.store(0, Ordering::Relaxed);
    Ok(())
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R>::new("pty")
        .invoke_handler(tauri::generate_handler![
            spawn, write, read, resize, kill, exitstatus, child_pid, foreground_pid, close_session, clear_sessions
        ])
        .setup(|app_handle, _api| {
            app_handle.manage(PluginState::default());
            Ok(())
        })
        .build()
}
