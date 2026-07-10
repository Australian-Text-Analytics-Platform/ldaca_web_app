use std::io;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::process::CommandExt as UnixCommandExt;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
pub(crate) const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
#[cfg(target_os = "windows")]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const APP_IDENTIFIER: &str = "au.edu.ldaca.text-analytics";

/// Apply process-group flags required for whole-tree backend shutdown.
///
/// Called by `BackendProcess::spawn`. Unix makes Python a process-group leader;
/// Windows creates a hidden process group, keeping platform mechanics out of
/// the cross-platform launcher.
pub(crate) fn configure_backend_command(command: &mut Command) {
    #[cfg(unix)]
    command.process_group(0);

    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
}

/// Stop the backend process tree, escalating after the supplied timeout.
///
/// Called by `BackendProcess::shutdown`. A cleanly exited child is accepted;
/// otherwise Unix signals the process group and Windows uses `taskkill /T`
/// before falling back to the immediate child handle.
pub(crate) fn terminate_process_tree(
    child: &mut Child,
    pid: u32,
    timeout: Duration,
) -> io::Result<()> {
    if child.try_wait()?.is_some() {
        return Ok(());
    }

    #[cfg(unix)]
    {
        if let Err(error) = send_signal_to_group(pid, libc::SIGTERM) {
            if error.raw_os_error() == Some(libc::ESRCH) {
                child.wait()?;
                return Ok(());
            }
            return Err(error);
        }
        if wait_for_child_exit(child, timeout)? {
            return Ok(());
        }
        send_signal_to_group(pid, libc::SIGKILL)?;
        child.wait()?;
        Ok(())
    }

    #[cfg(target_os = "windows")]
    {
        let status = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
        if status.is_ok_and(|value| value.success()) {
            child.wait()?;
            return Ok(());
        }
        child.kill()?;
        child.wait()?;
        Ok(())
    }
}

#[cfg(unix)]
fn send_signal_to_group(pid: u32, signal: libc::c_int) -> io::Result<()> {
    if pid == 0 {
        return Ok(());
    }
    let result = unsafe { libc::kill(-(pid as libc::pid_t), signal) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(unix)]
fn wait_for_child_exit(child: &mut Child, timeout: Duration) -> io::Result<bool> {
    let started = Instant::now();
    loop {
        if child.try_wait()?.is_some() {
            return Ok(true);
        }
        if started.elapsed() >= timeout {
            return Ok(false);
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn pidfile_path() -> Option<PathBuf> {
    let base: PathBuf;
    #[cfg(target_os = "macos")]
    {
        base = PathBuf::from(std::env::var_os("HOME")?)
            .join("Library")
            .join("Application Support");
    }
    #[cfg(target_os = "linux")]
    {
        base = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
            })?;
    }
    #[cfg(target_os = "windows")]
    {
        base = PathBuf::from(std::env::var_os("LOCALAPPDATA")?);
    }
    Some(base.join(APP_IDENTIFIER).join("backend.pid"))
}

/// Record the launched backend for crash recovery on the next app start.
///
/// Called immediately after spawn. Failure is logged rather than aborting a
/// healthy backend because the parent watchdog still provides crash cleanup.
pub(crate) fn write_pidfile(pid: u32) {
    let Some(path) = pidfile_path() else {
        return;
    };
    let result = path
        .parent()
        .ok_or_else(|| io::Error::other("pidfile has no parent"))
        .and_then(std::fs::create_dir_all)
        .and_then(|()| std::fs::write(&path, pid.to_string()));
    if let Err(error) = result {
        eprintln!("Could not write pidfile {}: {error}", path.display());
    }
}

/// Delete the crash-recovery pidfile after any normal shutdown path.
pub(crate) fn delete_pidfile() {
    if let Some(path) = pidfile_path() {
        if let Err(error) = std::fs::remove_file(&path) {
            if error.kind() != io::ErrorKind::NotFound {
                eprintln!("Could not delete pidfile {}: {error}", path.display());
            }
        }
    }
}

#[cfg(unix)]
fn process_is_alive(pid: u32) -> bool {
    pid != 0 && unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

#[cfg(target_os = "windows")]
fn process_is_alive(_pid: u32) -> bool {
    true
}

/// Reap a backend orphaned by a crashed prior desktop process.
///
/// Called before port selection in `run`. This is intentionally best-effort:
/// stale/malformed files are removed, and platform tree termination failures
/// are logged without making the desktop app permanently unstartable.
pub(crate) fn reap_stale_backend() {
    let Some(path) = pidfile_path() else {
        return;
    };
    let Ok(content) = std::fs::read_to_string(&path) else {
        return;
    };
    let Ok(pid) = content.trim().parse::<u32>() else {
        delete_pidfile();
        return;
    };
    if !process_is_alive(pid) {
        delete_pidfile();
        return;
    }

    println!("Reaping stale backend pid {pid} from {}", path.display());
    #[cfg(unix)]
    {
        if let Err(error) = send_signal_to_group(pid, libc::SIGTERM) {
            eprintln!("Could not terminate stale backend {pid}: {error}");
        } else {
            let deadline = Instant::now() + Duration::from_secs(3);
            while process_is_alive(pid) && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(100));
            }
            if process_is_alive(pid) {
                if let Err(error) = send_signal_to_group(pid, libc::SIGKILL) {
                    eprintln!("Could not kill stale backend {pid}: {error}");
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Err(error) = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
        {
            eprintln!("Could not terminate stale backend {pid}: {error}");
        }
    }
    delete_pidfile();
}
