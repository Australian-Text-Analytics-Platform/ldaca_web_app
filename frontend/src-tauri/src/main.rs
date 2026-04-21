//! LDaCA Text Analytics – Tauri desktop entry point.
//!
//! Responsibilities (kept minimal, everything else is delegated):
//! 1. Pick a free port for the backend (`backend::find_available_port`).
//! 2. Inject `window.__BACKEND_URL__` into the webview *before* the React
//!    bundle loads, so `src/api/env.ts` sees it on first render.
//! 3. Locate the bundled `uv` binary + backend project (`runtime::locate`)
//!    and spawn `uv run … ldaca_web_app.cli --backend` (`backend::spawn`).
//!    uv materialises the Python environment into the user's app-data dir
//!    on first launch and reuses it thereafter.
//! 4. Terminate the backend on window close / app exit.
//!
//! Health polling is handled by the frontend (`useBackendHealth`), so this
//! launcher does not block waiting for `/health`.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;
mod platform;
mod runtime;

use tauri::{Manager, RunEvent, State, WindowEvent};

use backend::{BackendState, BACKEND_HOST};

fn main() {
    let Some(port) = backend::find_available_port(8001, 8010) else {
        eprintln!("No available ports found in range 8001-8010");
        return;
    };
    let backend_url = format!("http://{}:{}", BACKEND_HOST, port);
    println!("Backend will run on: {}", backend_url);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(BackendState::new())
        .setup(move |app| {
            configure_main_window(app, &backend_url)?;
            start_backend(app, port)?;
            Ok(())
        })
        .on_window_event(handle_window_event)
        .build(tauri::generate_context!());

    match app {
        Ok(app) => app.run(handle_run_event),
        Err(err) => eprintln!("Error while building Tauri application: {}", err),
    }
}

/// Apply zoom and inject the backend URL before any page content loads.
///
/// The `eval` must run in `setup` (not after the window is shown) so that
/// `window.__BACKEND_URL__` is defined by the time React's entry module is
/// evaluated — `src/api/env.ts` reads it synchronously during module init.
fn configure_main_window(
    app: &tauri::App,
    backend_url: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;

    // Native webview zoom avoids CSS layout artifacts that CSS-level zoom causes.
    window.set_zoom(0.95)?;

    window.eval(format!(
        r#"window.__BACKEND_URL__ = "{backend_url}";
           console.log('[Tauri] Backend URL injected:', window.__BACKEND_URL__);"#
    ))?;

    Ok(())
}

fn start_backend(app: &tauri::App, port: u16) -> Result<(), Box<dyn std::error::Error>> {
    let runtime = runtime::locate(app.handle())?;
    let process = backend::spawn(app.handle(), &runtime, port)?;
    let pid = process.pid();
    let state: State<BackendState> = app.state();
    *state.process.lock().unwrap() = Some(process);
    println!(
        "Backend launched (pid {}) – health polling handled by frontend",
        pid
    );
    Ok(())
}

/// On the first close request, stop the backend in a background thread and
/// then re-issue `window.close()`. On subsequent close requests the process
/// handle is already `None`, so we let the window close normally.
fn handle_window_event(window: &tauri::Window, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };

    let state: State<BackendState> = window.state();
    let process = state.process.lock().unwrap().take();

    let Some(process) = process else {
        // Second entry: shutdown already ran; allow the window to close.
        return;
    };

    api.prevent_close();
    let window = window.clone();
    std::thread::spawn(move || {
        println!("Shutting down backend PID {}", process.pid());
        process.shutdown();
        let _ = window.close();
    });
}

/// Safety net: if the app exits through a path that skips window close
/// (e.g. Cmd+Q on macOS), ensure the backend child is terminated.
fn handle_run_event(handle: &tauri::AppHandle, event: RunEvent) {
    if let RunEvent::ExitRequested { .. } = event {
        if let Some(state) = handle.try_state::<BackendState>() {
            if let Some(process) = state.process.lock().ok().and_then(|mut g| g.take()) {
                println!("Exit requested – terminating backend pid {}", process.pid());
                process.shutdown();
            }
        }
    }
}
