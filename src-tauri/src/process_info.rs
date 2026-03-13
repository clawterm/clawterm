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
    if let Some(home) = std::env::var_os("HOME") {
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

// --- macOS process introspection ---

mod platform {
    use super::*;
    use std::mem;

    extern "C" {
        fn proc_listchildpids(ppid: libc::c_int, buffer: *mut libc::c_void, buffersize: libc::c_int) -> libc::c_int;
        fn proc_name(pid: libc::c_int, buffer: *mut libc::c_void, buffersize: u32) -> libc::c_int;
    }

    const PROC_PIDVNODEPATHINFO: libc::c_int = 9;

    pub fn get_foreground_process(pid: u32) -> Result<ProcessInfo, String> {
        let mut current_pid = pid;
        let mut current_name = get_proc_name(pid).unwrap_or_default();

        loop {
            let children = list_child_pids(current_pid);
            if children.is_empty() {
                break;
            }
            // Pick the last (newest) child — highest PID is most likely
            // the foreground process when background jobs are present
            let child_pid = children[children.len() - 1];
            current_name = get_proc_name(child_pid).unwrap_or_default();
            current_pid = child_pid;
        }

        // If the process name is a runtime (node, python, etc.), check
        // the command-line args for a more descriptive program name.
        if matches!(current_name.as_str(), "node" | "python" | "python3" | "ruby") {
            if let Some(friendly) = friendly_name_from_args(current_pid) {
                current_name = friendly;
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

            // Over-allocate to handle TOCTOU race (children spawned between calls)
            let capacity = (count as usize) + 16;
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
            Some(
                std::str::from_utf8(&buf[..ret as usize])
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
            if matches!(name, "claude" | "claude-code" | "aider" | "copilot" | "cursor") {
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

    pub fn proc_cwd(pid: u32) -> Result<String, String> {
        #[repr(C)]
        struct VnodeInfoPath {
            _vip_vi: [u8; 160],
            vip_path: [libc::c_char; 1024],
        }

        #[repr(C)]
        struct ProcVnodePathInfo {
            pvi_cdir: VnodeInfoPath,
            _pvi_rdir: VnodeInfoPath,
        }

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
}
