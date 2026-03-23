use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct ProcessInfo {
    pub name: String,
    pub pid: u32,
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

/// Read project manifest files in the given directory to extract a project name.
#[tauri::command]
pub fn get_project_info(dir: String) -> String {
    let path = match std::fs::canonicalize(&dir) {
        Ok(p) => p,
        Err(_) => return String::new(),
    };
    if !path.is_absolute() {
        return String::new();
    }

    // package.json
    if let Ok(content) = std::fs::read_to_string(path.join("package.json")) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(name) = val.get("name").and_then(|n| n.as_str()) {
                if !name.is_empty() {
                    return name.to_string();
                }
            }
        }
    }

    // Cargo.toml
    if let Ok(content) = std::fs::read_to_string(path.join("Cargo.toml")) {
        #[derive(Deserialize)]
        struct CargoToml { package: Option<CargoPackage> }
        #[derive(Deserialize)]
        struct CargoPackage { name: Option<String> }
        if let Ok(parsed) = toml::from_str::<CargoToml>(&content) {
            if let Some(name) = parsed.package.and_then(|p| p.name) {
                if !name.is_empty() {
                    return name;
                }
            }
        }
    }

    // pyproject.toml
    if let Ok(content) = std::fs::read_to_string(path.join("pyproject.toml")) {
        #[derive(Deserialize)]
        struct PyProjectToml { project: Option<PyProject> }
        #[derive(Deserialize)]
        struct PyProject { name: Option<String> }
        if let Ok(parsed) = toml::from_str::<PyProjectToml>(&content) {
            if let Some(name) = parsed.project.and_then(|p| p.name) {
                if !name.is_empty() {
                    return name;
                }
            }
        }
    }

    // go.mod
    if let Ok(content) = std::fs::read_to_string(path.join("go.mod")) {
        if let Some(first_line) = content.lines().next() {
            if first_line.starts_with("module ") {
                let module = first_line.trim_start_matches("module ").trim();
                // Use last path segment
                if let Some(last) = module.rsplit('/').next() {
                    if !last.is_empty() {
                        return last.to_string();
                    }
                }
            }
        }
    }

    // Fallback: directory name
    path.file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Check if a process has active child processes (i.e., the agent spawned
/// subprocesses like compilers, test runners, git, etc. that are still running).
/// Returns true if the process tree is actively doing work.
#[tauri::command]
pub fn has_active_children(pid: u32) -> bool {
    platform::has_active_children(pid)
}

/// Parse a HEAD file to extract the branch name or short commit hash.
fn parse_head_file(head_path: &std::path::Path) -> String {
    if let Ok(content) = std::fs::read_to_string(head_path) {
        let content = content.trim();
        // Format: "ref: refs/heads/branch-name"
        if let Some(branch) = content.strip_prefix("ref: refs/heads/") {
            return branch.to_string();
        }
        // Detached HEAD — return short hash
        if content.len() >= 8 {
            return content[..8].to_string();
        }
    }
    String::new()
}

/// Read the current git branch for a directory by parsing .git/HEAD.
/// Walks up the directory tree to find the nearest .git entry.
/// Handles both regular repos (.git is a directory) and worktrees (.git is a file
/// containing `gitdir: <path>`).
#[tauri::command]
pub fn get_git_branch(dir: String) -> String {
    let mut path = match std::fs::canonicalize(&dir) {
        Ok(p) => p,
        Err(_) => return String::new(),
    };

    // Walk up to find .git (directory or file)
    loop {
        let git_entry = path.join(".git");
        if git_entry.exists() {
            if git_entry.is_dir() {
                // Regular repo: .git/HEAD
                return parse_head_file(&git_entry.join("HEAD"));
            } else if git_entry.is_file() {
                // Worktree: .git is a file containing "gitdir: <path>"
                if let Ok(content) = std::fs::read_to_string(&git_entry) {
                    let content = content.trim();
                    if let Some(gitdir) = content.strip_prefix("gitdir: ") {
                        // gitdir can be relative or absolute
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

/// Get structured git status for a directory.
/// Uses `git status --porcelain=v2 --branch` for efficient single-command output.
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
            // Format: "+N -M"
            for part in rest.split_whitespace() {
                if let Some(n) = part.strip_prefix('+') {
                    ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix('-') {
                    behind = n.parse().unwrap_or(0);
                }
            }
        } else if line.starts_with("1 ") || line.starts_with("2 ") {
            // Changed entry: "1 XY ..." or "2 XY ..." (renamed)
            // X = index status, Y = worktree status
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

    // Detect if this is a worktree by checking if .git is a file
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

    pub fn get_foreground_process(pid: u32) -> Result<ProcessInfo, String> {
        let mut current_pid = pid;
        let mut current_name = get_proc_name(pid).unwrap_or_default();

        let mut agent_pid: Option<u32> = None;
        let mut agent_name: Option<String> = None;

        loop {
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

    pub fn get_foreground_process(pid: u32) -> Result<ProcessInfo, String> {
        let mut current_pid = pid;
        let mut current_name = get_proc_name(pid).unwrap_or_default();

        let mut agent_pid: Option<u32> = None;
        let mut agent_name: Option<String> = None;

        loop {
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
    use std::fs;

    #[test]
    fn test_get_project_info_package_json() {
        let dir = std::env::temp_dir().join("clawterm_test_pkg");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("package.json"),
            r#"{"name": "my-test-project", "version": "1.0.0"}"#,
        )
        .unwrap();
        let result = get_project_info(dir.to_string_lossy().to_string());
        assert_eq!(result, "my-test-project");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_get_project_info_cargo_toml() {
        let dir = std::env::temp_dir().join("clawterm_test_cargo");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("Cargo.toml"),
            "[package]\nname = \"my-rust-project\"\nversion = \"0.1.0\"\n",
        )
        .unwrap();
        let result = get_project_info(dir.to_string_lossy().to_string());
        assert_eq!(result, "my-rust-project");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_get_project_info_go_mod() {
        let dir = std::env::temp_dir().join("clawterm_test_go");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("go.mod"), "module github.com/user/myapp\n").unwrap();
        let result = get_project_info(dir.to_string_lossy().to_string());
        assert_eq!(result, "myapp");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_get_project_info_fallback_to_dir_name() {
        let dir = std::env::temp_dir().join("clawterm_test_empty");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let result = get_project_info(dir.to_string_lossy().to_string());
        assert_eq!(result, "clawterm_test_empty");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_get_git_branch_regular_repo() {
        let dir = std::env::temp_dir().join("clawterm_test_git_regular");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::write(dir.join(".git").join("HEAD"), "ref: refs/heads/main\n").unwrap();
        let result = get_git_branch(dir.to_string_lossy().to_string());
        assert_eq!(result, "main");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_get_git_branch_worktree() {
        // Simulate a worktree: .git is a file pointing to a gitdir
        let base = std::env::temp_dir().join("clawterm_test_git_worktree");
        let _ = fs::remove_dir_all(&base);

        // Create the main repo gitdir structure
        let main_git = base.join("main_repo").join(".git").join("worktrees").join("feature-x");
        fs::create_dir_all(&main_git).unwrap();
        fs::write(main_git.join("HEAD"), "ref: refs/heads/feature-x\n").unwrap();

        // Create the worktree directory with a .git file
        let worktree = base.join("worktree-feature-x");
        fs::create_dir_all(&worktree).unwrap();
        let gitdir_line = format!("gitdir: {}\n", main_git.to_string_lossy());
        fs::write(worktree.join(".git"), &gitdir_line).unwrap();

        let result = get_git_branch(worktree.to_string_lossy().to_string());
        assert_eq!(result, "feature-x");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn test_get_git_branch_detached_head() {
        let dir = std::env::temp_dir().join("clawterm_test_git_detached");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::write(dir.join(".git").join("HEAD"), "abc12345def67890\n").unwrap();
        let result = get_git_branch(dir.to_string_lossy().to_string());
        assert_eq!(result, "abc12345");
        let _ = fs::remove_dir_all(&dir);
    }
}
