use crate::platform;
use crate::runtime::BackendRuntime;
use serde::Deserialize;
use std::fs;
use std::io::{self, BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

pub(crate) const BACKEND_HOST: &str = "127.0.0.1";
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(7);
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Deserialize)]
struct StartupRecord {
    schema_version: u32,
    status: String,
    pid: u32,
    host: Option<String>,
    port: Option<u16>,
    version: String,
    code: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct LiveBackend {
    pub(crate) url: String,
}

/// Sole owner of the local backend child process.
///
/// Stored behind the one mutex in Tauri `BackendState`. The optional child is
/// internal lifecycle state: [`shutdown`](Self::shutdown) takes it exactly once
/// and subsequent shutdown calls return success without re-signalling a PID.
pub(crate) struct BackendProcess {
    pid: u32,
    child: Option<Child>,
}

impl BackendProcess {
    /// Launch the packaged backend with the already-resolved runtime layout.
    ///
    /// Called by the blocking startup worker. Environment construction consumes
    /// manifest fields directly; no path scanning or venv fallback occurs here.
    pub(crate) fn spawn(runtime: &BackendRuntime, startup_file: &Path) -> io::Result<Self> {
        let mut command = runtime_command(runtime);
        command
            .arg("-m")
            .arg("ldaca_wordflow.cli")
            .arg("--backend")
            .arg("--port")
            .arg("0")
            .arg("--startup-file")
            .arg(startup_file)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        platform::configure_backend_command(&mut command);

        println!(
            "Launching backend via {} (runtime: {})",
            runtime.python.display(),
            runtime.root.display()
        );
        let mut child = command.spawn()?;
        let pid = child.id();
        if let Some(stdout) = child.stdout.take() {
            pipe_output(stdout, false);
        }
        if let Some(stderr) = child.stderr.take() {
            pipe_output(stderr, true);
        }
        Ok(Self {
            pid,
            child: Some(child),
        })
    }

    pub(crate) fn pid(&self) -> u32 {
        self.pid
    }

    /// Wait for the Python launcher record that is published after ASGI lifespan.
    ///
    /// The startup worker owns the process while polling, and cancellation is
    /// checked between every non-blocking child/status probe.
    pub(crate) fn wait_until_live(
        &mut self,
        startup_file: &Path,
        cancelled: &AtomicBool,
    ) -> io::Result<LiveBackend> {
        let deadline = Instant::now() + STARTUP_TIMEOUT;
        loop {
            if cancelled.load(Ordering::Acquire) {
                return Err(io::Error::new(
                    io::ErrorKind::Interrupted,
                    "Backend startup was cancelled",
                ));
            }
            if let Some(status) = self
                .child
                .as_mut()
                .ok_or_else(|| io::Error::other("Backend process is not owned"))?
                .try_wait()?
            {
                return Err(io::Error::other(format!(
                    "Backend exited before liveness with {status}"
                )));
            }
            if startup_file.is_file() {
                let record: StartupRecord = serde_json::from_slice(&fs::read(startup_file)?)
                    .map_err(|error| {
                        io::Error::new(
                            io::ErrorKind::InvalidData,
                            format!("Invalid backend startup record: {error}"),
                        )
                    })?;
                if record.schema_version != 1
                    || record.pid != self.pid
                    || record.version != env!("CARGO_PKG_VERSION")
                {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "Backend startup identity does not match the desktop process",
                    ));
                }
                if record.status == "failed" {
                    return Err(io::Error::other(format!(
                        "Backend startup failed ({})",
                        record.code.as_deref().unwrap_or("startup_failed")
                    )));
                }
                let Some(port) = record.port else {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "Backend startup record is incomplete",
                    ));
                };
                if record.status != "live" || record.host.as_deref() != Some(BACKEND_HOST) {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "Backend startup record is incomplete",
                    ));
                }
                return Ok(LiveBackend {
                    url: format!("http://{BACKEND_HOST}:{port}"),
                });
            }
            if Instant::now() >= deadline {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "Backend did not complete startup before the deadline",
                ));
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    /// Shut down the owned process tree once and wait for it to be reaped.
    ///
    /// Called by both close and exit handlers. Returning `Result` keeps process
    /// failures visible while the internal `Option` makes double-close
    /// idempotent.
    pub(crate) fn shutdown(&mut self) -> io::Result<()> {
        self.shutdown_with_timeout(SHUTDOWN_TIMEOUT)
    }

    fn shutdown_with_timeout(&mut self, timeout: Duration) -> io::Result<()> {
        let Some(mut child) = self.child.take() else {
            return Ok(());
        };
        match platform::terminate_process_tree(&mut child, self.pid, timeout) {
            Ok(()) => Ok(()),
            Err(error) => {
                if child.try_wait()?.is_none() {
                    self.child = Some(child);
                }
                Err(error)
            }
        }
    }

    #[cfg(all(test, unix))]
    fn from_child(child: Child) -> Self {
        Self {
            pid: child.id(),
            child: Some(child),
        }
    }
}

impl Drop for BackendProcess {
    fn drop(&mut self) {
        if self.child.is_some() {
            if let Err(error) = self.shutdown() {
                eprintln!("Backend cleanup during owner drop failed: {error}");
            }
        }
    }
}

/// Build the exact packaged-Python command environment shared by launch and CI.
///
/// Production adds backend CLI arguments and process-group flags; the ignored
/// packaged-runtime test adds an import probe. Sharing this function prevents
/// validation from drifting back to a venv launcher or partial environment.
fn runtime_command(runtime: &BackendRuntime) -> Command {
    let mut command = Command::new(&runtime.python);
    command
        .current_dir(&runtime.root)
        .env("PYTHONUNBUFFERED", "1")
        .env("LDACA_PARENT_PID", std::process::id().to_string())
        .env("PYTHONHOME", &runtime.python_home)
        .env("PYTHONPATH", &runtime.site_packages)
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("PYTHONNOUSERSITE", "1")
        .env("SERVER_HOST", BACKEND_HOST)
        .env("TRUSTED_HOSTS", format!(r#"["{BACKEND_HOST}"]"#))
        .env(
            "CORS_ALLOWED_ORIGINS",
            serde_json::to_string(&desktop_origins(
                cfg!(debug_assertions),
                cfg!(target_os = "windows"),
            ))
            .expect("desktop origins serialize"),
        )
        .env("MULTI_USER", "false");
    #[cfg(target_os = "windows")]
    prepend_python_home_to_path(&mut command, &runtime.python_home);
    command
}

fn desktop_origins(debug: bool, windows: bool) -> Vec<&'static str> {
    let packaged_origin = if windows {
        "https://tauri.localhost"
    } else {
        "tauri://localhost"
    };
    if debug {
        vec!["http://127.0.0.1:3001", packaged_origin]
    } else {
        vec![packaged_origin]
    }
}

#[cfg(target_os = "windows")]
fn prepend_python_home_to_path(command: &mut Command, python_home: &std::path::Path) {
    let mut paths = vec![python_home.to_path_buf()];
    if let Some(existing) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&existing));
    }
    if let Ok(joined) = std::env::join_paths(paths) {
        command.env("PATH", joined);
    }
}

fn pipe_output<R>(reader: R, stderr: bool)
where
    R: std::io::Read + Send + 'static,
{
    std::thread::spawn(move || {
        for line in BufReader::new(reader).lines() {
            match line {
                Ok(line) if stderr => eprintln!("[Backend] {line}"),
                Ok(line) => println!("[Backend] {line}"),
                Err(error) => {
                    eprintln!("[Backend] Failed to read output: {error}");
                    break;
                }
            }
        }
    });
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::process::CommandExt;

    fn shell_process(script: &str) -> BackendProcess {
        let mut command = Command::new("sh");
        command.arg("-c").arg(script).process_group(0);
        BackendProcess::from_child(command.spawn().expect("spawn shell fixture"))
    }

    #[test]
    fn shutdown_is_idempotent() {
        let mut process = shell_process("trap 'exit 0' TERM; while :; do sleep 1; done");
        process
            .shutdown_with_timeout(Duration::from_secs(1))
            .expect("first shutdown");
        process
            .shutdown_with_timeout(Duration::from_millis(10))
            .expect("second shutdown");
    }

    #[test]
    fn timeout_escalates_for_process_group() {
        let mut process = shell_process("trap '' TERM; while :; do sleep 1; done");
        let started = std::time::Instant::now();
        process
            .shutdown_with_timeout(Duration::from_millis(75))
            .expect("forced shutdown");
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn timeout_terminates_descendants_in_the_process_group() {
        let pidfile = std::env::temp_dir().join(format!("ldaca-child-{}.pid", std::process::id()));
        let script = format!(
            "trap '' TERM; sleep 60 & echo $! > '{}'; wait",
            pidfile.display()
        );
        let mut process = shell_process(&script);
        let deadline = std::time::Instant::now() + Duration::from_secs(1);
        let descendant = loop {
            if let Ok(value) = std::fs::read_to_string(&pidfile) {
                if let Ok(pid) = value.trim().parse::<u32>() {
                    break pid;
                }
            }
            assert!(
                std::time::Instant::now() < deadline,
                "descendant pid was not published"
            );
            std::thread::sleep(Duration::from_millis(10));
        };

        process
            .shutdown_with_timeout(Duration::from_millis(75))
            .expect("group shutdown");

        let deadline = std::time::Instant::now() + Duration::from_secs(1);
        while unsafe { libc::kill(descendant as libc::pid_t, 0) } == 0
            && std::time::Instant::now() < deadline
        {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_ne!(unsafe { libc::kill(descendant as libc::pid_t, 0) }, 0);
        let _ = std::fs::remove_file(pidfile);
    }

    #[test]
    fn startup_wait_returns_immediately_when_cancelled() {
        let mut process = shell_process("while :; do sleep 1; done");
        let startup_file =
            std::env::temp_dir().join(format!("ldaca-cancelled-startup-{}", std::process::id()));
        let cancelled = AtomicBool::new(true);

        let error = process
            .wait_until_live(&startup_file, &cancelled)
            .expect_err("cancelled startup must stop waiting");

        assert_eq!(error.kind(), io::ErrorKind::Interrupted);
        process.shutdown().expect("cancelled process shutdown");
    }
}

#[cfg(test)]
mod packaged_runtime_test {
    use super::*;

    #[test]
    fn launcher_disables_bytecode_writes_inside_the_packaged_runtime() {
        let runtime = BackendRuntime {
            root: "runtime".into(),
            python: "runtime/python".into(),
            python_home: "runtime/python-home".into(),
            site_packages: "runtime/site-packages".into(),
        };
        let command = runtime_command(&runtime);
        let value = command
            .get_envs()
            .find_map(|(key, value)| (key == "PYTHONDONTWRITEBYTECODE").then_some(value))
            .flatten();

        assert_eq!(value, Some(std::ffi::OsStr::new("1")));
    }

    #[test]
    fn desktop_cors_origins_cover_dev_and_packaged_debug_modes() {
        assert_eq!(
            desktop_origins(true, false),
            vec!["http://127.0.0.1:3001", "tauri://localhost"]
        );
        assert_eq!(
            desktop_origins(true, true),
            vec!["http://127.0.0.1:3001", "https://tauri.localhost"]
        );
        assert_eq!(desktop_origins(false, false), vec!["tauri://localhost"]);
        assert_eq!(
            desktop_origins(false, true),
            vec!["https://tauri.localhost"]
        );
    }

    /// Exercise the production manifest resolver and command environment.
    ///
    /// Desktop workflows opt into this ignored test with the final bundled
    /// resource path. Normal source tests skip it because they intentionally
    /// compile without a generated runtime.
    #[test]
    #[ignore = "requires LDACA_TEST_RUNTIME_ROOT from a packaged desktop bundle"]
    fn packaged_runtime_matches_launcher_environment() {
        use std::io::{Read, Write};

        let root = std::env::var_os("LDACA_TEST_RUNTIME_ROOT")
            .expect("LDACA_TEST_RUNTIME_ROOT must point to the bundled runtime");
        let runtime = BackendRuntime::from_root(root).expect("resolve packaged runtime");
        let fixture = std::env::temp_dir().join(format!(
            "wordflow-packaged-supervisor-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let token_cache = fixture.join("tokens.duckdb");
        std::fs::create_dir_all(&fixture).expect("create packaged fixture");
        let runtime_probe = format!(
            r#"
from pathlib import Path
import encodings
import ldaca_wordflow
import polars as pl
import polars_source_utils
import polars_text
import sys

tokenized = pl.DataFrame({{"text": ["Hello world"]}}).select(
    pl.col("text")
    .text.tokenize(model="native:plain_words_en", cache=Path({token_cache:?}))
    .alias("tokens")
)
assert tokenized.to_dicts()[0]["tokens"]
print(sys.version)
"#
        );
        let output = runtime_command(&runtime)
            .env("HOME", &fixture)
            .arg("-c")
            .arg(runtime_probe)
            .output()
            .expect("launch packaged Python");
        assert!(
            output.status.success(),
            "packaged imports and cached tokenization failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            !fixture.join(".duckdb").exists(),
            "packaged tokenization downloaded a DuckDB extension"
        );

        let startup_file = fixture.join("startup.json");
        std::fs::create_dir_all(&fixture).expect("create packaged fixture");
        let mut process =
            BackendProcess::spawn(&runtime, &startup_file).expect("spawn packaged backend");
        let cancelled = AtomicBool::new(false);
        let live = process
            .wait_until_live(&startup_file, &cancelled)
            .expect("packaged backend liveness");
        let port = live
            .url
            .rsplit_once(':')
            .expect("live URL port")
            .1
            .parse::<u16>()
            .expect("numeric port");
        let mut connection =
            std::net::TcpStream::connect((BACKEND_HOST, port)).expect("connect live backend");
        connection
            .write_all(b"GET /health/live HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
            .expect("write health request");
        let mut response = String::new();
        connection
            .read_to_string(&mut response)
            .expect("read health response");
        assert!(response.starts_with("HTTP/1.1 200"), "{response}");
        assert!(response.contains(r#""status":"live""#), "{response}");
        process.shutdown().expect("shutdown packaged backend");
        std::fs::remove_dir_all(fixture).expect("clean packaged fixture");
    }
}
