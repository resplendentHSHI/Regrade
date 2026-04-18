use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::time::Duration;

use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    Manager,
};

/// Start a local HTTP server on port 9876, open the OAuth URL in the browser,
/// and wait for the callback. Returns the authorization code.
///
/// Times out after 3 minutes so the user can retry if they cancel.
#[tauri::command]
async fn start_oauth_flow(auth_url: String) -> Result<String, String> {
    // Bind the callback server first.
    // If a previous attempt is still holding the port, retry a few times.
    let mut listener = None;
    for _ in 0..5 {
        match TcpListener::bind("127.0.0.1:9876") {
            Ok(l) => {
                listener = Some(l);
                break;
            }
            Err(_) => {
                std::thread::sleep(Duration::from_millis(300));
            }
        }
    }
    let listener = listener.ok_or_else(|| {
        "Port 9876 is in use. Close other tabs and try again.".to_string()
    })?;

    // Non-blocking accept with 3-minute timeout (user might close the tab)
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("nonblocking: {e}"))?;

    // Open the browser to the OAuth URL
    open::that(&auth_url).map_err(|e| format!("Failed to open browser: {e}"))?;

    // Poll for a connection up to 180 seconds
    let deadline = std::time::Instant::now() + Duration::from_secs(180);
    let (mut stream, _) = loop {
        if std::time::Instant::now() > deadline {
            return Err("Sign-in timed out. Tap Sign In to try again.".to_string());
        }
        match listener.accept() {
            Ok(pair) => break pair,
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(format!("Failed to accept connection: {e}")),
        }
    };
    stream
        .set_nonblocking(false)
        .map_err(|e| format!("blocking: {e}"))?;

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![start_oauth_flow])
        .setup(|app| {
            // ── System tray: keeps Poko running when the window is closed ──
            let show = MenuItemBuilder::with_id("show", "Show Poko").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&show)
                .separator()
                .item(&quit)
                .build()?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Poko")
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Click tray icon → show the window
                    if let tauri::tray::TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(win) = tray.app_handle().get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        // Override close: hide to tray instead of quitting
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Prevent the default close — hide the window instead.
                // The tray icon "Show Poko" or "Quit" handles bringing it back / exiting.
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
