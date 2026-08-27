mod backend_process;
mod desktop_updater;
mod download;
mod platform;
mod runtime;

use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use backend_process::BackendProcess;
use tauri::menu::{Menu, MenuItemBuilder};
#[cfg(not(target_os = "macos"))]
use tauri::menu::{PredefinedMenuItem, HELP_SUBMENU_ID};
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

#[tauri::command]
fn get_backend_url(state: State<'_, BackendState>) -> Result<String, String> {
    live_backend_url(&state)
}

pub(crate) fn live_backend_url(state: &BackendState) -> Result<String, String> {
    let supervisor = state
        .supervisor
        .lock()
        .map_err(|_| "backend_unavailable".to_owned())?;
    match &supervisor.lifecycle {
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

fn boxed_error(message: impl Into<String>) -> Box<dyn std::error::Error> {
    Box::new(io::Error::other(message.into()))
}

const CHECK_FOR_UPDATES_MENU_ID: &str = "check-for-updates";

fn install_application_menu(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let menu = Menu::default(app)?;
    let check_for_updates =
        MenuItemBuilder::with_id(CHECK_FOR_UPDATES_MENU_ID, "Check for Updates…").build(app)?;

    #[cfg(target_os = "macos")]
    {
        let application_menu = menu
            .items()?
            .into_iter()
            .next()
            .and_then(|item| item.as_submenu().cloned())
            .ok_or_else(|| boxed_error("Default macOS application menu not found"))?;
        application_menu.insert(&check_for_updates, 1)?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let help_menu = menu
            .get(HELP_SUBMENU_ID)
            .and_then(|item| item.as_submenu().cloned())
            .ok_or_else(|| boxed_error("Default Help menu not found"))?;
        let separator = PredefinedMenuItem::separator(app)?;
        help_menu.prepend_items(&[&check_for_updates, &separator])?;
    }

    app.set_menu(menu)?;
    Ok(())
}

fn startup_file(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let directory = app.path().app_cache_dir()?.join("backend-startup");
    std::fs::create_dir_all(&directory)?;
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    Ok(directory.join(format!("{}-{nonce}.json", std::process::id())))
}

fn take_backend_process(state: &BackendState) -> Option<BackendProcess> {
    state
        .supervisor
        .lock()
        .map(|mut supervisor| {
            match std::mem::replace(&mut supervisor.lifecycle, BackendLifecycle::Stopped) {
                BackendLifecycle::Live { process, .. } => Some(process),
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

/// Assemble and run the desktop shell around the React app and local backend.
///
/// Called only by `main.rs`. Runtime resolution, process lifecycle, platform
/// behavior, and native downloads live in focused modules; this function owns
/// Tauri wiring and the ordering between those domains.
pub fn run() {
    let state = BackendState {
        supervisor: Mutex::new(BackendSupervisor {
            lifecycle: BackendLifecycle::Starting,
        }),
        closing: AtomicBool::new(false),
    };

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state)
        .manage(desktop_updater::DesktopUpdaterState::default())
        .invoke_handler(tauri::generate_handler![
            get_backend_url,
            download::download_to_downloads
        ])
        .setup(|app| {
            install_application_menu(app.handle())?;
            app.on_menu_event(|app_handle, event| {
                if event.id() == CHECK_FOR_UPDATES_MENU_ID {
                    desktop_updater::check(app_handle.clone());
                }
            });
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| boxed_error("Main window not found"))?;
            let layout = match runtime::locate_backend_runtime(app.handle()) {
                Ok(layout) => layout,
                Err(error) => {
                    eprintln!("Backend runtime resolution failed: {error}");
                    show_startup_error(app.handle(), &error.to_string());
                    return Ok(());
                }
            };
            let startup_file = startup_file(app.handle())?;
            if startup_file.exists() {
                std::fs::remove_file(&startup_file)?;
            }
            let mut process = BackendProcess::spawn(&layout, &startup_file)?;
            let pid = process.pid();
            let live = match process.wait_until_live(&startup_file) {
                Ok(live) => live,
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
            let state: State<'_, BackendState> = app.state();
            let mut supervisor = match state.supervisor.lock() {
                Ok(supervisor) => supervisor,
                Err(_) => {
                    let _ = process.shutdown();
                    return Err(boxed_error("Backend lifecycle lock is poisoned"));
                }
            };
            supervisor.lifecycle = BackendLifecycle::Live {
                url: live.url.clone(),
                process,
            };
            drop(supervisor);
            if let Err(error) = window.show() {
                if let Some(mut process) = take_backend_process(&state) {
                    let _ = process.shutdown();
                }
                return Err(error.into());
            }
            println!("Backend live at {} (pid {pid})", live.url);
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
            }
        }),
        Err(error) => eprintln!("Error while building Tauri application: {error}"),
    }
}
