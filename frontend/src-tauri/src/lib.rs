mod backend_process;
mod data_root;
mod download;
mod platform;
mod runtime;

use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use backend_process::{BackendProcess, ReadyBackend};
use runtime::BackendRuntime;
use tauri::{Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

/// Tauri-owned application state for the local backend lifecycle.
///
/// Managed by [`run`]. The process has one owner behind one mutex; window-close
/// and app-exit handlers take the same value, making repeated shutdown paths
/// harmless without nested `Arc<Mutex<...>>` coordination.
pub(crate) struct BackendState {
    supervisor: Mutex<BackendSupervisor>,
    closing: AtomicBool,
}

struct BackendSupervisor {
    lifecycle: BackendLifecycle,
    runtime: Option<BackendRuntime>,
    config_path: Option<PathBuf>,
    data_root: Option<PathBuf>,
}

enum BackendLifecycle {
    Starting,
    Ready {
        url: String,
        process: BackendProcess,
    },
    Restarting,
    Failed {
        message: String,
    },
    Stopped,
}

#[tauri::command]
fn get_backend_url(state: State<'_, BackendState>) -> Result<String, String> {
    ready_backend_url(&state)
}

#[tauri::command]
fn get_data_root(state: State<'_, BackendState>) -> Result<Option<String>, String> {
    let supervisor = state
        .supervisor
        .lock()
        .map_err(|_| "backend_unavailable".to_owned())?;
    supervisor
        .data_root
        .as_ref()
        .map(|path| {
            path.to_str()
                .map(str::to_owned)
                .ok_or_else(|| "data_root_not_utf8".to_owned())
        })
        .transpose()
}

pub(crate) fn ready_backend_url(state: &BackendState) -> Result<String, String> {
    let supervisor = state
        .supervisor
        .lock()
        .map_err(|_| "backend_unavailable".to_owned())?;
    match &supervisor.lifecycle {
        BackendLifecycle::Ready { url, .. } => Ok(url.clone()),
        BackendLifecycle::Failed { message } => {
            eprintln!("Backend unavailable: {message}");
            Err("backend_unavailable".to_owned())
        }
        BackendLifecycle::Starting | BackendLifecycle::Restarting | BackendLifecycle::Stopped => {
            Err("backend_unavailable".to_owned())
        }
    }
}

fn boxed_error(message: impl Into<String>) -> Box<dyn std::error::Error> {
    Box::new(io::Error::other(message.into()))
}

fn startup_file(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let directory = app.path().app_cache_dir()?.join("backend-startup");
    std::fs::create_dir_all(&directory)?;
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    Ok(directory.join(format!("{}-{nonce}.json", std::process::id())))
}

fn data_root_config_path(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    Ok(app.path().app_config_dir()?.join("backend.json"))
}

fn take_backend_process(state: &BackendState) -> Option<BackendProcess> {
    state
        .supervisor
        .lock()
        .map(|mut supervisor| {
            match std::mem::replace(&mut supervisor.lifecycle, BackendLifecycle::Stopped) {
                BackendLifecycle::Ready { process, .. } => Some(process),
                _ => None,
            }
        })
        .unwrap_or_else(|_| {
            eprintln!("Backend lifecycle lock is poisoned");
            None
        })
}

fn show_startup_error(app: &tauri::AppHandle, detail: &str) {
    let handle = app.clone();
    app.dialog()
        .message(format!(
            "The local Wordflow backend could not start.\n\n{detail}\n\nResolve the reported startup error, then reopen the application."
        ))
        .kind(MessageDialogKind::Error)
        .title("Wordflow startup failed")
        .show(move |_| handle.exit(1));
}

fn launch_backend(
    runtime: &BackendRuntime,
    startup_path: &std::path::Path,
    data_root: Option<&std::path::Path>,
) -> io::Result<(BackendProcess, ReadyBackend)> {
    if startup_path.exists() {
        std::fs::remove_file(startup_path)?;
    }
    let mut process = BackendProcess::spawn(runtime, startup_path, data_root)?;
    match process.wait_until_ready(startup_path) {
        Ok(ready) => {
            let _ = std::fs::remove_file(startup_path);
            Ok((process, ready))
        }
        Err(error) => {
            let _ = process.shutdown();
            let _ = std::fs::remove_file(startup_path);
            Err(error)
        }
    }
}

enum SwitchOutcome {
    Ready {
        process: BackendProcess,
        ready: ReadyBackend,
    },
    RolledBack {
        process: BackendProcess,
        ready: ReadyBackend,
        error: String,
    },
    Failed(String),
}

/// Validate, restart, persist, and roll back a desktop data-root change.
#[tauri::command]
async fn set_data_root(
    app: tauri::AppHandle,
    state: State<'_, BackendState>,
    data_root: String,
) -> Result<String, String> {
    let candidate = tauri::async_runtime::spawn_blocking(move || {
        data_root::validate_data_root(&PathBuf::from(data_root))
    })
    .await
    .map_err(|_| "data_root_validation_failed".to_owned())?
    .map_err(|_| "data_root_invalid".to_owned())?;

    let candidate_startup = startup_file(&app).map_err(|_| "backend_unavailable".to_owned())?;
    let rollback_startup = startup_file(&app).map_err(|_| "backend_unavailable".to_owned())?;
    let (mut previous_process, runtime, previous_root, config_path) = {
        let mut supervisor = state
            .supervisor
            .lock()
            .map_err(|_| "backend_unavailable".to_owned())?;
        let runtime = supervisor
            .runtime
            .clone()
            .ok_or_else(|| "backend_unavailable".to_owned())?;
        let config_path = supervisor
            .config_path
            .clone()
            .ok_or_else(|| "backend_unavailable".to_owned())?;
        let lifecycle = std::mem::replace(&mut supervisor.lifecycle, BackendLifecycle::Restarting);
        let process = match lifecycle {
            BackendLifecycle::Ready { process, .. } => process,
            other => {
                supervisor.lifecycle = other;
                return Err("backend_unavailable".to_owned());
            }
        };
        (process, runtime, supervisor.data_root.clone(), config_path)
    };

    let candidate_for_switch = candidate.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = previous_process.shutdown() {
            drop(previous_process);
            return match launch_backend(&runtime, &rollback_startup, previous_root.as_deref()) {
                Ok((process, ready)) => SwitchOutcome::RolledBack {
                    process,
                    ready,
                    error: format!("Backend shutdown was uncertain: {error}"),
                },
                Err(rollback_error) => SwitchOutcome::Failed(format!(
                    "Backend shutdown and clean rollback failed: {error}; {rollback_error}"
                )),
            };
        }

        let candidate_backend =
            launch_backend(&runtime, &candidate_startup, Some(&candidate_for_switch));
        match candidate_backend {
            Ok((mut process, ready)) => {
                if let Err(error) = data_root::write_config(&config_path, &candidate_for_switch) {
                    let _ = process.shutdown();
                    return match launch_backend(
                        &runtime,
                        &rollback_startup,
                        previous_root.as_deref(),
                    ) {
                        Ok((process, ready)) => SwitchOutcome::RolledBack {
                            process,
                            ready,
                            error: format!("Data-root config persistence failed: {error}"),
                        },
                        Err(rollback_error) => SwitchOutcome::Failed(format!(
                            "Data-root persistence and rollback failed: {error}; {rollback_error}"
                        )),
                    };
                }
                SwitchOutcome::Ready { process, ready }
            }
            Err(error) => {
                match launch_backend(&runtime, &rollback_startup, previous_root.as_deref()) {
                    Ok((process, ready)) => SwitchOutcome::RolledBack {
                        process,
                        ready,
                        error: format!("Candidate backend failed: {error}"),
                    },
                    Err(rollback_error) => SwitchOutcome::Failed(format!(
                        "Candidate and rollback backends failed: {error}; {rollback_error}"
                    )),
                }
            }
        }
    })
    .await
    .map_err(|_| "backend_restart_failed".to_owned())?;

    let mut supervisor = match state.supervisor.lock() {
        Ok(supervisor) => supervisor,
        Err(_) => {
            match outcome {
                SwitchOutcome::Ready { mut process, .. }
                | SwitchOutcome::RolledBack { mut process, .. } => {
                    let _ = process.shutdown();
                }
                SwitchOutcome::Failed(_) => {}
            }
            return Err("backend_unavailable".to_owned());
        }
    };
    if !matches!(supervisor.lifecycle, BackendLifecycle::Restarting) {
        match outcome {
            SwitchOutcome::Ready { mut process, .. }
            | SwitchOutcome::RolledBack { mut process, .. } => {
                let _ = process.shutdown();
            }
            SwitchOutcome::Failed(_) => {}
        }
        return Err("backend_unavailable".to_owned());
    }
    match outcome {
        SwitchOutcome::Ready { process, ready } => {
            let url = ready.url;
            platform::write_pidfile(process.pid());
            supervisor.data_root = Some(candidate);
            supervisor.lifecycle = BackendLifecycle::Ready {
                url: url.clone(),
                process,
            };
            Ok(url)
        }
        SwitchOutcome::RolledBack {
            process,
            ready,
            error,
        } => {
            eprintln!("Data-root restart rolled back: {error}");
            platform::write_pidfile(process.pid());
            supervisor.lifecycle = BackendLifecycle::Ready {
                url: ready.url,
                process,
            };
            Err("data_root_restart_rolled_back".to_owned())
        }
        SwitchOutcome::Failed(error) => {
            eprintln!("Data-root restart failed: {error}");
            supervisor.lifecycle = BackendLifecycle::Failed {
                message: error.clone(),
            };
            Err("backend_restart_failed".to_owned())
        }
    }
}

/// Assemble and run the desktop shell around the React app and local backend.
///
/// Called only by `main.rs`. Runtime resolution, process lifecycle, platform
/// behavior, and native downloads live in focused modules; this function owns
/// Tauri wiring and the ordering between those domains.
pub fn run() {
    platform::reap_stale_backend();

    let state = BackendState {
        supervisor: Mutex::new(BackendSupervisor {
            lifecycle: BackendLifecycle::Starting,
            runtime: None,
            config_path: None,
            data_root: None,
        }),
        closing: AtomicBool::new(false),
    };

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            get_backend_url,
            get_data_root,
            set_data_root,
            download::download_to_downloads
        ])
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| boxed_error("Main window not found"))?;
            window.set_zoom(0.95)?;
            let layout = match runtime::locate_backend_runtime(app.handle()) {
                Ok(layout) => layout,
                Err(error) => {
                    eprintln!("Backend runtime resolution failed: {error}");
                    show_startup_error(app.handle(), &error.to_string());
                    return Ok(());
                }
            };
            let config_path = data_root_config_path(app.handle())?;
            let configured_data_root = match data_root::read_config(&config_path) {
                Ok(root) => root,
                Err(error) => {
                    eprintln!("Data-root configuration failed: {error}");
                    show_startup_error(app.handle(), &error.to_string());
                    return Ok(());
                }
            };
            let startup_file = startup_file(app.handle())?;
            if startup_file.exists() {
                std::fs::remove_file(&startup_file)?;
            }
            let mut process =
                BackendProcess::spawn(&layout, &startup_file, configured_data_root.as_deref())?;
            let pid = process.pid();
            platform::write_pidfile(pid);
            let ready = match process.wait_until_ready(&startup_file) {
                Ok(ready) => ready,
                Err(error) => {
                    eprintln!("Backend startup failed: {error}");
                    let _ = process.shutdown();
                    let _ = std::fs::remove_file(&startup_file);
                    let state: State<'_, BackendState> = app.state();
                    if let Ok(mut supervisor) = state.supervisor.lock() {
                        supervisor.lifecycle = BackendLifecycle::Failed {
                            message: error.to_string(),
                        };
                    }
                    show_startup_error(app.handle(), &error.to_string());
                    return Ok(());
                }
            };
            let _ = std::fs::remove_file(&startup_file);
            if let Err(error) = window.eval(format!(
                r#"window.__BACKEND_URL__ = "{}";
                console.log('[Tauri] Backend URL injected:', window.__BACKEND_URL__);"#,
                ready.url
            )) {
                let _ = process.shutdown();
                platform::delete_pidfile();
                return Err(error.into());
            }
            let state: State<'_, BackendState> = app.state();
            let mut supervisor = match state.supervisor.lock() {
                Ok(supervisor) => supervisor,
                Err(_) => {
                    let _ = process.shutdown();
                    platform::delete_pidfile();
                    return Err(boxed_error("Backend lifecycle lock is poisoned"));
                }
            };
            supervisor.lifecycle = BackendLifecycle::Ready {
                url: ready.url.clone(),
                process,
            };
            supervisor.runtime = Some(layout);
            supervisor.config_path = Some(config_path);
            supervisor.data_root = configured_data_root;
            drop(supervisor);
            if let Err(error) = window.show() {
                if let Some(mut process) = take_backend_process(&state) {
                    let _ = process.shutdown();
                }
                platform::delete_pidfile();
                return Err(error.into());
            }
            println!("Backend ready at {} (pid {pid})", ready.url);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state: State<'_, BackendState> = window.state();
                if state.closing.swap(true, Ordering::AcqRel) {
                    return;
                }

                api.prevent_close();
                let process = take_backend_process(&state);
                let window = window.clone();
                std::thread::spawn(move || {
                    if let Some(mut process) = process {
                        if let Err(error) = process.shutdown() {
                            eprintln!("Backend shutdown failed: {error}");
                        }
                    }
                    platform::delete_pidfile();
                    if let Err(error) = window.close() {
                        eprintln!("Failed to close desktop window: {error}");
                    }
                });
            }
        })
        .build(tauri::generate_context!());

    match app {
        Ok(app) => app.run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app_handle.try_state::<BackendState>() {
                    let process = take_backend_process(&state);
                    if let Some(mut process) = process {
                        if let Err(error) = process.shutdown() {
                            eprintln!("Backend shutdown failed during app exit: {error}");
                        }
                    }
                }
                platform::delete_pidfile();
            }
        }),
        Err(error) => eprintln!("Error while building Tauri application: {error}"),
    }
}
