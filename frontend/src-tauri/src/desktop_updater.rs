use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::{Update, UpdaterExt};

const CHECK_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Default)]
pub(crate) struct DesktopUpdaterState {
    busy: AtomicBool,
}

impl DesktopUpdaterState {
    fn begin(&self) -> bool {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    fn finish(&self) {
        self.busy.store(false, Ordering::Release);
    }
}

fn show_result(app: &AppHandle, message: impl Into<String>, kind: MessageDialogKind) {
    app.dialog()
        .message(message)
        .title("LDaCA Wordflow Update")
        .kind(kind)
        .show(|_| {});
}

fn install(app: AppHandle, update: Update) {
    tauri::async_runtime::spawn(async move {
        let result = update.download_and_install(|_, _| {}, || {}).await;
        if let Err(error) = result {
            app.state::<DesktopUpdaterState>().finish();
            show_result(
                &app,
                format!("The update could not be installed.\n\n{error}"),
                MessageDialogKind::Error,
            );
            return;
        }
        app.restart();
    });
}

fn offer_update(app: AppHandle, update: Update) {
    let mut message = format!(
        "LDaCA Wordflow {} is available.\n\nDownload, install, and restart now?",
        update.version
    );
    if let Some(body) = update
        .body
        .as_deref()
        .filter(|body| !body.trim().is_empty())
    {
        message.push_str("\n\n");
        message.push_str(body);
    }

    let dialog_app = app.clone();
    app.dialog()
        .message(message)
        .title("Software Update")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Download and Restart".to_owned(),
            "Later".to_owned(),
        ))
        .show(move |accepted| {
            if accepted {
                install(dialog_app, update);
            } else {
                dialog_app.state::<DesktopUpdaterState>().finish();
            }
        });
}

pub(crate) fn check(app: AppHandle) {
    let state = app.state::<DesktopUpdaterState>();
    if !state.begin() {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let result = match app.updater_builder().timeout(CHECK_TIMEOUT).build() {
            Ok(updater) => updater.check().await.map_err(|error| error.to_string()),
            Err(error) => Err(error.to_string()),
        };

        match result {
            Ok(Some(update)) => offer_update(app, update),
            Ok(None) => {
                app.state::<DesktopUpdaterState>().finish();
                show_result(
                    &app,
                    "LDaCA Wordflow is up to date.",
                    MessageDialogKind::Info,
                );
            }
            Err(error) => {
                app.state::<DesktopUpdaterState>().finish();
                show_result(
                    &app,
                    format!("Could not check for updates.\n\n{error}"),
                    MessageDialogKind::Error,
                );
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::DesktopUpdaterState;

    #[test]
    fn updater_operation_is_single_flight() {
        let state = DesktopUpdaterState::default();

        assert!(state.begin());
        assert!(!state.begin());
    }

    #[test]
    fn finished_operation_can_start_again() {
        let state = DesktopUpdaterState::default();
        assert!(state.begin());

        state.finish();

        assert!(state.begin());
    }
}
