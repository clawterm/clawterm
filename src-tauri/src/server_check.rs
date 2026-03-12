use std::net::TcpStream;
use std::time::Duration;

/// Check if a TCP port is open on localhost.
#[tauri::command]
pub fn check_port(port: u16) -> bool {
    TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_secs(2),
    )
    .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unbound_port_returns_false() {
        // Port 0 is never bound; high ephemeral port is very unlikely to be in use
        assert!(!check_port(49999));
    }

    #[test]
    fn test_bound_port_returns_true() {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(check_port(port));
        drop(listener);
    }
}
