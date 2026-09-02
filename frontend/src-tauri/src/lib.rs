mod backend_process;
mod desktop_updater;
mod download;
mod platform;
mod runtime;
mod supervisor;

use std::io;

use tauri::menu::{Menu, MenuItemBuilder};
#[cfg(not(target_os = "macos"))]
use tauri::menu::{PredefinedMenuItem, HELP_SUBMENU_ID};
use tauri::{Manager, State};

#[tauri::command]
fn get_backend_url(state: State<'_, supervisor::BackendSupervisor>) -> Result<String, String> {
    state.backend_url()
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

/// Assemble and run the desktop shell around the React app and local backend.
///
/// Called only by `main.rs`. Runtime resolution, process lifecycle, platform
/// behavior, and native downloads live in focused modules; this function owns
/// Tauri wiring and the ordering between those domains.
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_plugin_liquid_glass::init());

    let app = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(supervisor::BackendSupervisor::new())
        .manage(desktop_updater::DesktopUpdaterState::default())
        .invoke_handler(tauri::generate_handler![
            get_backend_url,
            desktop_updater::get_updater_snapshot,
            desktop_updater::check_for_updates,
            desktop_updater::download_update,
            desktop_updater::install_update,
            desktop_updater::dismiss_update,
            desktop_updater::open_update_link,
            desktop_updater::get_update_preferences,
            desktop_updater::set_automatic_update_checks,
            download::save_backend_download,
            download::save_data_block_export,
            download::save_generated_bytes
        ])
        .setup(|app| {
            install_application_menu(app.handle())?;
            app.on_menu_event(|app_handle, event| {
                if event.id() == CHECK_FOR_UPDATES_MENU_ID {
                    desktop_updater::show_manual_check(app_handle.clone());
                }
            });
            app.get_webview_window("main")
                .ok_or_else(|| boxed_error("Main window not found"))?;
            supervisor::start(app.handle().clone());
            desktop_updater::schedule_automatic_check(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if desktop_updater::handle_window_event(window, event) {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                }
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && supervisor::request_window_close(window.clone()) {
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!());

    match app {
        Ok(app) => app.run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                supervisor::shutdown_on_exit(app_handle);
            }
        }),
        Err(error) => eprintln!("Error while building Tauri application: {error}"),
    }
}
