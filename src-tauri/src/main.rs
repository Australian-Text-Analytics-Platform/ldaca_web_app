// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, State};
use tauri_plugin_shell::ShellExt;
use std::sync::{Arc, Mutex};
use tauri_plugin_shell::process::CommandChild;

/// Holds the backend URL and process
struct BackendState {
    url: String,
    process: Arc<Mutex<Option<CommandChild>>>,
}

/// Find an available port in the given range
fn find_available_port(start: u16, end: u16) -> Option<u16> {
    (start..=end).find(|port| portpicker::is_free(*port))
}

/// Tauri command to get the backend URL
#[tauri::command]
fn get_backend_url(state: State<BackendState>) -> String {
    state.url.clone()
}

fn main() {
    // Find an available port for the backend (try 8001-8010)
    let backend_port = find_available_port(8001, 8010)
        .expect("No available ports found in range 8001-8010");
    
    let backend_url = format!("http://localhost:{}", backend_port);
    println!("Backend will run on: {}", backend_url);

    let backend_state = BackendState {
        url: backend_url.clone(),
        process: Arc::new(Mutex::new(None)),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(backend_state)
        .invoke_handler(tauri::generate_handler![get_backend_url])
        .setup(move |app| {
            // Inject the backend URL as an initialization script BEFORE the window is created
            let window = app.get_webview_window("main").unwrap();
            let init_script = format!(
                r#"window.__BACKEND_URL__ = "{}";"#,
                backend_url
            );
            window.eval(&init_script)?;
            
            // Start the backend sidecar
            let sidecar_command = app.shell().sidecar("ldaca_web_app_backend")?;
            
            let (mut rx, child) = sidecar_command
                .env("BACKEND_PORT", backend_port.to_string())
                .env("LDACA_BACKEND_PORT", backend_port.to_string())
                .spawn()?;

            // Store the child process so we can kill it later
            let state: State<BackendState> = app.state();
            *state.process.lock().unwrap() = Some(child);

            println!("Backend sidecar started on port {}", backend_port);

            // Spawn a thread to read and print backend output
            std::thread::spawn(move || {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = futures::executor::block_on(async { rx.recv().await }) {
                    match event {
                        CommandEvent::Stdout(line) => println!("[Backend] {}", String::from_utf8_lossy(&line)),
                        CommandEvent::Stderr(line) => eprintln!("[Backend] {}", String::from_utf8_lossy(&line)),
                        CommandEvent::Error(err) => eprintln!("[Backend Error] {}", err),
                        CommandEvent::Terminated(payload) => {
                            println!("[Backend] Process terminated with code: {:?}", payload.code);
                            break;
                        }
                        _ => {}
                    }
                }
            });

            // Wait a bit for the backend to start
            std::thread::sleep(std::time::Duration::from_secs(3));

            println!("Backend ready at: {}", backend_url);

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Kill the backend process when window closes
                let state: State<BackendState> = window.state();
                if let Some(child) = state.process.lock().unwrap().take() {
                    println!("Killing backend process...");
                    let _ = child.kill();
                };
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
