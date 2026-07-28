use std::io;
use std::process::{Child, Command};
use std::time::Duration;
#[cfg(unix)]
use std::time::Instant;

#[cfg(unix)]
use std::os::unix::process::CommandExt as UnixCommandExt;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
pub(crate) const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
#[cfg(target_os = "windows")]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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
        // taskkill /T fells the whole tree at once; no grace window applies.
        let _ = timeout;
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
