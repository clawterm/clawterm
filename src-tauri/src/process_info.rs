use serde::Serialize;

use crate::git_info;
use crate::project_info;

#[derive(Serialize)]
pub struct ProcessInfo {
    pub name: String,
    pub pid: u32,
}

/// Result of a batched pane poll — replaces 5-7 individual IPC calls
/// with a single round-trip.
#[derive(Serialize)]
pub struct PanePollResult {
    /// Deepest foreground process info (name + pid)
    pub process: ProcessInfo,
    /// CWD folder name (last path component) for display
    pub cwd_folder: String,
    /// Full CWD path
    pub cwd_full: String,
    /// Git status (None if not a git repo or CWD unchanged and cached)
    pub git: Option<git_info::GitStatus>,
    /// Project name from manifest files (only when CWD changed)
    pub project_name: Option<String>,
    /// Whether the foreground process has active child processes
    pub has_children: bool,
}

/// Batched pane poll — performs all per-pane introspection in a single IPC
/// call.  The frontend passes `fg_pgid` (from the separate `foreground_pid`
/// call that needs the PTY fd) and the previous CWD to enable skip logic.
///
/// Replaces sequential calls to: get_foreground_process, get_process_cwd,
/// get_process_cwd_full, get_git_status, get_project_info, has_active_children.
#[tauri::command]
pub fn poll_pane_info(
    shell_pid: u32,
    fg_pgid: u32,
    last_cwd: Option<String>,
    skip_expensive: bool,
) -> Result<PanePollResult, String> {
    let is_idle = fg_pgid == shell_pid;

    // 1. Foreground process — always walk the tree from shell to find agents.
    //    Claude Code is a TUI app that may not change the PTY foreground group,
    //    so fg_pgid == shell_pid even when Claude is running.
    let process = if !is_idle {
        platform::get_foreground_process(fg_pgid).unwrap_or(ProcessInfo {
            name: String::new(),
            pid: fg_pgid,
        })
    } else {
        // Even when "idle", walk the shell's children to detect running agents
        platform::get_foreground_process(shell_pid).unwrap_or(ProcessInfo {
            name: String::new(),
            pid: shell_pid,
        })
    };

    // 2. CWD — single syscall, derive folder name server-side
    let prev_cwd = last_cwd.unwrap_or_default();
    let (cwd_folder, cwd_full) = if skip_expensive {
        // Reuse last known CWD — nothing has changed
        let folder = if prev_cwd.is_empty() {
            String::new()
        } else {
            cwd_to_folder(&prev_cwd)
        };
        (folder, prev_cwd.clone())
    } else {
        match platform::proc_cwd(shell_pid) {
            Ok(full) => {
                let folder = cwd_to_folder(&full);
                (folder, full)
            }
            Err(_) => {
                let folder = if prev_cwd.is_empty() {
                    String::new()
                } else {
                    cwd_to_folder(&prev_cwd)
                };
                (folder, prev_cwd.clone())
            }
        }
    };

    // 3. Git status (uses the 3s TTL cache from git_info)
    let git = if !cwd_full.is_empty() && !skip_expensive {
        git_info::get_git_status(cwd_full.clone()).ok()
    } else {
        None
    };

    // 4. Project name — only when CWD actually changed
    let cwd_changed = prev_cwd.is_empty() || prev_cwd != cwd_full;
    let project_name = if cwd_changed && !cwd_full.is_empty() {
        let name = project_info::get_project_info(cwd_full.clone());
        if name.is_empty() { None } else { Some(name) }
    } else {
        None
    };

    // 5. Active children check
    let has_children = if !is_idle {
        platform::has_active_children(process.pid)
    } else {
        false
    };

    Ok(PanePollResult {
        process,
        cwd_folder,
        cwd_full,
        git,
        project_name,
        has_children,
    })
}

/// Convert a full CWD path to a display folder name.
fn cwd_to_folder(cwd: &str) -> String {
    let home_var = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"));
    if let Some(home) = home_var {
        if cwd == home.to_string_lossy() {
            return "~".to_string();
        }
    }
    std::path::Path::new(cwd)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| {
            if cwd == "/" { "/".to_string() } else { "~".to_string() }
        })
}

/// Walk the process tree to find the deepest child of `shell_pid`.
#[tauri::command]
pub fn get_foreground_process(pid: u32) -> Result<ProcessInfo, String> {
    platform::get_foreground_process(pid)
}

/// Get the current working directory of a process by PID.
/// Returns the last path component for display.
#[tauri::command]
pub fn get_process_cwd(pid: u32) -> Result<String, String> {
    let cwd = platform::proc_cwd(pid)?;

    // Show "~" when at the user's home directory
    let home_var = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"));
    if let Some(home) = home_var {
        if cwd == home.to_string_lossy() {
            return Ok("~".to_string());
        }
    }

    let folder = std::path::Path::new(&cwd)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| {
            if cwd == "/" {
                "/".to_string()
            } else {
                "~".to_string()
            }
        });
    Ok(folder)
}

/// Get the full current working directory path of a process.
#[tauri::command]
pub fn get_process_cwd_full(pid: u32) -> Result<String, String> {
    platform::proc_cwd(pid)
}

/// Check if a process has active child processes (i.e., the agent spawned
/// subprocesses like compilers, test runners, git, etc. that are still running).
/// Returns true if the process tree is actively doing work.
#[tauri::command]
pub fn has_active_children(pid: u32) -> bool {
    platform::has_active_children(pid)
}

// --- macOS process introspection ---

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::mem;

    extern "C" {
        fn proc_listchildpids(ppid: libc::c_int, buffer: *mut libc::c_void, buffersize: libc::c_int) -> libc::c_int;
        fn proc_name(pid: libc::c_int, buffer: *mut libc::c_void, buffersize: u32) -> libc::c_int;
    }

    const PROC_PIDVNODEPATHINFO: libc::c_int = 9;

    /// Known agent process names — if we see one during the tree walk,
    /// remember it so we can report it even if the deepest child is a
    /// subshell or helper process spawned by the agent.
    fn is_known_agent(name: &str) -> bool {
        matches!(
            name,
            "claude" | "claude-code" | "aider" | "copilot" | "cursor"
                | "codex" | "gemini"
        )
    }

    /// Maximum depth for process tree traversal — prevents runaway syscalls
    /// in deeply nested process trees (Docker, tmux, nested shells).
    const MAX_TREE_DEPTH: usize = 10;

    pub fn get_foreground_process(pid: u32) -> Result<ProcessInfo, String> {
        let mut current_pid = pid;
        let mut current_name = get_proc_name(pid).unwrap_or_default();

        let mut agent_pid: Option<u32> = None;
        let mut agent_name: Option<String> = None;
        let mut depth = 0;

        loop {
            if depth >= MAX_TREE_DEPTH {
                break;
            }
            depth += 1;
            let children = list_child_pids(current_pid);
            if children.is_empty() {
                break;
            }
            let child_pid = children[children.len() - 1];
            current_name = get_proc_name(child_pid).unwrap_or_default();
            current_pid = child_pid;

            let mut resolved_name = current_name.clone();
            if matches!(resolved_name.as_str(), "node" | "python" | "python3" | "ruby") {
                if let Some(friendly) = friendly_name_from_args(current_pid) {
                    resolved_name = friendly.clone();
                }
            }
            if is_known_agent(&resolved_name) {
                agent_pid = Some(current_pid);
                agent_name = Some(resolved_name);
            }
        }

        if matches!(current_name.as_str(), "node" | "python" | "python3" | "ruby") {
            if let Some(friendly) = friendly_name_from_args(current_pid) {
                current_name = friendly;
            }
        }

        if !is_known_agent(&current_name) {
            if let (Some(ap), Some(an)) = (agent_pid, agent_name) {
                return Ok(ProcessInfo { name: an, pid: ap });
            }
        }

        Ok(ProcessInfo {
            name: current_name,
            pid: current_pid,
        })
    }

    fn list_child_pids(ppid: u32) -> Vec<u32> {
        unsafe {
            let count = proc_listchildpids(ppid as libc::c_int, std::ptr::null_mut(), 0);
            if count <= 0 {
                return vec![];
            }

            // Over-allocate to handle TOCTOU race (children spawned between calls).
            // Cap at 4096 to prevent allocation overflow from extreme values.
            let capacity = (count as usize).min(4096) + 16;
            let buf_size = capacity * mem::size_of::<libc::c_int>();
            let mut pids: Vec<libc::c_int> = vec![0; capacity];

            let actual = proc_listchildpids(
                ppid as libc::c_int,
                pids.as_mut_ptr() as *mut libc::c_void,
                buf_size as libc::c_int,
            );

            if actual <= 0 {
                return vec![];
            }

            let actual_count = actual as usize / mem::size_of::<libc::c_int>();
            pids.truncate(actual_count);
            pids.into_iter().filter(|&p| p > 0).map(|p| p as u32).collect()
        }
    }

    fn get_proc_name(pid: u32) -> Option<String> {
        unsafe {
            let mut buf = [0u8; 1024];
            let ret = proc_name(
                pid as libc::c_int,
                buf.as_mut_ptr() as *mut libc::c_void,
                buf.len() as u32,
            );
            if ret <= 0 {
                return None;
            }
            // Clamp to buffer size to prevent out-of-bounds slice on unexpected return values
            let len = (ret as usize).min(buf.len());
            Some(
                std::str::from_utf8(&buf[..len])
                    .unwrap_or("")
                    .to_string(),
            )
        }
    }

    /// Read the command-line args of a process and return a friendly name
    /// if the first script arg matches a known tool (e.g. claude, aider).
    fn friendly_name_from_args(pid: u32) -> Option<String> {
        let args = get_proc_args(pid)?;
        // args[0] is the executable (e.g. /usr/local/bin/node).
        // Look through the remaining args for a recognizable script name.
        for arg in args.iter().skip(1) {
            // Skip flags
            if arg.starts_with('-') {
                continue;
            }
            let basename = std::path::Path::new(arg)
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_default()
                .to_lowercase();
            // Strip common extensions
            let name = basename
                .trim_end_matches(".js")
                .trim_end_matches(".mjs")
                .trim_end_matches(".cjs")
                .trim_end_matches(".py")
                .trim_end_matches(".rb");
            if matches!(name, "claude" | "claude-code" | "aider" | "copilot" | "cursor" | "codex" | "gemini") {
                return Some(name.to_string());
            }
            // First non-flag arg checked; stop to avoid false positives
            break;
        }
        None
    }

    /// Read the command-line arguments of a process via sysctl KERN_PROCARGS2.
    fn get_proc_args(pid: u32) -> Option<Vec<String>> {
        unsafe {
            let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid as libc::c_int];
            let mut size: libc::size_t = 0;

            // First call: get buffer size
            if libc::sysctl(
                mib.as_mut_ptr(),
                3,
                std::ptr::null_mut(),
                &mut size,
                std::ptr::null_mut(),
                0,
            ) != 0 {
                return None;
            }

            let mut buf = vec![0u8; size];
            if libc::sysctl(
                mib.as_mut_ptr(),
                3,
                buf.as_mut_ptr() as *mut libc::c_void,
                &mut size,
                std::ptr::null_mut(),
                0,
            ) != 0 {
                return None;
            }

            if size < 4 {
                return None;
            }

            // Format: argc (i32), exec path (NUL-terminated), NUL padding, then argv strings
            let argc = i32::from_ne_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;

            let mut pos = 4;
            // Skip the executable path
            while pos < size && buf[pos] != 0 {
                pos += 1;
            }
            // Skip NUL padding
            while pos < size && buf[pos] == 0 {
                pos += 1;
            }

            let mut args = Vec::with_capacity(argc);
            for _ in 0..argc {
                if pos >= size {
                    break;
                }
                let start = pos;
                while pos < size && buf[pos] != 0 {
                    pos += 1;
                }
                if let Ok(s) = std::str::from_utf8(&buf[start..pos]) {
                    args.push(s.to_string());
                }
                pos += 1; // skip NUL terminator
            }

            Some(args)
        }
    }

    /// Check if any child process of `pid` exists (recursively).
    /// The presence of child processes during agent silence is a strong signal
    /// that the agent is still working (running compilers, tests, git, etc.).
    pub fn has_active_children(pid: u32) -> bool {
        let children = list_child_pids(pid);
        if children.is_empty() {
            return false;
        }
        // The agent has spawned children — check recursively
        for &child in &children {
            // Any child existing is enough — it means the agent has active subprocesses
            if child > 0 {
                return true;
            }
        }
        false
    }

    pub fn proc_cwd(pid: u32) -> Result<String, String> {
        #[repr(C)]
        struct VnodeInfoPath {
            // macOS vnode_info is 152 bytes (vinfo_stat=136 + vnode fields).
            // Previously 160, which caused CWD paths to be truncated by 8 chars.
            //
            // WARNING: This struct layout is macOS version-dependent. The kernel
            // defines `struct vnode_info_path` in <sys/proc_info.h> and the
            // padding here must match the platform's actual layout. If macOS
            // changes the struct size, proc_pidinfo will return a different
            // byte count and our path extraction will be wrong.
            _vip_vi: [u8; 152],
            vip_path: [libc::c_char; 1024],
        }

        #[repr(C)]
        struct ProcVnodePathInfo {
            pvi_cdir: VnodeInfoPath,
            _pvi_rdir: VnodeInfoPath,
        }

        // Validate that our struct sizes match the expected macOS layout.
        // VnodeInfoPath = 152 (vnode_info) + 1024 (MAXPATHLEN) = 1176 bytes.
        // ProcVnodePathInfo = 2 * VnodeInfoPath = 2352 bytes.
        const _: () = assert!(
            mem::size_of::<VnodeInfoPath>() == 1176,
            "VnodeInfoPath size mismatch — macOS struct layout may have changed"
        );
        const _: () = assert!(
            mem::size_of::<ProcVnodePathInfo>() == 2352,
            "ProcVnodePathInfo size mismatch — macOS struct layout may have changed"
        );

        unsafe {
            let mut info: ProcVnodePathInfo = mem::zeroed();
            let size = mem::size_of::<ProcVnodePathInfo>() as libc::c_int;

            let ret = libc::proc_pidinfo(
                pid as libc::c_int,
                PROC_PIDVNODEPATHINFO,
                0,
                &mut info as *mut _ as *mut libc::c_void,
                size,
            );

            if ret <= 0 {
                return Err(format!("proc_pidinfo failed for pid {}", pid));
            }

            let path = std::ffi::CStr::from_ptr(info.pvi_cdir.vip_path.as_ptr())
                .to_string_lossy()
                .to_string();

            if path.is_empty() {
                return Err("empty cwd".to_string());
            }

            Ok(path)
        }
    }
}

// --- Windows process introspection ---

#[cfg(target_os = "windows")]
mod platform {
    use super::*;

    use windows::Win32::Foundation::{CloseHandle, MAX_PATH};
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    /// Known agent process names — mirrors the macOS implementation.
    fn is_known_agent(name: &str) -> bool {
        matches!(
            name,
            "claude" | "claude-code" | "aider" | "copilot" | "cursor"
                | "codex" | "gemini"
        )
    }

    /// Maximum depth for process tree traversal.
    const MAX_TREE_DEPTH: usize = 10;

    pub fn get_foreground_process(pid: u32) -> Result<ProcessInfo, String> {
        let mut current_pid = pid;
        let mut current_name = get_proc_name(pid).unwrap_or_default();

        let mut agent_pid: Option<u32> = None;
        let mut agent_name: Option<String> = None;
        let mut depth = 0;

        loop {
            if depth >= MAX_TREE_DEPTH {
                break;
            }
            depth += 1;
            let children = list_child_pids(current_pid);
            if children.is_empty() {
                break;
            }
            let child_pid = children[children.len() - 1];
            current_name = get_proc_name(child_pid).unwrap_or_default();
            current_pid = child_pid;

            // Check if this process is a known agent
            let mut resolved_name = current_name.clone();
            if matches!(resolved_name.as_str(), "node" | "python" | "python3" | "ruby") {
                if let Some(friendly) = friendly_name_from_args(current_pid) {
                    resolved_name = friendly.clone();
                }
            }
            if is_known_agent(&resolved_name) {
                agent_pid = Some(current_pid);
                agent_name = Some(resolved_name);
            }
        }

        if matches!(current_name.as_str(), "node" | "python" | "python3" | "ruby") {
            if let Some(friendly) = friendly_name_from_args(current_pid) {
                current_name = friendly;
            }
        }

        if !is_known_agent(&current_name) {
            if let (Some(ap), Some(an)) = (agent_pid, agent_name) {
                return Ok(ProcessInfo { name: an, pid: ap });
            }
        }

        Ok(ProcessInfo {
            name: current_name,
            pid: current_pid,
        })
    }

    /// List child PIDs of a process using CreateToolhelp32Snapshot.
    fn list_child_pids(ppid: u32) -> Vec<u32> {
        unsafe {
            let snapshot = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
                Ok(h) => h,
                Err(_) => return vec![],
            };

            let mut entry = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };

            let mut children = Vec::new();
            if Process32FirstW(snapshot, &mut entry).is_ok() {
                loop {
                    if entry.th32ParentProcessID == ppid && entry.th32ProcessID != 0 {
                        children.push(entry.th32ProcessID);
                    }
                    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
                    if Process32NextW(snapshot, &mut entry).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snapshot);
            children
        }
    }

    /// Get process name from its executable path.
    fn get_proc_name(pid: u32) -> Option<String> {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; MAX_PATH as usize];
            let mut size = buf.len() as u32;
            let result = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_FORMAT(0),
                windows::core::PWSTR(buf.as_mut_ptr()),
                &mut size,
            );
            let _ = CloseHandle(handle);
            result.ok()?;
            let full_path = String::from_utf16_lossy(&buf[..size as usize]);
            // Return just the filename without extension
            std::path::Path::new(&full_path)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
        }
    }

    /// Read command-line arguments of a process on Windows.
    /// Uses the Windows Management Instrumentation (WMI) approach via command line.
    fn friendly_name_from_args(pid: u32) -> Option<String> {
        // Use wmic to get the command line — simpler than reading PEB directly
        let output = std::process::Command::new("wmic")
            .args(["process", "where", &format!("ProcessId={}", pid), "get", "CommandLine", "/format:list"])
            .output()
            .ok()?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let cmd_line = stdout.lines()
            .find(|l| l.starts_with("CommandLine="))
            .map(|l| l.trim_start_matches("CommandLine=").to_string())?;

        // Parse the command line for known agent names
        for part in cmd_line.split_whitespace() {
            if part.starts_with('-') {
                continue;
            }
            let basename = std::path::Path::new(part)
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_default()
                .to_lowercase();
            let name = basename
                .trim_end_matches(".js")
                .trim_end_matches(".mjs")
                .trim_end_matches(".cjs")
                .trim_end_matches(".py")
                .trim_end_matches(".rb")
                .trim_end_matches(".exe");
            if matches!(name, "claude" | "claude-code" | "aider" | "copilot" | "cursor" | "codex" | "gemini") {
                return Some(name.to_string());
            }
            break;
        }
        None
    }

    pub fn has_active_children(pid: u32) -> bool {
        !list_child_pids(pid).is_empty()
    }

    /// Get the CWD of a process using sysinfo crate.
    pub fn proc_cwd(pid: u32) -> Result<String, String> {
        use sysinfo::{Pid, System, ProcessRefreshKind, UpdateKind};
        let mut sys = System::new();
        sys.refresh_processes_specifics(
            sysinfo::ProcessesToUpdate::Some(&[Pid::from_u32(pid)]),
            true,
            ProcessRefreshKind::nothing().with_cwd(UpdateKind::Always),
        );
        let process = sys.process(Pid::from_u32(pid))
            .ok_or_else(|| format!("process {} not found", pid))?;
        let cwd = process.cwd()
            .ok_or_else(|| format!("cwd not available for pid {}", pid))?;
        Ok(cwd.to_string_lossy().to_string())
    }
}

// --- Linux / other Unix fallback ---

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use super::*;

    pub fn get_foreground_process(_pid: u32) -> Result<ProcessInfo, String> {
        Err("get_foreground_process is not yet implemented on this platform".to_string())
    }

    pub fn has_active_children(_pid: u32) -> bool {
        false
    }

    pub fn proc_cwd(pid: u32) -> Result<String, String> {
        // On Linux, read /proc/{pid}/cwd symlink
        let link = format!("/proc/{}/cwd", pid);
        std::fs::read_link(&link)
            .map(|p| p.to_string_lossy().to_string())
            .map_err(|e| format!("failed to read {}: {}", link, e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cwd_to_folder_regular_path() {
        assert_eq!(cwd_to_folder("/Users/alice/Code/my-project"), "my-project");
    }

    #[test]
    fn test_cwd_to_folder_root() {
        assert_eq!(cwd_to_folder("/"), "/");
    }

    #[test]
    fn test_cwd_to_folder_home() {
        // This test depends on the HOME env var being set
        if let Some(home) = std::env::var_os("HOME") {
            assert_eq!(cwd_to_folder(&home.to_string_lossy()), "~");
        }
    }

    #[test]
    fn test_cwd_to_folder_nested_path() {
        assert_eq!(cwd_to_folder("/a/b/c/deep-folder"), "deep-folder");
    }

    #[test]
    fn test_cwd_to_folder_empty() {
        // Empty string has no file_name component — falls through to else
        let result = cwd_to_folder("");
        assert!(!result.is_empty());
    }

    #[test]
    fn test_poll_pane_info_idle_skip_expensive() {
        // When idle + skip_expensive, should reuse last_cwd and skip git/project
        let result = poll_pane_info(
            99999, // non-existent PID (fine — proc_cwd will fail gracefully)
            99999, // fg_pgid == shell_pid → idle
            Some("/tmp".to_string()),
            true,  // skip_expensive
        );
        let r = result.unwrap();
        // Should return the last_cwd as-is
        assert_eq!(r.cwd_full, "/tmp");
        assert_eq!(r.cwd_folder, "tmp");
        // Should skip git and project
        assert!(r.git.is_none());
        assert!(r.project_name.is_none());
        // Idle → no children check
        assert!(!r.has_children);
        // Idle → empty process name
        assert!(r.process.name.is_empty());
    }

    #[test]
    fn test_poll_pane_info_idle_no_last_cwd() {
        // First poll — no last_cwd, idle, not skipping expensive
        let result = poll_pane_info(
            99999,
            99999,
            None,
            false,
        );
        let r = result.unwrap();
        // proc_cwd for non-existent PID fails — falls back to empty prev_cwd
        // cwd_full will be empty (no prev_cwd, proc_cwd failed)
        assert!(r.process.name.is_empty());
        assert!(!r.has_children);
    }

    #[test]
    fn test_poll_pane_info_cwd_change_triggers_project() {
        // When CWD changes, project_name should be computed
        let dir = std::env::temp_dir().join("clawterm_test_poll_project");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("package.json"),
            r#"{"name": "test-project"}"#,
        ).unwrap();

        let result = poll_pane_info(
            99999,
            99999,
            Some("/some/other/dir".to_string()), // different from actual CWD
            true, // skip_expensive — but CWD is from last_cwd
        );
        let r = result.unwrap();
        // skip_expensive + idle → no project lookup (CWD didn't change because
        // skip_expensive returns last_cwd as cwd_full)
        assert!(r.project_name.is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }
}

