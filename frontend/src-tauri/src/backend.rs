//! Backend subprocess management: port discovery, `uv run` spawn, graceful shutdown.
//!
//! The launcher invokes:
//!
//! ```text
//! uv run --frozen --no-dev --project <bundled-src> \
//!        python -m ldaca_web_app.cli --backend --port <port> --host 127.0.0.1
//! ```
//!
//! uv is pointed at user-writable directories under the OS-provided per-app
//! data and cache roots. The first launch downloads CPython and syncs wheels
//! (~minute of activity); subsequent launches are near-instant.

use std::io::{BufRead, BufReader};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager};

use crate::platform;
use crate::runtime::BackendRuntime;

/// We bind explicitly to 127.0.0.1 (not `localhost`) to avoid mixed-content
/// issues on Windows, where Tauri serves the webview from
/// `https://tauri.localhost`.
pub const BACKEND_HOST: &str = "127.0.0.1";

/// Tauri-managed state holding the child process handle.
pub struct BackendState {
    pub process: Arc<Mutex<Option<BackendProcessHandle>>>,
}

impl BackendState {
    pub fn new() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
        }
    }
}

pub struct BackendProcessHandle {
    pid: u32,
    child: Option<std::process::Child>,
}

impl BackendProcessHandle {
    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// Unix: SIGTERM first so FastAPI can flush state; escalate to `kill` on
    /// timeout. Windows: no equivalent graceful signal, go straight to `kill`.
    pub fn shutdown(mut self) {
        let Some(mut child) = self.child.take() else {
            return;
        };

        #[cfg(unix)]
        {
            if platform::send_sigterm(self.pid).is_ok()
                && platform::wait_for_child_exit(&mut child, std::time::Duration::from_secs(7))
            {
                println!("Backend {} exited gracefully", self.pid);
                return;
            }
            eprintln!("Backend {} did not exit after SIGTERM; killing", self.pid);
        }

        if let Err(err) = child.kill() {
            eprintln!("Failed to kill backend {}: {}", self.pid, err);
        } else {
            let _ = child.wait();
        }
    }
}

/// Per-app writable directories that uv needs access to. A single shared
/// environment is used across app versions — `uv run --frozen` resolves the
/// correct wheel set for whichever `uv.lock` currently ships, so there is no
/// need to segregate envs by app version.
struct UvDirs {
    env_dir: PathBuf,
    cache_dir: PathBuf,
    python_install_dir: PathBuf,
    project_dir: PathBuf,
}

impl UvDirs {
    fn resolve(
        app: &AppHandle,
        bundled_project: &std::path::Path,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let data = app.path().app_data_dir()?;
        let cache = app.path().app_cache_dir()?;

        let root = data.join("python-runtime");
        std::fs::create_dir_all(&root)?;

        let env_dir = root.join("env");
        let python_install_dir = root.join("python");
        let cache_dir = cache.join("uv");
        let project_dir = root.join("project");

        std::fs::create_dir_all(&env_dir)?;
        std::fs::create_dir_all(&python_install_dir)?;
        std::fs::create_dir_all(&cache_dir)?;

        stage_project_to_writable(bundled_project, &project_dir)?;

        Ok(Self {
            env_dir,
            cache_dir,
            python_install_dir,
            project_dir,
        })
    }
}

/// Copy the bundled project source into a writable location so `uv run`'s
/// wheel build (see `backend/scripts/hatch_build.py`) can mutate the tree.
/// When the app is launched straight off a read-only DMG the bundle itself
/// isn't writable, and hatch extracts `build.tar.gz` into
/// `src/ldaca_web_app/resources/frontend/` during the build.
///
/// A single shared project directory is reused across app versions. We detect
/// bundle changes by hashing the bundled `pyproject.toml` + `uv.lock` and
/// storing the digest in a sentinel; if it matches, staging is skipped.
fn stage_project_to_writable(
    src: &std::path::Path,
    dst: &std::path::Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let sentinel = dst.join(".staged");
    let expected = project_fingerprint(src)?;

    if let Ok(existing) = std::fs::read_to_string(&sentinel) {
        if existing.trim() == expected {
            return Ok(());
        }
    }

    if dst.exists() {
        std::fs::remove_dir_all(dst)?;
    }
    std::fs::create_dir_all(dst)?;

    copy_dir_recursive(src, dst)?;
    std::fs::write(&sentinel, expected.as_bytes())?;
    Ok(())
}

/// Cheap change-detection for the bundled project: concatenated size+mtime of
/// `pyproject.toml` and `uv.lock`. No crypto needed — we just need to know
/// whether the bundle has been replaced since the last launch.
fn project_fingerprint(src: &std::path::Path) -> std::io::Result<String> {
    let mut parts: Vec<String> = Vec::new();
    for name in ["pyproject.toml", "uv.lock"] {
        let p = src.join(name);
        let meta = std::fs::metadata(&p)?;
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or_default();
        parts.push(format!("{}:{}:{}", name, meta.len(), mtime));
    }
    Ok(parts.join("|"))
}

fn copy_dir_recursive(
    src: &std::path::Path,
    dst: &std::path::Path,
) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else if file_type.is_symlink() {
            // The bundled tree shouldn't contain symlinks, but if it does
            // dereference to a plain copy rather than propagating the link.
            let real = std::fs::read_link(&src_path)?;
            let resolved = if real.is_absolute() {
                real
            } else {
                src_path.parent().unwrap_or(std::path::Path::new("")).join(real)
            };
            std::fs::copy(resolved, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

pub fn find_available_port(start: u16, end: u16) -> Option<u16> {
    for port in start..=end {
        if TcpStream::connect((BACKEND_HOST, port)).is_ok() {
            continue;
        }
        match TcpListener::bind((BACKEND_HOST, port)) {
            Ok(listener) => {
                drop(listener);
                println!("Selected backend port {}", port);
                return Some(port);
            }
            Err(err) => println!("Cannot bind {}:{} ({})", BACKEND_HOST, port, err),
        }
    }
    None
}

/// Spawn `uv run` against the bundled backend project.
///
/// All uv state (managed CPython, resolved venv, wheel cache) lives outside
/// the signed `.app` bundle in OS-provided user directories — the bundle
/// itself stays read-only.
pub fn spawn(
    app: &AppHandle,
    runtime: &BackendRuntime,
    port: u16,
) -> Result<BackendProcessHandle, Box<dyn std::error::Error>> {
    let dirs = UvDirs::resolve(app, &runtime.project)?;

    println!(
        "Launching backend via {} (project: {}) on port {}\n  env:   {}\n  cache: {}\n  pyenv: {}",
        runtime.uv.display(),
        dirs.project_dir.display(),
        port,
        dirs.env_dir.display(),
        dirs.cache_dir.display(),
        dirs.python_install_dir.display()
    );

    let mut cmd = Command::new(&runtime.uv);
    cmd.arg("run")
        .arg("--frozen")
        .arg("--no-dev")
        .arg("--project")
        .arg(&dirs.project_dir)
        .arg("python")
        .arg("-m")
        .arg("ldaca_web_app.cli")
        .arg("--backend")
        .arg("--port")
        .arg(port.to_string())
        .arg("--host")
        .arg(BACKEND_HOST)
        .current_dir(&dirs.project_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    apply_uv_environment(&mut cmd, &dirs);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(platform::CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|err| {
        format!(
            "Failed to spawn uv at {}: {}",
            runtime.uv.display(),
            err
        )
    })?;

    if let Some(stdout) = child.stdout.take() {
        pipe_output(stdout, false);
    }
    if let Some(stderr) = child.stderr.take() {
        pipe_output(stderr, true);
    }

    Ok(BackendProcessHandle {
        pid: child.id(),
        child: Some(child),
    })
}

fn apply_uv_environment(cmd: &mut Command, dirs: &UvDirs) {
    // Relocate every piece of state uv might persist so the app bundle stays
    // read-only and per-user data lives under app_data_dir / app_cache_dir.
    cmd.env("UV_PROJECT_ENVIRONMENT", &dirs.env_dir)
        .env("UV_PYTHON_INSTALL_DIR", &dirs.python_install_dir)
        .env("UV_CACHE_DIR", &dirs.cache_dir)
        // Never reach for a system Python interpreter; always use the managed
        // one. `only-managed` supersedes UV_MANAGED_PYTHON, which uv >= 0.11
        // refuses to accept alongside `--python-preference`.
        .env("UV_PYTHON_PREFERENCE", "only-managed")
        // Hardlinks across volumes (or across the bundle / home partition)
        // break silently; copying is the only reliably-portable option.
        .env("UV_LINK_MODE", "copy")
        // Ignore user-level uv config / workspace discovery outside our project.
        .env("UV_NO_CONFIG", "1")
        // `--frozen` already implies this, but make it unambiguous.
        .env("UV_FROZEN", "1")
        // Cleaner stdout in the app log stream.
        .env("UV_NO_PROGRESS", "1")
        // Python-side hygiene.
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONNOUSERSITE", "1");

    // Scrub inherited variables that would interfere with our managed env.
    for key in [
        "VIRTUAL_ENV",
        "PYTHONHOME",
        "PYTHONPATH",
        "PYTHONSTARTUP",
        "UV_PYTHON",
    ] {
        cmd.env_remove(key);
    }

}

fn pipe_output<R>(reader: R, is_stderr: bool)
where
    R: std::io::Read + Send + 'static,
{
    std::thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            if is_stderr {
                eprintln!("[Backend] {}", line);
            } else {
                println!("[Backend] {}", line);
            }
        }
    });
}
