use crate::platform;
use crate::runtime::BackendRuntime;
use std::io::{self, BufRead, BufReader};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

pub(crate) const BACKEND_HOST: &str = "127.0.0.1";
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(7);

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
    /// Called during Tauri setup. Environment construction consumes manifest
    /// fields directly; no path scanning or venv fallback occurs here.
    pub(crate) fn spawn(runtime: &BackendRuntime, port: u16) -> io::Result<Self> {
        let mut command = runtime_command(runtime);
        command
            .arg("-m")
            .arg("ldaca_wordflow.cli")
            .arg("--backend")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("BACKEND_PORT", port.to_string())
            .env("LDACA_BACKEND_PORT", port.to_string());
        platform::configure_backend_command(&mut command);

        println!(
            "Launching backend via {} (runtime: {}) on port {port}",
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
        platform::terminate_process_tree(&mut child, self.pid, timeout)
    }

    #[cfg(test)]
    fn from_child(child: Child) -> Self {
        Self {
            pid: child.id(),
            child: Some(child),
        }
    }
}

/// Build the exact packaged-Python command environment shared by launch and CI.
///
/// Production adds backend CLI arguments and process-group flags; the ignored
/// packaged-runtime test adds an import probe. Sharing this function prevents
/// validation from drifting back to a venv launcher or partial environment.
fn runtime_command(runtime: &BackendRuntime) -> Command {
    let host = server_host();
    let mut command = Command::new(&runtime.python);
    command
        .current_dir(&runtime.root)
        .env("PYTHONUNBUFFERED", "1")
        .env("LDACA_BACKEND_RUNTIME", &runtime.root)
        .env("LDACA_BACKEND_PYTHON", &runtime.python)
        .env("LDACA_PARENT_PID", std::process::id().to_string())
        .env("PYTHONHOME", &runtime.python_home)
        .env("PYTHONPATH", &runtime.site_packages)
        .env("PYTHONNOUSERSITE", "1")
        .env("SERVER_HOST", &host)
        .env("LDACA_SERVER_HOST", host);
    if std::env::var_os("LDACA_CONFIG_PROFILE").is_none() {
        command.env("LDACA_CONFIG_PROFILE", "desktop");
    }
    #[cfg(target_os = "windows")]
    prepend_python_home_to_path(&mut command, &runtime.python_home);
    command
}

fn server_host() -> String {
    std::env::var("SERVER_HOST")
        .ok()
        .or_else(|| std::env::var("LDACA_SERVER_HOST").ok())
        .unwrap_or_else(|| BACKEND_HOST.to_owned())
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

fn port_has_listener(port: u16) -> bool {
    TcpStream::connect((BACKEND_HOST, port)).is_ok()
}

fn can_bind_port(port: u16) -> bool {
    TcpListener::bind((BACKEND_HOST, port)).is_ok()
}

/// Find the first port that is neither listening nor reserved by another bind.
///
/// Called once by Tauri assembly before spawning Python. Checking both states
/// avoids selecting an active service while still treating bind failures as
/// unavailable.
pub(crate) fn find_available_port(start: u16, end: u16) -> Option<u16> {
    (start..=end).find(|port| !port_has_listener(*port) && can_bind_port(*port))
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
        while !pidfile.is_file() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        let descendant = std::fs::read_to_string(&pidfile)
            .expect("descendant pidfile")
            .trim()
            .parse::<u32>()
            .expect("descendant pid");

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
}

#[cfg(test)]
mod packaged_runtime_test {
    use super::*;

    /// Exercise the production manifest resolver and command environment.
    ///
    /// Desktop workflows opt into this ignored test with the final bundled
    /// resource path. Normal source tests skip it because they intentionally
    /// compile without a generated runtime.
    #[test]
    #[ignore = "requires LDACA_TEST_RUNTIME_ROOT from a packaged desktop bundle"]
    fn packaged_runtime_matches_launcher_environment() {
        let root = std::env::var_os("LDACA_TEST_RUNTIME_ROOT")
            .expect("LDACA_TEST_RUNTIME_ROOT must point to the bundled runtime");
        let runtime = BackendRuntime::from_root(root).expect("resolve packaged runtime");
        let output = runtime_command(&runtime)
            .arg("-c")
            .arg(
                "import encodings, ldaca_wordflow, polars_source_utils, polars_text, sys; print(sys.version)",
            )
            .output()
            .expect("launch packaged Python");
        assert!(
            output.status.success(),
            "packaged imports failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
