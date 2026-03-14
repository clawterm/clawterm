const COMMANDS: &[&str] = &["spawn", "write", "read", "resize", "kill", "exitstatus", "child_pid", "foreground_pid", "close_session", "clear_sessions"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
