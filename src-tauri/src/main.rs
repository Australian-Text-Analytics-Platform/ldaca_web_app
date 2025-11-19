// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{self, BufRead, BufReader};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::ShellExt;

/// Holds the backend URL, process, and PID
struct BackendState {
    url: String,
    process: Arc<Mutex<Option<BackendProcessHandle>>>,
    closing: Arc<Mutex<bool>>, // track if graceful closing is in progress
}

enum BackendProcessInner {
    Sidecar(tauri_plugin_shell::process::CommandChild),
    Manual(std::process::Child),
}

struct BackendProcessHandle {
    pid: u32,
    inner: BackendProcessInner,
}

impl BackendProcessHandle {
    fn new_sidecar(child: tauri_plugin_shell::process::CommandChild) -> Self {
        let pid = child.pid();
        Self {
            pid,
            inner: BackendProcessInner::Sidecar(child),
        }
    }

    fn new_manual(child: std::process::Child) -> Self {
        let pid = child.id();
        Self {
            pid,
            inner: BackendProcessInner::Manual(child),
        }
    }

    fn pid(&self) -> u32 {
        self.pid
    }

    fn shutdown(mut self) {
        #[cfg(unix)]
        {
            match send_sigterm(self.pid) {
                Ok(_) => {
                    if self
                        .inner
                        .wait_for_exit(self.pid, Duration::from_millis(7000))
                    {
                        println!("Backend {} exited gracefully", self.pid);
                        return;
                    }
                    println!(
                        "Backend {} did not exit after SIGTERM; requesting immediate termination",
                        self.pid
                    );
                }
                Err(err) => {
                    eprintln!("Failed to send SIGTERM to backend {}: {}", self.pid, err);
                }
            }
        }

        if let Err(err) = self.inner.terminate_now() {
            eprintln!("Failed to stop backend {} cleanly: {}", self.pid, err);
        }
    }
}

impl BackendProcessInner {
    #[cfg(unix)]
    fn wait_for_exit(&mut self, pid: u32, timeout: Duration) -> bool {
        match self {
            BackendProcessInner::Sidecar(_) => wait_for_exit(pid, timeout),
            BackendProcessInner::Manual(child) => wait_for_child_exit(child, timeout),
        }
    }

    fn terminate_now(self) -> io::Result<()> {
        match self {
            BackendProcessInner::Sidecar(child) => child
                .kill()
                .map_err(|err| io::Error::new(io::ErrorKind::Other, err.to_string())),
            BackendProcessInner::Manual(mut child) => {
                child.kill()?;
                let _ = child.wait();
                Ok(())
            }
        }
    }
}

const DEV_BACKEND_LAUNCHER: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../backend/dist-tauri/backend-runtime/run_backend.sh"
);

const BACKEND_HOST: &str = "127.0.0.1";

fn locate_backend_launcher() -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("LDACA_BACKEND_LAUNCHER") {
        let candidate = PathBuf::from(custom);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    let dev_path = PathBuf::from(DEV_BACKEND_LAUNCHER);
    if dev_path.exists() {
        return Some(dev_path);
    }

    const RELATIVE_SEARCH_PATHS: &[&str] = &[
        "backend/dist-tauri/backend-runtime/run_backend.sh",
        "_up_/backend/dist-tauri/backend-runtime/run_backend.sh",
        "dist-tauri/backend-runtime/run_backend.sh",
        "Resources/backend/dist-tauri/backend-runtime/run_backend.sh",
        "run_backend.sh",
    ];

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(mut dir) = exe_path.parent().map(Path::to_path_buf) {
            loop {
                for relative in RELATIVE_SEARCH_PATHS {
                    let candidate = dir.join(relative);
                    if candidate.exists() {
                        return Some(candidate);
                    }
                }

                if !dir.pop() {
                    break;
                }
            }
        }
    }

    None
}

fn pipe_child_output<R>(reader: R, is_stderr: bool)
where
    R: std::io::Read + Send + 'static,
{
    std::thread::spawn(move || {
        let reader = BufReader::new(reader);
        for line in reader.lines() {
            match line {
                Ok(text) => {
                    if is_stderr {
                        eprintln!("[Backend] {}", text);
                    } else {
                        println!("[Backend] {}", text);
                    }
                }
                Err(err) => {
                    eprintln!("[Backend] Failed to read backend output: {}", err);
                    break;
                }
            }
        }
    });
}

fn spawn_manual_backend(launcher: &Path, backend_port: u16) -> io::Result<BackendProcessHandle> {
    let mut command = Command::new(launcher);
    command
        .env("BACKEND_PORT", backend_port.to_string())
        .env("LDACA_BACKEND_PORT", backend_port.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn()?;
    let pid = child.id();

    if let Some(stdout) = child.stdout.take() {
        pipe_child_output(stdout, false);
    }
    if let Some(stderr) = child.stderr.take() {
        pipe_child_output(stderr, true);
    }

    println!(
        "Backend launcher {:?} started on port {} with PID {}",
        launcher, backend_port, pid
    );

    Ok(BackendProcessHandle::new_manual(child))
}

fn fallback_to_manual_launcher(
    backend_port: u16,
    reason: impl std::fmt::Display,
) -> Result<BackendProcessHandle, Box<dyn std::error::Error>> {
    let reason_msg = reason.to_string();
    if let Some(local_launcher) = locate_backend_launcher() {
        println!(
            "Sidecar launcher unavailable ({}). Falling back to {:?}",
            reason_msg, local_launcher
        );
        spawn_manual_backend(&local_launcher, backend_port)
            .map_err(|err| Box::new(err) as Box<dyn std::error::Error>)
    } else {
        let message = format!(
            "Backend runtime is missing from the bundle and no local runtime was found.\n\
             Please run the packaged .app bundle or rebuild the runtime with `npm run prepare:backend`.\n\
             Original error: {}",
            reason_msg
        );
        Err(Box::new(io::Error::new(io::ErrorKind::NotFound, message)))
    }
}

fn spawn_backend_process(
    app: &AppHandle,
    backend_port: u16,
) -> Result<BackendProcessHandle, Box<dyn std::error::Error>> {
    match app.shell().sidecar("backend-runtime/run_backend.sh") {
        Ok(sidecar_command) => {
            let spawn_result = sidecar_command
                .env("BACKEND_PORT", backend_port.to_string())
                .env("LDACA_BACKEND_PORT", backend_port.to_string())
                .spawn();

            match spawn_result {
                Ok((mut rx, child)) => {
                    let child_pid = child.pid();
                    println!(
                        "Backend sidecar started on port {} with PID {}",
                        backend_port, child_pid
                    );

                    std::thread::spawn(move || {
                        use tauri_plugin_shell::process::CommandEvent;
                        while let Some(event) =
                            futures::executor::block_on(async { rx.recv().await })
                        {
                            match event {
                                CommandEvent::Stdout(line) => {
                                    println!("[Backend] {}", String::from_utf8_lossy(&line))
                                }
                                CommandEvent::Stderr(line) => {
                                    eprintln!("[Backend] {}", String::from_utf8_lossy(&line))
                                }
                                CommandEvent::Error(err) => eprintln!("[Backend Error] {}", err),
                                CommandEvent::Terminated(payload) => {
                                    println!(
                                        "[Backend] Process terminated with code: {:?}",
                                        payload.code
                                    );
                                    break;
                                }
                                _ => {}
                            }
                        }
                    });

                    Ok(BackendProcessHandle::new_sidecar(child))
                }
                Err(spawn_err) => fallback_to_manual_launcher(backend_port, spawn_err),
            }
        }
        Err(shell_err) => fallback_to_manual_launcher(backend_port, shell_err),
    }
}

/// Find an available port in the given range
fn port_has_listener(port: u16) -> bool {
    TcpStream::connect((BACKEND_HOST, port)).is_ok()
}

fn can_bind_port(port: u16) -> bool {
    match TcpListener::bind((BACKEND_HOST, port)) {
        Ok(listener) => {
            drop(listener);
            true
        }
        Err(err) => {
            println!("Unable to bind to {}:{} ({})", BACKEND_HOST, port, err);
            false
        }
    }
}

fn find_available_port(start: u16, end: u16) -> Option<u16> {
    for port in start..=end {
        if port_has_listener(port) {
            println!("Port {} already in use, checking next...", port);
            continue;
        }

        if can_bind_port(port) {
            println!("Selected backend port {}", port);
            return Some(port);
        }
    }
    None
}

/// Tauri command to get the backend URL
#[tauri::command]
fn get_backend_url(state: State<BackendState>) -> String {
    state.url.clone()
}

/// Send SIGTERM to a process (Unix)
#[cfg(unix)]
fn send_sigterm(pid: u32) -> io::Result<()> {
    if pid == 0 {
        return Ok(());
    }
    let result = unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

/// Wait for a process to exit, with timeout
#[cfg(unix)]
fn wait_for_exit(pid: u32, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if !is_process_running(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    !is_process_running(pid)
}

#[cfg(unix)]
fn wait_for_child_exit(child: &mut std::process::Child, timeout: Duration) -> bool {
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => {
                if start.elapsed() >= timeout {
                    return false;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(_) => return false,
        }
    }
}

#[cfg(unix)]
fn is_process_running(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
    result == 0
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
                window.__BACKEND_URL__ = "{backend_url}";
                window.__BACKEND_PORT__ = {backend_port};
                console.log('[Tauri] Backend URL injected:', window.__BACKEND_URL__);
                console.log('[Tauri] Backend port injected:', window.__BACKEND_PORT__);

                (function() {{
                    if (window.__LDACA_DESKTOP_ZOOM_INITIALIZED) {{
                        return;
                    }}
                    window.__LDACA_DESKTOP_ZOOM_INITIALIZED = true;
                    const STORAGE_KEY = '__ldaca_desktop_zoom';
                    const MIN_ZOOM = 0.85;
                    const MAX_ZOOM = 1.25;
                    const STEP = 0.05;

                    const clamp = (value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
                    let zoomValue = Number(localStorage.getItem(STORAGE_KEY));
                    if (!Number.isFinite(zoomValue)) {{
                        zoomValue = 0.95;
                    }}
                    zoomValue = clamp(zoomValue);

                    const applyZoom = () => {{
                        const target = document.body;
                        if (!target) {{
                            requestAnimationFrame(applyZoom);
                            return;
                        }}
                        target.style.zoom = zoomValue.toString();
                    }};

                    const persistZoom = () => {{
                        try {{
                            localStorage.setItem(STORAGE_KEY, zoomValue.toString());
                        }} catch (err) {{
                            console.warn('[Tauri] Unable to persist zoom preference', err);
                        }}
                    }};

                    const setZoom = (value) => {{
                        zoomValue = clamp(value);
                        applyZoom();
                        persistZoom();
                    }};

                    const adjustZoom = (delta) => {{
                        setZoom(zoomValue + delta);
                    }};

                    window.addEventListener('keydown', (event) => {{
                        if (!(event.metaKey || event.ctrlKey) || event.altKey) {{
                            return;
                        }}
                        if (event.key === '=' || event.key === '+') {{
                            event.preventDefault();
                            adjustZoom(STEP);
                        }} else if (event.key === '-' || event.key === '_') {{
                            event.preventDefault();
                            adjustZoom(-STEP);
                        }} else if (event.key === '0') {{
                            event.preventDefault();
                            setZoom(1.0);
                        }}
                    }});

                    if (document.readyState === 'complete' || document.readyState === 'interactive') {{
                        applyZoom();
                    }} else {{
                        document.addEventListener('DOMContentLoaded', applyZoom, {{ once: true }});
                    }}
                }})();
                "#,
                backend_url = backend_url,
                backend_port = backend_port
            ))?;

            let app_handle = app.handle();
            let process = spawn_backend_process(&app_handle, backend_port)?;
            let backend_pid = process.pid();
            let state: State<BackendState> = app.state();
            *state.process.lock().unwrap() = Some(process);

            // Wait a bit for the backend to start
            std::thread::sleep(std::time::Duration::from_secs(3));

            println!(
                "Backend ready at: {} (pid {})",
                backend_url, backend_pid
            );

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

                let process_handle = state.process.lock().unwrap().take();
                let window_clone = window.clone();
                std::thread::spawn(move || {
                    if let Some(process) = process_handle {
                        println!("Shutting down backend PID {}", process.pid());
                        process.shutdown();
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
                    if let Some(process) = state
                        .process
                        .lock()
                        .ok()
                        .and_then(|mut guard| guard.take())
                    {
                        process.shutdown();
                    }
                }
            }
        });
}
