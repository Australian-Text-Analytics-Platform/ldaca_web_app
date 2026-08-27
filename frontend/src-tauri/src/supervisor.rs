//! Lifecycle owner for the local Python backend.

use crate::backend_process::BackendProcess;
use crate::runtime;
use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Window};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

/// Tauri-managed owner of backend startup, readiness, and shutdown.
pub(crate) struct BackendSupervisor {
    lifecycle: Mutex<BackendLifecycle>,
    startup_cancelled: Arc<AtomicBool>,
    closing: AtomicBool,
}

enum BackendLifecycle {
    Starting,
    Live {
        url: String,
        process: BackendProcess,
    },
    Failed {
        message: String,
    },
    Stopped,
}

struct StartedBackend {
    url: String,
    pid: u32,
    process: BackendProcess,
}

impl BackendSupervisor {
    pub(crate) fn new() -> Self {
        Self {
            lifecycle: Mutex::new(BackendLifecycle::Starting),
            startup_cancelled: Arc::new(AtomicBool::new(false)),
            closing: AtomicBool::new(false),
        }
    }

    pub(crate) fn backend_url(&self) -> Result<String, String> {
        let lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| "backend_unavailable".to_owned())?;
        match &*lifecycle {
            BackendLifecycle::Live { url, .. } => Ok(url.clone()),
            BackendLifecycle::Failed { message } => {
                eprintln!("Backend unavailable: {message}");
                Err("backend_unavailable".to_owned())
            }
            BackendLifecycle::Starting | BackendLifecycle::Stopped => {
                Err("backend_unavailable".to_owned())
            }
        }
    }

    fn cancellation(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.startup_cancelled)
    }

    fn publish_live(&self, url: String, process: BackendProcess) -> bool {
        if self.startup_cancelled.load(Ordering::Acquire) {
            return false;
        }
        let Ok(mut lifecycle) = self.lifecycle.lock() else {
            eprintln!("Backend lifecycle lock is poisoned");
            return false;
        };
        if self.startup_cancelled.load(Ordering::Acquire)
            || !matches!(*lifecycle, BackendLifecycle::Starting)
        {
            return false;
        }
        *lifecycle = BackendLifecycle::Live { url, process };
        true
    }

    fn publish_failed(&self, message: String) -> bool {
        if self.startup_cancelled.load(Ordering::Acquire) {
            return false;
        }
        let Ok(mut lifecycle) = self.lifecycle.lock() else {
            eprintln!("Backend lifecycle lock is poisoned");
            return false;
        };
        if self.startup_cancelled.load(Ordering::Acquire)
            || !matches!(*lifecycle, BackendLifecycle::Starting)
        {
            return false;
        }
        *lifecycle = BackendLifecycle::Failed { message };
        true
    }

    /// Cancel startup and take the live child, if ownership was published.
    fn stop(&self) -> Option<BackendProcess> {
        self.startup_cancelled.store(true, Ordering::Release);
        self.lifecycle
            .lock()
            .map(|mut lifecycle| {
                match std::mem::replace(&mut *lifecycle, BackendLifecycle::Stopped) {
                    BackendLifecycle::Live { process, .. } => Some(process),
                    _ => None,
                }
            })
            .unwrap_or_else(|_| {
                eprintln!("Backend lifecycle lock is poisoned");
                None
            })
    }
}

fn startup_file(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("backend-startup");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    Ok(directory.join(format!("{}-{nonce}.json", std::process::id())))
}

fn try_start_backend(app: &AppHandle, cancelled: &AtomicBool) -> Result<StartedBackend, String> {
    if cancelled.load(Ordering::Acquire) {
        return Err("Backend startup was cancelled".to_owned());
    }
    let layout = runtime::locate_backend_runtime(app).map_err(|error| error.to_string())?;
    if cancelled.load(Ordering::Acquire) {
        return Err("Backend startup was cancelled".to_owned());
    }
    let startup_file = startup_file(app)?;
    let mut process = BackendProcess::spawn(&layout, &startup_file)
        .map_err(|error| format!("Cannot launch the backend: {error}"))?;
    let pid = process.pid();
    let result = process.wait_until_live(&startup_file, cancelled);
    if let Err(error) = fs::remove_file(&startup_file) {
        if error.kind() != io::ErrorKind::NotFound {
            eprintln!("Failed to remove backend startup record: {error}");
        }
    }
    let live = result.map_err(|error| error.to_string())?;
    Ok(StartedBackend {
        url: live.url,
        pid,
        process,
    })
}

fn show_startup_error(app: &AppHandle, detail: &str) {
    let handle = app.clone();
    app.dialog()
        .message(format!(
            "The local Wordflow backend could not start.\n\n{detail}\n\nResolve the reported startup error, then reopen the application."
        ))
        .kind(MessageDialogKind::Error)
        .title("Wordflow startup failed")
        .show(move |_| handle.exit(1));
}

fn schedule_startup_error(app: AppHandle, detail: String) {
    let ui_app = app.clone();
    if let Err(error) = app.run_on_main_thread(move || show_startup_error(&ui_app, &detail)) {
        eprintln!("Failed to schedule the backend startup error dialog: {error}");
    }
}

fn schedule_window_show(app: AppHandle, url: String, pid: u32) {
    let ui_app = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        let state = ui_app.state::<BackendSupervisor>();
        if state.closing.load(Ordering::Acquire) {
            return;
        }
        let Some(window) = ui_app.get_webview_window("main") else {
            let process = state.stop();
            shutdown_in_background(process, "after the main window disappeared");
            show_startup_error(&ui_app, "Main window not found");
            return;
        };
        if let Err(error) = window.show() {
            let process = state.stop();
            shutdown_in_background(process, "after the main window failed to open");
            show_startup_error(&ui_app, &format!("Cannot show the main window: {error}"));
            return;
        }
        println!("Backend live at {url} (pid {pid})");
    }) {
        eprintln!("Failed to schedule the main window: {error}");
        let process = app.state::<BackendSupervisor>().stop();
        shutdown_in_background(process, "after main-thread scheduling failed");
    }
}

fn shutdown_in_background(process: Option<BackendProcess>, context: &'static str) {
    if let Some(mut process) = process {
        std::thread::spawn(move || {
            if let Err(error) = process.shutdown() {
                eprintln!("Backend shutdown failed {context}: {error}");
            }
        });
    }
}

/// Start the local backend without blocking Tauri's setup/main thread.
pub(crate) fn start(app: AppHandle) {
    let cancelled = app.state::<BackendSupervisor>().cancellation();
    tauri::async_runtime::spawn_blocking(move || match try_start_backend(&app, &cancelled) {
        Ok(started) => {
            let url = started.url.clone();
            let pid = started.pid;
            let state = app.state::<BackendSupervisor>();
            if state.publish_live(started.url, started.process) {
                schedule_window_show(app, url, pid);
            }
        }
        Err(message) => {
            if cancelled.load(Ordering::Acquire) {
                return;
            }
            eprintln!("Backend startup failed: {message}");
            if app
                .state::<BackendSupervisor>()
                .publish_failed(message.clone())
            {
                schedule_startup_error(app, message);
            }
        }
    });
}

/// Begin asynchronous shutdown for a user-requested window close.
///
/// Returns whether the original close event must be prevented while shutdown
/// completes. A repeated event is allowed through.
pub(crate) fn request_window_close(window: Window) -> bool {
    let state = window.state::<BackendSupervisor>();
    if state.closing.swap(true, Ordering::AcqRel) {
        return false;
    }
    let process = state.stop();
    std::thread::spawn(move || {
        if let Some(mut process) = process {
            if let Err(error) = process.shutdown() {
                eprintln!("Backend shutdown failed: {error}");
            }
        }
        if let Err(error) = window.close() {
            eprintln!("Failed to close desktop window: {error}");
        }
    });
    true
}

/// Cancel startup or synchronously reap the live child during application exit.
pub(crate) fn shutdown_on_exit(app: &AppHandle) {
    if let Some(state) = app.try_state::<BackendSupervisor>() {
        if let Some(mut process) = state.stop() {
            if let Err(error) = process.shutdown() {
                eprintln!("Backend shutdown failed during app exit: {error}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stopping_during_startup_cancels_and_rejects_late_failure() {
        let supervisor = BackendSupervisor::new();

        assert!(supervisor.stop().is_none());
        assert!(supervisor.startup_cancelled.load(Ordering::Acquire));
        assert!(!supervisor.publish_failed("late failure".to_owned()));
        assert!(matches!(
            *supervisor.lifecycle.lock().expect("lifecycle"),
            BackendLifecycle::Stopped
        ));
    }

    #[test]
    fn failure_is_published_only_from_starting() {
        let supervisor = BackendSupervisor::new();

        assert!(supervisor.publish_failed("launch failed".to_owned()));
        assert!(!supervisor.publish_failed("second failure".to_owned()));
        assert!(matches!(
            *supervisor.lifecycle.lock().expect("lifecycle"),
            BackendLifecycle::Failed { .. }
        ));
        assert_eq!(
            supervisor.backend_url(),
            Err("backend_unavailable".to_owned())
        );
    }
}
