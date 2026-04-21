//! OS-specific helpers: path fix-ups for Windows, signal handling for Unix.

use std::path::{Path, PathBuf};

/// Windows: prevents a visible console window when spawning the Python child.
#[cfg(target_os = "windows")]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Strip Windows' `\\?\` extended-length path prefix.
///
/// Why this matters: some Python libraries (notably Jinja2's template loader
/// used by pandas Styler) join paths with forward slashes internally. The
/// `\\?\` prefix disables the Win32 path-normalization layer, so mixed
/// separators like `\\?\C:\...\templates/html.tpl` are rejected by the
/// kernel. Returning a plain drive-letter path restores compatibility.
///
/// No-op on non-Windows platforms.
pub fn strip_unc_prefix(path: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Some(s) = path.to_str() {
            if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
                return PathBuf::from(format!(r"\\{}", rest));
            }
            if let Some(rest) = s.strip_prefix(r"\\?\") {
                return PathBuf::from(rest);
            }
        }
    }
    path.to_path_buf()
}

/// Send SIGTERM so FastAPI can flush state before exiting.
///
/// Only called by `BackendProcessHandle::shutdown` on Unix; Windows falls
/// through to `child.kill()` because it has no directly-equivalent signal.
#[cfg(unix)]
pub fn send_sigterm(pid: u32) -> std::io::Result<()> {
    if pid == 0 {
        return Ok(());
    }
    let rc = unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) };
    if rc == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

/// Poll a child process until it exits or the timeout elapses.
///
/// Used after `send_sigterm` to decide whether a graceful shutdown worked;
/// the caller escalates to `Child::kill` on `false`.
#[cfg(unix)]
pub fn wait_for_child_exit(child: &mut std::process::Child, timeout: std::time::Duration) -> bool {
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) if start.elapsed() >= timeout => return false,
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(100)),
            Err(_) => return false,
        }
    }
}
