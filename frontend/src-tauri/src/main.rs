// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::io::{self, BufRead, BufReader};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{path::BaseDirectory, AppHandle, Manager, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Windows: CREATE_NO_WINDOW flag prevents a visible console window when
/// spawning the backend Python process.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Holds the backend URL, process, and PID
struct BackendState {
    url: String,
    process: Arc<Mutex<Option<BackendProcessHandle>>>,
    closing: Arc<Mutex<bool>>, // track if graceful closing is in progress
}

struct BackendRuntime {
    root: PathBuf,
    python: PathBuf,
}

struct BackendProcessHandle {
    pid: u32,
    child: Option<std::process::Child>,
}

impl BackendProcessHandle {
    fn new(child: std::process::Child) -> Self {
        let pid = child.id();
        Self {
            pid,
            child: Some(child),
        }
    }

    fn pid(&self) -> u32 {
        self.pid
    }

    fn shutdown(mut self) {
        if let Some(mut child) = self.child.take() {
            #[cfg(unix)]
            {
                match send_sigterm(self.pid) {
                    Ok(_) => {
                        if wait_for_child_exit(&mut child, Duration::from_millis(7000)) {
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

            if let Err(err) = child.kill() {
                eprintln!("Failed to stop backend {} cleanly: {}", self.pid, err);
            } else {
                let _ = child.wait();
            }
        }
    }
}

const DEV_BACKEND_RUNTIME: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../backend/dist-tauri/backend-runtime"
);

const BACKEND_HOST: &str = "127.0.0.1";
const RUNTIME_MANIFEST: &str = "runtime-manifest.json";

const BUNDLE_RUNTIME_CANDIDATES: &[&str] = &[
    "backend-runtime",
    "_up_/backend-runtime",
    "_up_/_up_/backend-runtime",
    "backend/dist-tauri/backend-runtime",
    "_up_/backend/dist-tauri/backend-runtime",
    "_up_/_up_/backend/dist-tauri/backend-runtime",
];

fn make_error(message: impl Into<String>) -> Box<dyn std::error::Error> {
    Box::new(io::Error::new(io::ErrorKind::Other, message.into()))
}

fn locate_backend_runtime(app: &AppHandle) -> Result<BackendRuntime, Box<dyn std::error::Error>> {
    if let Some(python_override) = path_from_env("LDACA_BACKEND_PYTHON") {
        let runtime_dir = path_from_env("LDACA_BACKEND_RUNTIME")
            .or_else(|| infer_runtime_dir_from_python(&python_override))
            .ok_or_else(|| {
                make_error(
                    "LDACA_BACKEND_PYTHON is set but LDACA_BACKEND_RUNTIME could not be resolved.",
                )
            })?;

        return Ok(BackendRuntime {
            root: runtime_dir,
            python: python_override,
        });
    }

    let runtime_dir = path_from_env("LDACA_BACKEND_RUNTIME")
        .or_else(runtime_from_launcher_env)
        .or_else(|| detect_runtime_dir(app))
        .ok_or_else(|| {
            make_error(
                "Backend runtime not found. Run `npm run prepare:backend` and ensure the bundle includes resources/backend-runtime.",
            )
        })?;

    let python_path = locate_python_binary(&runtime_dir)
        .ok_or_else(|| make_error(format!("No python interpreter found in {}", runtime_dir.display())))?;

    Ok(BackendRuntime {
        root: runtime_dir,
        python: python_path,
    })
}

fn runtime_dir_has_manifest(dir: &Path) -> bool {
    dir.join(RUNTIME_MANIFEST).exists()
}

fn scan_for_manifest(start_dir: &Path, max_depth: usize) -> Option<PathBuf> {
    if max_depth == 0 {
        return None;
    }

    let entries = std::fs::read_dir(start_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name == RUNTIME_MANIFEST)
        {
            return path.parent().map(Path::to_path_buf);
        }

        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };

        if !file_type.is_dir() {
            continue;
        }

        if let Some(runtime_dir) = scan_for_manifest(&path, max_depth.saturating_sub(1)) {
            return Some(runtime_dir);
        }
    }

    None
}

fn detect_runtime_dir(app: &AppHandle) -> Option<PathBuf> {
    let resolver = app.path();
    for resource in BUNDLE_RUNTIME_CANDIDATES {
        if let Ok(candidate) = resolver.resolve(resource, BaseDirectory::Resource) {
            if candidate.exists() && runtime_dir_has_manifest(&candidate) {
                println!(
                    "Resolved backend runtime via bundle candidate '{}': {}",
                    resource,
                    candidate.display()
                );
                return Some(candidate);
            }
        }
    }

    if let Ok(resource_dir) = resolver.resolve("", BaseDirectory::Resource) {
        if let Some(runtime_dir) = scan_for_manifest(&resource_dir, 5) {
            println!(
                "Resolved backend runtime by scanning Resources tree: {}",
                runtime_dir.display()
            );
            return Some(runtime_dir);
        }
    }

    // Fallback for direct executable launches where resolver may fail.
    if let Ok(exe_path) = std::env::current_exe() {
        // On Windows, both MSI-installed apps and bare build outputs place
        // backend-runtime adjacent to the executable.
        if let Some(exe_dir) = exe_path.parent() {
            for rel in BUNDLE_RUNTIME_CANDIDATES {
                let candidate = exe_dir.join(rel);
                if candidate.exists() && runtime_dir_has_manifest(&candidate) {
                    println!(
                        "Resolved backend runtime via exe-adjacent candidate '{}': {}",
                        rel,
                        candidate.display()
                    );
                    return Some(candidate);
                }
            }
        }

        // macOS bundle layout: derive Resources from executable location.
        if let Some(resources_dir) = exe_path
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.join("Resources"))
        {
            for rel in BUNDLE_RUNTIME_CANDIDATES {
                let candidate = resources_dir.join(rel);
                if candidate.exists() && runtime_dir_has_manifest(&candidate) {
                    println!(
                        "Resolved backend runtime via executable-relative candidate '{}': {}",
                        rel,
                        candidate.display()
                    );
                    return Some(candidate);
                }
            }

            if let Some(runtime_dir) = scan_for_manifest(&resources_dir, 5) {
                println!(
                    "Resolved backend runtime by scanning executable-relative Resources tree: {}",
                    runtime_dir.display()
                );
                return Some(runtime_dir);
            }
        }
    }

    // Keep local development fallback for `tauri dev` and local shell runs,
    // but avoid using it in packaged release builds unless explicitly opted in.
    let allow_dev_fallback = cfg!(debug_assertions)
        || std::env::var("LDACA_ALLOW_DEV_RUNTIME_FALLBACK")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);

    if allow_dev_fallback {
        let dev_path = PathBuf::from(DEV_BACKEND_RUNTIME);
        if runtime_dir_has_manifest(&dev_path) {
            println!(
                "Resolved backend runtime via development fallback: {}",
                dev_path.display()
            );
            return Some(dev_path);
        }
    }

    if let Ok(exe_path) = std::env::current_exe() {
        eprintln!(
            "Backend runtime could not be resolved from bundle resources. current_exe={}.",
            exe_path.display()
        );
    }

    None
}

fn path_from_env(var: &str) -> Option<PathBuf> {
    std::env::var_os(var).map(PathBuf::from).and_then(|path| {
        if path.exists() {
            Some(path)
        } else {
            eprintln!(
                "Environment variable {} points to {:?}, but it does not exist",
                var, path
            );
            None
        }
    })
}

fn runtime_from_launcher_env() -> Option<PathBuf> {
    std::env::var_os("LDACA_BACKEND_LAUNCHER").map(PathBuf::from).and_then(|launcher| {
        if launcher.exists() {
            launcher.parent().map(Path::to_path_buf)
        } else {
            None
        }
    })
}

fn locate_python_binary(runtime_dir: &Path) -> Option<PathBuf> {
    // Prefer the managed-python real interpreter over the venv stub launcher.
    // The venv Scripts/python.exe is a stub that reads pyvenv.cfg to locate the
    // real interpreter – but pyvenv.cfg uses an absolute path baked at build time
    // that won't exist on other machines. Using managed-python directly avoids
    // this entirely; PYTHONHOME and PYTHONPATH set in spawn_backend_process()
    // ensure the interpreter finds stdlib and site-packages.
    if let Some(managed) = find_managed_python_binary(runtime_dir) {
        return Some(managed);
    }

    // Fallback to venv launchers (works in dev when pyvenv.cfg is valid)
    let candidates = [
        runtime_dir.join("python").join("bin").join("python3"),
        runtime_dir.join("python").join("bin").join("python"),
        runtime_dir.join("python").join("Scripts").join("python.exe"),
        runtime_dir.join("python").join("python.exe"),
        runtime_dir.join("python").join("python3.exe"),
        runtime_dir.join("venv").join("bin").join("python"),
        runtime_dir.join("venv").join("Scripts").join("python.exe"),
    ];

    for candidate in candidates {
        if candidate.exists() {
            return Some(candidate);
        }
    }

    None
}

/// Locate the real Python interpreter inside managed-python.
///
/// On Windows: managed-python/cpython-*/python.exe
/// On Unix:    managed-python/cpython-*/bin/python3
fn find_managed_python_binary(runtime_dir: &Path) -> Option<PathBuf> {
    let managed_dir = runtime_dir.join("managed-python");
    let entries = std::fs::read_dir(&managed_dir).ok()?;

    for entry in entries.flatten() {
        let cpython_dir = entry.path();
        if !cpython_dir.is_dir() {
            continue;
        }

        // Windows: python.exe directly in cpython dir
        let win_python = cpython_dir.join("python.exe");
        if win_python.exists() {
            return Some(win_python);
        }

        // Unix: bin/python3
        let unix_python = cpython_dir.join("bin").join("python3");
        if unix_python.exists() {
            return Some(unix_python);
        }
    }

    None
}

fn infer_runtime_dir_from_python(python_path: &Path) -> Option<PathBuf> {
    let mut current = python_path.parent()?;

    for _ in 0..6 {
        if let Some(name) = current.file_name().and_then(|n| n.to_str()) {
            match name {
                "bin" | "Scripts" => {
                    current = current.parent()?;
                    continue;
                }
                "python" | "venv" => {
                    return current.parent().map(Path::to_path_buf);
                }
                _ => {}
            }
        }

        current = current.parent()?;
    }

    None
}

/// Locate the managed CPython installation that ships with the bundled runtime.
///
/// Works cross-platform: on Unix the stdlib lives under `lib/python3.X/encodings`,
/// on Windows it is `Lib/encodings` (flat, no version subdirectory).
fn find_managed_python_home(runtime_root: &Path) -> Option<PathBuf> {
    let managed_dir = runtime_root.join("managed-python");
    let entries = std::fs::read_dir(&managed_dir).ok()?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        // Windows layout: <cpython-dir>/Lib/encodings
        if path.join("Lib").join("encodings").is_dir() {
            return Some(path);
        }

        // Unix layout: <cpython-dir>/lib/python3.X/encodings
        if let Ok(lib_entries) = std::fs::read_dir(path.join("lib")) {
            for lib_entry in lib_entries.flatten() {
                let lib_dir = lib_entry.path();
                if lib_dir
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("python3."))
                    && lib_dir.join("encodings").is_dir()
                {
                    return Some(path);
                }
            }
        }
    }

    None
}

/// Locate the venv site-packages directory inside the bundled runtime.
///
/// On Unix this is `python/lib/python3.X/site-packages`.
/// On Windows this is `python/Lib/site-packages` (flat, no version subdirectory).
fn find_venv_site_packages(runtime_root: &Path) -> Option<PathBuf> {
    let python_dir = runtime_root.join("python");

    // Windows layout: python/Lib/site-packages
    let win_sp = python_dir.join("Lib").join("site-packages");
    if win_sp.is_dir() {
        return Some(win_sp);
    }

    // Unix layout: python/lib/python3.X/site-packages
    if let Ok(lib_entries) = std::fs::read_dir(python_dir.join("lib")) {
        for entry in lib_entries.flatten() {
            let lib_dir = entry.path();
            if lib_dir
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("python3."))
            {
                let sp = lib_dir.join("site-packages");
                if sp.is_dir() {
                    return Some(sp);
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

fn load_runtime_env(
    runtime_dir: &Path,
) -> Result<HashMap<String, String>, Box<dyn std::error::Error>> {
    let mut values = HashMap::new();
    for filename in [".env", ".env.desktop"] {
        let env_path = runtime_dir.join(filename);
        if env_path.exists() {
            parse_env_file(&env_path, &mut values)?;
        }
    }
    Ok(values)
}

fn parse_env_file(
    path: &Path,
    dest: &mut HashMap<String, String>,
) -> Result<(), Box<dyn std::error::Error>> {
    let iter = dotenvy::from_path_iter(path)?;
    for entry in iter {
        let (key, value) = entry?;
        dest.insert(key, value);
    }
    Ok(())
}

fn determine_server_host(env_overrides: &HashMap<String, String>) -> String {
    env_overrides
        .get("SERVER_HOST")
        .cloned()
        .or_else(|| env_overrides.get("LDACA_SERVER_HOST").cloned())
        .or_else(|| std::env::var("SERVER_HOST").ok())
        .or_else(|| std::env::var("LDACA_SERVER_HOST").ok())
        .unwrap_or_else(|| BACKEND_HOST.to_string())
}

fn spawn_backend_process(
    runtime: &BackendRuntime,
    backend_port: u16,
    env_overrides: &HashMap<String, String>,
) -> io::Result<BackendProcessHandle> {
    let mut command = Command::new(&runtime.python);
    command
        .arg("-m")
        .arg("ldaca_web_app_backend.cli")
        .current_dir(&runtime.root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    command.envs(env_overrides.iter());
    command.env("PYTHONUNBUFFERED", "1");
    command.env("BACKEND_PORT", backend_port.to_string());
    command.env("LDACA_BACKEND_PORT", backend_port.to_string());
    command.env("LDACA_BACKEND_RUNTIME", runtime.root.as_os_str());
    command.env("LDACA_BACKEND_PYTHON", runtime.python.as_os_str());

    // Ensure packaged Python runtime is relocatable across machines.
    // `pyvenv.cfg` may contain build-machine absolute paths; use managed-python
    // as PYTHONHOME and venv site-packages as PYTHONPATH.
    let managed_python_home = find_managed_python_home(&runtime.root);

    let venv_site_packages = find_venv_site_packages(&runtime.root);

    if let Some(ref home) = managed_python_home {
        println!(
            "Setting PYTHONHOME={} (overrides pyvenv.cfg for relocatability)",
            home.display()
        );
        command.env("PYTHONHOME", home.as_os_str());
        if let Some(site_packages) = venv_site_packages.as_deref() {
            if let Ok(paths) = std::env::join_paths([site_packages]) {
                command.env("PYTHONPATH", paths);
            }
        }
        command.env("PYTHONNOUSERSITE", "1");

        // Prepend managed-python dir to PATH so C extension modules (greenlet,
        // numpy, etc.) can find vcruntime140.dll and other DLLs that ship with
        // the managed CPython installation.
        let mut new_path = std::ffi::OsString::from(home);
        if let Some(existing_path) = std::env::var_os("PATH") {
            new_path.push(";");
            new_path.push(existing_path);
        }
        command.env("PATH", new_path);
    } else {
        eprintln!(
            "WARNING: managed-python not found under {}; pyvenv.cfg home path may be stale on this machine",
            runtime.root.display()
        );
    }

    let host_value = determine_server_host(env_overrides);
    command.env("SERVER_HOST", host_value.clone());
    command.env("LDACA_SERVER_HOST", host_value);

    if std::env::var("LDACA_CONFIG_PROFILE").is_err()
        && !env_overrides.contains_key("LDACA_CONFIG_PROFILE")
    {
        command.env("LDACA_CONFIG_PROFILE", "desktop");
    }

    println!(
        "Launching backend via {} (runtime: {}) on port {}",
        runtime.python.display(),
        runtime.root.display(),
        backend_port
    );

    // On Windows, suppress the console window for the Python child process.
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command.spawn()?;
    if let Some(stdout) = child.stdout.take() {
        pipe_child_output(stdout, false);
    }
    if let Some(stderr) = child.stderr.take() {
        pipe_child_output(stderr, true);
    }

    Ok(BackendProcessHandle::new(child))
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

fn wait_for_backend_health(backend_url: &str) -> io::Result<()> {
    let health_url = format!("{}/health", backend_url.trim_end_matches('/'));
    let poll_interval = Duration::from_millis(500);
    let mut attempt = 0;
    let agent = ureq::Agent::new_with_defaults();

    loop {
        attempt += 1;
        match agent.get(&health_url).call() {
            Ok(response) => {
                if response.status() == 200 {
                    println!(
                        "Backend health check succeeded after {} attempt(s) (status {})",
                        attempt,
                        response.status()
                    );
                    return Ok(());
                }

                println!(
                    "Backend health endpoint returned status {} on attempt {} – retrying...",
                    response.status(),
                    attempt
                );
            }
            Err(err) => {
                println!(
                    "Backend health check attempt {} failed: {}. Retrying...",
                    attempt, err
                );
            }
        }

        std::thread::sleep(poll_interval);
    }
}

fn main() {
    // Find an available port for the backend (try 8001-8010)
    let backend_port = match find_available_port(8001, 8010) {
        Some(port) => port,
        None => {
            eprintln!("No available ports found in range 8001-8010");
            return;
        }
    };

    // Use 127.0.0.1 instead of localhost to avoid mixed content issues on Windows
    // where Tauri serves from https://tauri.localhost
    let backend_url = format!("http://127.0.0.1:{}", backend_port);
    println!("Backend will run on: {}", backend_url);

    let backend_state = BackendState {
        url: backend_url.clone(),
        process: Arc::new(Mutex::new(None)),
        closing: Arc::new(Mutex::new(false)),
    };

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(backend_state)
        .invoke_handler(tauri::generate_handler![get_backend_url])
        .setup(move |app| {
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| make_error("Main window not found"))?;

            // Apply native webview zoom to avoid CSS layout artifacts.
            window.set_zoom(0.95)?;

            // Inject backend URL as an initialization script BEFORE any page content loads
            // This ensures window.__BACKEND_URL__ is available when React boots
            window.eval(&format!(
                r#"
                window.__BACKEND_URL__ = "{backend_url}";
                window.__BACKEND_PORT__ = {backend_port};
                console.log('[Tauri] Backend URL injected:', window.__BACKEND_URL__);
                console.log('[Tauri] Backend port injected:', window.__BACKEND_PORT__);
                "#,
                backend_url = backend_url,
                backend_port = backend_port
            ))?;

            let app_handle = app.handle();
            let runtime = locate_backend_runtime(&app_handle)?;
            let runtime_env = load_runtime_env(&runtime.root)?;
            let process = spawn_backend_process(&runtime, backend_port, &runtime_env)?;
            let backend_pid = process.pid();
            let state: State<BackendState> = app.state();
            *state.process.lock().unwrap() = Some(process);

            println!(
                "Backend launched at: {} (pid {}) – waiting for /health",
                backend_url, backend_pid
            );

            if let Err(err) = wait_for_backend_health(&backend_url) {
                eprintln!("Backend health check failed: {}", err);
                return Err(Box::new(err));
            }

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
        .build(tauri::generate_context!());

    match app {
        Ok(app) => {
            app.run(|app_handle, event| {
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
        Err(err) => {
            eprintln!("error while building tauri application: {}", err);
        }
    }
}
