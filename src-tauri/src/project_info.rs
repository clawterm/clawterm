use serde::Deserialize;

/// Read project manifest files to extract a project name.
/// Checks package.json, Cargo.toml, pyproject.toml, go.mod in order.
/// Falls back to the directory name.
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
        struct CargoToml {
            package: Option<CargoPackage>,
        }
        #[derive(Deserialize)]
        struct CargoPackage {
            name: Option<String>,
        }
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
        struct PyProjectToml {
            project: Option<PyProject>,
        }
        #[derive(Deserialize)]
        struct PyProject {
            name: Option<String>,
        }
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
