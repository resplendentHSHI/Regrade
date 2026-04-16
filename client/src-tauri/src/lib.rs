use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;

/// Start a local HTTP server on port 9876, open the OAuth URL in the browser,
/// and wait for the callback. Returns the authorization code.
#[tauri::command]
async fn start_oauth_flow(auth_url: String) -> Result<String, String> {
    // Bind the callback server first
    let listener = TcpListener::bind("127.0.0.1:9876").map_err(|e| format!("Failed to bind port 9876: {e}"))?;

    // Open the browser to the OAuth URL
    open::that(&auth_url).map_err(|e| format!("Failed to open browser: {e}"))?;

    // Wait for one incoming connection (the OAuth redirect)
    let (mut stream, _) = listener.accept().map_err(|e| format!("Failed to accept connection: {e}"))?;

    let mut reader = BufReader::new(stream.try_clone().map_err(|e| format!("Clone error: {e}"))?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line).map_err(|e| format!("Read error: {e}"))?;

    // Parse the code from "GET /callback?code=XXXX&scope=... HTTP/1.1"
    let code = request_line
        .split_whitespace()
        .nth(1)  // "/callback?code=XXXX&scope=..."
        .and_then(|path| {
            url::Url::parse(&format!("http://localhost{path}")).ok()
        })
        .and_then(|url| {
            url.query_pairs()
                .find(|(k, _)| k == "code")
                .map(|(_, v)| v.to_string())
        })
        .ok_or_else(|| "No authorization code in callback".to_string())?;

    // Send a nice response to the browser
    let html = r#"<!DOCTYPE html>
<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="text-align:center">
<h1>Signed in!</h1>
<p>You can close this tab and return to Poko.</p>
</div>
</body></html>"#;

    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    );
    stream.write_all(response.as_bytes()).ok();
    stream.flush().ok();

    Ok(code)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![start_oauth_flow])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
