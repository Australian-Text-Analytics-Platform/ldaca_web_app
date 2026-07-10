mod backend_process;
mod download;
mod platform;
mod runtime;

use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use backend_process::{find_available_port, BackendProcess, BACKEND_HOST};
use tauri::{Manager, State};

/// Tauri-owned application state for the local backend lifecycle.
///
/// Managed by [`run`]. The process has one owner behind one mutex; window-close
/// and app-exit handlers take the same value, making repeated shutdown paths
/// harmless without nested `Arc<Mutex<...>>` coordination.
struct BackendState {
    url: String,
    process: Mutex<Option<BackendProcess>>,
    closing: AtomicBool,
}

#[tauri::command]
fn get_backend_url(state: State<'_, BackendState>) -> String {
    state.url.clone()
}

fn boxed_error(message: impl Into<String>) -> Box<dyn std::error::Error> {
    Box::new(io::Error::other(message.into()))
}

/// Assemble and run the desktop shell around the React app and local backend.
///
/// Called only by `main.rs`. Runtime resolution, process lifecycle, platform
/// behavior, and native downloads live in focused modules; this function owns
/// Tauri wiring and the ordering between those domains.
pub fn run() {
    platform::reap_stale_backend();

    let Some(backend_port) = find_available_port(8001, 8010) else {
        eprintln!("No available ports found in range 8001-8010");
        return;
    };
    let backend_url = format!("http://{BACKEND_HOST}:{backend_port}");
    println!("Backend will run on: {backend_url}");

    let state = BackendState {
        url: backend_url.clone(),
        process: Mutex::new(None),
        closing: AtomicBool::new(false),
    };

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            get_backend_url,
            download::download_to_downloads
        ])
        .setup(move |app| {
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| boxed_error("Main window not found"))?;
            window.set_zoom(0.95)?;
            window.eval(format!(
                r#"window.__BACKEND_URL__ = "{backend_url}";
                console.log('[Tauri] Backend URL injected:', window.__BACKEND_URL__);"#
            ))?;

            let layout = runtime::locate_backend_runtime(app.handle())?;
            let process = BackendProcess::spawn(&layout, backend_port)?;
            let pid = process.pid();
            platform::write_pidfile(pid);
            let state: State<'_, BackendState> = app.state();
            let mut owner = state
                .process
                .lock()
                .map_err(|_| boxed_error("Backend process lock is poisoned"))?;
            *owner = Some(process);
            println!(
                "Backend launched at: {backend_url} (pid {pid}) – health polling delegated to frontend"
            );
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state: State<'_, BackendState> = window.state();
                if state.closing.swap(true, Ordering::AcqRel) {
                    return;
                }

                api.prevent_close();
                let process = state
                    .process
                    .lock()
                    .map(|mut owner| owner.take())
                    .unwrap_or_else(|_| {
                        eprintln!("Backend process lock is poisoned during close");
                        None
                    });
                let window = window.clone();
                std::thread::spawn(move || {
                    if let Some(mut process) = process {
                        if let Err(error) = process.shutdown() {
                            eprintln!("Backend shutdown failed: {error}");
                        }
                    }
                    platform::delete_pidfile();
                    if let Err(error) = window.close() {
                        eprintln!("Failed to close desktop window: {error}");
                    }
                });
            }
        })
        .build(tauri::generate_context!());

    match app {
        Ok(app) => app.run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app_handle.try_state::<BackendState>() {
                    let process = state
                        .process
                        .lock()
                        .map(|mut owner| owner.take())
                        .unwrap_or_else(|_| {
                            eprintln!("Backend process lock is poisoned during exit");
                            None
                        });
                    if let Some(mut process) = process {
                        if let Err(error) = process.shutdown() {
                            eprintln!("Backend shutdown failed during app exit: {error}");
                        }
                    }
                }
                platform::delete_pidfile();
            }
        }),
        Err(error) => eprintln!("Error while building Tauri application: {error}"),
    }
}
