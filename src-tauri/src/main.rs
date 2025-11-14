// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};
use tauri::{Manager, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// Holds the backend URL, process, and PID
struct BackendState {
    url: String,
    process: Arc<Mutex<Option<CommandChild>>>,
    pid: Arc<Mutex<Option<u32>>>,
    closing: Arc<Mutex<bool>>, // track if graceful closing is in progress
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

/// Check if a process is running (Unix)
#[cfg(unix)]
fn is_process_running(pid: u32) -> bool {
    use std::process::Command;
    if let Ok(output) = Command::new("kill").arg("-0").arg(pid.to_string()).output() {
        output.status.success()
    } else {
        false
    }
}

/// Send SIGTERM to a process (Unix)
#[cfg(unix)]
fn send_sigterm(pid: u32) {
    use std::process::Command;
    let _ = Command::new("kill")
        .arg("-TERM")
        .arg(pid.to_string())
        .output();
}

/// Wait for a process to exit, with timeout in milliseconds (Unix)
#[cfg(unix)]
fn wait_for_exit(pid: u32, timeout_ms: u64) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed() < std::time::Duration::from_millis(timeout_ms) {
        if !is_process_running(pid) {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    !is_process_running(pid)
}

/// Force kill a process by PID on Unix systems
#[cfg(unix)]
fn force_kill_process(pid: u32) -> Result<(), String> {
    use std::process::Command;

    println!("Force killing process tree with root PID {}...", pid);

    // Get all child processes using pgrep
    let children_result = Command::new("pgrep")
        .arg("-P")
        .arg(pid.to_string())
        .output();

    let mut all_pids = vec![pid];
    if let Ok(output) = children_result {
        if output.status.success() {
            let children_str = String::from_utf8_lossy(&output.stdout);
            for line in children_str.lines() {
                if let Ok(child_pid) = line.trim().parse::<u32>() {
                    all_pids.push(child_pid);
                }
            }
        }
    }

    println!("Found process tree: {:?}", all_pids);

    // Force kill all processes with SIGKILL
    for &proc_pid in &all_pids {
        let kill_result = Command::new("kill")
            .arg("-9")
            .arg(proc_pid.to_string())
            .output();

        if let Ok(output) = kill_result {
            if output.status.success() {
                println!("SIGKILL sent to PID {}", proc_pid);
            }
        }
    }

    Ok(())
}

/// Force kill a process by PID on Windows
#[cfg(windows)]
fn force_kill_process(pid: u32) -> Result<(), String> {
    use std::process::Command;

    println!("Force killing process with PID {}...", pid);

    let kill_result = Command::new("taskkill")
        .arg("/F")
        .arg("/PID")
        .arg(pid.to_string())
        .output();

    match kill_result {
        Ok(output) => {
            if output.status.success() {
                println!("Successfully killed process PID {}", pid);
                Ok(())
            } else {
                let err = String::from_utf8_lossy(&output.stderr);
                Err(format!("Failed to kill PID {}: {}", pid, err))
            }
        }
        Err(e) => Err(format!("Failed to execute taskkill command: {}", e)),
    }
}

fn main() {
    // Find an available port for the backend (try 8001-8010)
    let backend_port =
        find_available_port(8001, 8010).expect("No available ports found in range 8001-8010");

    let backend_url = format!("http://localhost:{}", backend_port);
    println!("Backend will run on: {}", backend_url);

    let backend_state = BackendState {
        url: backend_url.clone(),
        process: Arc::new(Mutex::new(None)),
        pid: Arc::new(Mutex::new(None)),
        closing: Arc::new(Mutex::new(false)),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(backend_state)
        .invoke_handler(tauri::generate_handler![get_backend_url])
        .setup(move |app| {
            let window = app.get_webview_window("main").unwrap();

            // Inject backend URL as an initialization script BEFORE any page content loads
            // This ensures window.__BACKEND_URL__ is available when React boots
            window.eval(&format!(
                r#"
                window.__BACKEND_URL__ = "{}";
                console.log('[Tauri] Backend URL injected:', window.__BACKEND_URL__);
                "#,
                backend_url
            ))?;

            // Start the backend sidecar
            let sidecar_command = app
                .shell()
                .sidecar("ldaca_web_app_backend_bundle/ldaca_web_app_backend")?;

            let (mut rx, child) = sidecar_command
                .env("BACKEND_PORT", backend_port.to_string())
                .env("LDACA_BACKEND_PORT", backend_port.to_string())
                .spawn()?;

            // Store the PID and child process so we can kill it later
            let child_pid = child.pid();
            let state: State<BackendState> = app.state();
            *state.process.lock().unwrap() = Some(child);
            *state.pid.lock().unwrap() = Some(child_pid);

            println!(
                "Backend sidecar started on port {} with PID {}",
                backend_port, child_pid
            );

            // Spawn a thread to read and print backend output
            std::thread::spawn(move || {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = futures::executor::block_on(async { rx.recv().await }) {
                    match event {
                        CommandEvent::Stdout(line) => {
                            println!("[Backend] {}", String::from_utf8_lossy(&line))
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("[Backend] {}", String::from_utf8_lossy(&line))
                        }
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
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state: State<BackendState> = window.state();

                // If we're already closing, allow the window to close now
                let already_closing = {
                    let mut guard = state.closing.lock().unwrap();
                    let was = *guard;
                    if !was {
                        *guard = true;
                    }
                    was
                };

                if already_closing {
                    // Do not prevent close; the background thread will have handled shutdown
                    return;
                }

                // First time: prevent close and start graceful shutdown
                api.prevent_close();

                let pid_opt = state.pid.lock().unwrap().take();
                let window_clone = window.clone();
                std::thread::spawn(move || {
                    if let Some(pid) = pid_opt {
                        #[cfg(unix)]
                        {
                            println!(
                                "Sending SIGTERM to backend PID {} and waiting to exit...",
                                pid
                            );
                            send_sigterm(pid);
                            if wait_for_exit(pid, 7000) {
                                println!("Backend exited gracefully");
                            } else {
                                println!("Backend did not exit in time; forcing termination...");
                                let _ = force_kill_process(pid);
                            }
                        }
                        #[cfg(windows)]
                        {
                            let _ = force_kill_process(pid);
                        }
                    }
                    let _ = window_clone.close();
                });
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Handle app exit to ensure backend is terminated gracefully
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app_handle.try_state::<BackendState>() {
                    println!("App exiting - waiting for backend to terminate gracefully...");
                    let pid_opt = state.pid.lock().ok().and_then(|mut guard| guard.take());
                    if let Some(pid) = pid_opt {
                        #[cfg(unix)]
                        {
                            send_sigterm(pid);
                            if !wait_for_exit(pid, 7000) {
                                let _ = force_kill_process(pid);
                            }
                        }
                        #[cfg(windows)]
                        {
                            let _ = force_kill_process(pid);
                        }
                    }
                }
            }
        });
}
