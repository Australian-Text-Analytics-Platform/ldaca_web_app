use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::ipc::Channel;
use tauri::{
    AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_store::StoreExt;
use tauri_plugin_updater::{Update, UpdaterExt};

const CHECK_TIMEOUT: Duration = Duration::from_secs(15);
const AUTOMATIC_CHECK_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
const SETTINGS_STORE: &str = "updater-settings.json";
const AUTOMATIC_CHECKS_KEY: &str = "automaticChecks";
const LAST_CHECK_AT_KEY: &str = "lastCheckAt";
const SKIPPED_VERSION_KEY: &str = "skippedVersion";
pub(crate) const UPDATER_WINDOW_LABEL: &str = "updater";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateMetadata {
    current_version: String,
    version: String,
    publication_date: Option<String>,
    notes: Option<String>,
}

impl From<&Update> for UpdateMetadata {
    fn from(update: &Update) -> Self {
        let publication_date = update
            .raw_json
            .get("pub_date")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
            .or_else(|| update.date.map(|date| date.to_string()));
        let notes = update
            .body
            .as_deref()
            .filter(|body| !body.trim().is_empty())
            .map(str::to_owned);

        Self {
            current_version: update.current_version.clone(),
            version: update.version.clone(),
            publication_date,
            notes,
        }
    }
}

struct PendingUpdate {
    update: Update,
    metadata: UpdateMetadata,
}

struct DownloadedUpdate {
    update: Update,
    metadata: UpdateMetadata,
    bytes: Vec<u8>,
}

#[derive(Default)]
enum UpdateOperation {
    #[default]
    Idle,
    Available(PendingUpdate),
    Downloading(UpdateMetadata),
    ReadyToInstall(DownloadedUpdate),
    Installing,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OperationPhase {
    Idle,
    Available,
    Downloading,
    ReadyToInstall,
    Installing,
}

impl UpdateOperation {
    fn phase(&self) -> OperationPhase {
        match self {
            Self::Idle => OperationPhase::Idle,
            Self::Available(_) => OperationPhase::Available,
            Self::Downloading(_) => OperationPhase::Downloading,
            Self::ReadyToInstall(_) => OperationPhase::ReadyToInstall,
            Self::Installing => OperationPhase::Installing,
        }
    }
}

fn transition_allowed(from: OperationPhase, to: OperationPhase) -> bool {
    matches!(
        (from, to),
        (OperationPhase::Idle, OperationPhase::Available)
            | (OperationPhase::Available, OperationPhase::Idle)
            | (OperationPhase::Available, OperationPhase::Downloading)
            | (OperationPhase::Downloading, OperationPhase::Available)
            | (OperationPhase::Downloading, OperationPhase::ReadyToInstall)
            | (OperationPhase::ReadyToInstall, OperationPhase::Idle)
            | (OperationPhase::ReadyToInstall, OperationPhase::Installing)
            | (OperationPhase::Installing, OperationPhase::ReadyToInstall)
    )
}

#[derive(Default)]
pub(crate) struct DesktopUpdaterState {
    check_gate: tokio::sync::Mutex<()>,
    operation: Mutex<UpdateOperation>,
}

impl DesktopUpdaterState {
    fn snapshot(&self) -> Result<UpdaterSnapshot, String> {
        let operation = self
            .operation
            .lock()
            .map_err(|_| "The updater state is unavailable.".to_owned())?;
        Ok(match &*operation {
            UpdateOperation::Idle => UpdaterSnapshot::Idle,
            UpdateOperation::Available(pending) => UpdaterSnapshot::Available {
                update: pending.metadata.clone(),
            },
            UpdateOperation::Downloading(metadata) => UpdaterSnapshot::Downloading {
                update: metadata.clone(),
            },
            UpdateOperation::ReadyToInstall(downloaded) => UpdaterSnapshot::ReadyToInstall {
                update: downloaded.metadata.clone(),
            },
            UpdateOperation::Installing => UpdaterSnapshot::Installing,
        })
    }

    fn set_available(&self, pending: PendingUpdate) -> Result<(), String> {
        let mut operation = self
            .operation
            .lock()
            .map_err(|_| "The updater state is unavailable.".to_owned())?;
        let from = operation.phase();
        if from == OperationPhase::Available {
            *operation = UpdateOperation::Available(pending);
            return Ok(());
        }
        if from != OperationPhase::Idle || !transition_allowed(from, OperationPhase::Available) {
            return Err("Another update operation is already active.".to_owned());
        }
        *operation = UpdateOperation::Available(pending);
        Ok(())
    }

    fn clear_for_check(&self) -> Result<(), String> {
        let mut operation = self
            .operation
            .lock()
            .map_err(|_| "The updater state is unavailable.".to_owned())?;
        match operation.phase() {
            OperationPhase::Idle => Ok(()),
            OperationPhase::Available => {
                *operation = UpdateOperation::Idle;
                Ok(())
            }
            _ => Err("Another update operation is already active.".to_owned()),
        }
    }

    fn begin_download(&self) -> Result<PendingUpdate, String> {
        let mut operation = self
            .operation
            .lock()
            .map_err(|_| "The updater state is unavailable.".to_owned())?;
        let current = std::mem::take(&mut *operation);
        match current {
            UpdateOperation::Available(pending) => {
                *operation = UpdateOperation::Downloading(pending.metadata.clone());
                Ok(pending)
            }
            other => {
                *operation = other;
                Err("There is no update ready to download.".to_owned())
            }
        }
    }

    fn restore_available(&self, pending: PendingUpdate) -> Result<(), String> {
        let mut operation = self
            .operation
            .lock()
            .map_err(|_| "The updater state is unavailable.".to_owned())?;
        if !transition_allowed(operation.phase(), OperationPhase::Available) {
            return Err("The updater could not restore the available update.".to_owned());
        }
        *operation = UpdateOperation::Available(pending);
        Ok(())
    }

    fn finish_download(&self, downloaded: DownloadedUpdate) -> Result<(), String> {
        let mut operation = self
            .operation
            .lock()
            .map_err(|_| "The updater state is unavailable.".to_owned())?;
        if !transition_allowed(operation.phase(), OperationPhase::ReadyToInstall) {
            return Err("The updater download completed in an invalid state.".to_owned());
        }
        *operation = UpdateOperation::ReadyToInstall(downloaded);
        Ok(())
    }

    fn begin_install(&self) -> Result<DownloadedUpdate, String> {
        let mut operation = self
            .operation
            .lock()
            .map_err(|_| "The updater state is unavailable.".to_owned())?;
        let current = std::mem::take(&mut *operation);
        match current {
            UpdateOperation::ReadyToInstall(downloaded) => {
                *operation = UpdateOperation::Installing;
                Ok(downloaded)
            }
            other => {
                *operation = other;
                Err("There is no downloaded update ready to install.".to_owned())
            }
        }
    }

    fn restore_downloaded(&self, downloaded: DownloadedUpdate) -> Result<(), String> {
        let mut operation = self
            .operation
            .lock()
            .map_err(|_| "The updater state is unavailable.".to_owned())?;
        if !transition_allowed(operation.phase(), OperationPhase::ReadyToInstall) {
            return Err("The updater could not restore the downloaded update.".to_owned());
        }
        *operation = UpdateOperation::ReadyToInstall(downloaded);
        Ok(())
    }

    fn dismissible_version(&self) -> Result<Option<String>, String> {
        let operation = self
            .operation
            .lock()
            .map_err(|_| "The updater state is unavailable.".to_owned())?;
        Ok(match &*operation {
            UpdateOperation::Available(pending) => Some(pending.metadata.version.clone()),
            UpdateOperation::ReadyToInstall(downloaded) => {
                Some(downloaded.metadata.version.clone())
            }
            UpdateOperation::Idle => None,
            UpdateOperation::Downloading(_) | UpdateOperation::Installing => {
                return Err("Wait for the active update operation to finish.".to_owned());
            }
        })
    }

    fn dismiss(&self) -> Result<(), String> {
        let mut operation = self
            .operation
            .lock()
            .map_err(|_| "The updater state is unavailable.".to_owned())?;
        if matches!(
            *operation,
            UpdateOperation::Downloading(_) | UpdateOperation::Installing
        ) {
            return Err("Wait for the active update operation to finish.".to_owned());
        }
        *operation = UpdateOperation::Idle;
        Ok(())
    }

    fn prevents_close(&self) -> bool {
        self.operation
            .lock()
            .map(|operation| {
                matches!(
                    *operation,
                    UpdateOperation::Downloading(_) | UpdateOperation::Installing
                )
            })
            .unwrap_or(true)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum UpdaterSnapshot {
    Idle,
    Available { update: UpdateMetadata },
    Downloading { update: UpdateMetadata },
    ReadyToInstall { update: UpdateMetadata },
    Installing,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum CheckOutcome {
    UpToDate { current_version: String },
    Available { update: UpdateMetadata },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub(crate) enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DismissDisposition {
    Later,
    Skip,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdatePreferences {
    automatic_checks: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct StoredPreferences {
    automatic_checks: bool,
    last_check_at: Option<u64>,
    skipped_version: Option<String>,
}

impl Default for StoredPreferences {
    fn default() -> Self {
        Self {
            automatic_checks: true,
            last_check_at: None,
            skipped_version: None,
        }
    }
}

fn load_preferences(app: &AppHandle) -> Result<StoredPreferences, String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|error| error.to_string())?;
    Ok(StoredPreferences {
        automatic_checks: store
            .get(AUTOMATIC_CHECKS_KEY)
            .and_then(|value| value.as_bool())
            .unwrap_or(true),
        last_check_at: store
            .get(LAST_CHECK_AT_KEY)
            .and_then(|value| value.as_u64()),
        skipped_version: store
            .get(SKIPPED_VERSION_KEY)
            .and_then(|value| value.as_str().map(str::to_owned)),
    })
}

fn save_automatic_checks(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|error| error.to_string())?;
    store.set(AUTOMATIC_CHECKS_KEY, json!(enabled));
    store.save().map_err(|error| error.to_string())
}

fn save_last_check_at(app: &AppHandle, checked_at: u64) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|error| error.to_string())?;
    store.set(LAST_CHECK_AT_KEY, json!(checked_at));
    store.save().map_err(|error| error.to_string())
}

fn save_skipped_version(app: &AppHandle, version: &str) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|error| error.to_string())?;
    store.set(SKIPPED_VERSION_KEY, json!(version));
    store.save().map_err(|error| error.to_string())
}

fn clear_skipped_version(app: &AppHandle, version: &str) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|error| error.to_string())?;
    if store
        .get(SKIPPED_VERSION_KEY)
        .and_then(|value| value.as_str().map(str::to_owned))
        == Some(version.to_owned())
    {
        store.delete(SKIPPED_VERSION_KEY);
        store.save().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn now_epoch_seconds() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|error| error.to_string())
}

fn automatic_check_is_due(preferences: &StoredPreferences, now: u64) -> bool {
    preferences.automatic_checks
        && preferences.last_check_at.is_none_or(|last_check| {
            now.saturating_sub(last_check) >= AUTOMATIC_CHECK_INTERVAL.as_secs()
        })
}

fn should_present_update(manual: bool, skipped_version: Option<&str>, version: &str) -> bool {
    manual || skipped_version != Some(version)
}

fn validated_update_link(url: &str) -> Result<tauri::Url, String> {
    let parsed =
        tauri::Url::parse(url).map_err(|_| "The release-note link is invalid.".to_owned())?;
    if parsed.scheme() != "https" {
        return Err("Only HTTPS release-note links can be opened.".to_owned());
    }
    Ok(parsed)
}

async fn fetch_update(app: &AppHandle) -> Result<Option<Update>, String> {
    let updater = app
        .updater_builder()
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|error| error.to_string())?;
    updater.check().await.map_err(|error| error.to_string())
}

fn open_updater_window(app: &AppHandle, manual: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(UPDATER_WINDOW_LABEL) {
        window.show().map_err(|error| error.to_string())?;
        window.unminimize().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }

    let mode = if manual { "manual" } else { "available" };
    WebviewWindowBuilder::new(
        app,
        UPDATER_WINDOW_LABEL,
        WebviewUrl::App(format!("updater.html?mode={mode}").into()),
    )
    .title("LDaCA Wordflow Update")
    .inner_size(560.0, 640.0)
    .min_inner_size(480.0, 480.0)
    .resizable(true)
    .maximizable(false)
    .center()
    .build()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

pub(crate) fn show_manual_check(app: AppHandle) {
    if let Err(error) = open_updater_window(&app, true) {
        eprintln!("Failed to open the updater window: {error}");
    }
}

pub(crate) fn schedule_automatic_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let now = match now_epoch_seconds() {
            Ok(now) => now,
            Err(error) => {
                eprintln!("Could not determine the updater check time: {error}");
                return;
            }
        };
        let preferences = match load_preferences(&app) {
            Ok(preferences) => preferences,
            Err(error) => {
                eprintln!("Could not load updater preferences: {error}");
                StoredPreferences::default()
            }
        };
        if !automatic_check_is_due(&preferences, now) {
            return;
        }

        let state = app.state::<DesktopUpdaterState>();
        let _check_guard = state.check_gate.lock().await;
        let preferences = load_preferences(&app).unwrap_or_default();
        if !automatic_check_is_due(&preferences, now) {
            return;
        }

        let result = fetch_update(&app).await;
        if let Err(error) = save_last_check_at(&app, now) {
            eprintln!("Could not save the automatic update check time: {error}");
        }

        match result {
            Ok(Some(update)) => {
                let metadata = UpdateMetadata::from(&update);
                let current_preferences = load_preferences(&app).unwrap_or_default();
                if !current_preferences.automatic_checks
                    || !should_present_update(
                        false,
                        current_preferences.skipped_version.as_deref(),
                        &metadata.version,
                    )
                {
                    return;
                }
                if let Err(error) = state.set_available(PendingUpdate { update, metadata }) {
                    eprintln!("Could not stage the automatic update: {error}");
                    return;
                }
                if let Err(error) = open_updater_window(&app, false) {
                    let _ = state.dismiss();
                    eprintln!("Failed to open the automatic updater window: {error}");
                }
            }
            Ok(None) => {}
            Err(error) => eprintln!("Automatic update check failed: {error}"),
        }
    });
}

fn require_window(window: &WebviewWindow, expected_label: &str) -> Result<(), String> {
    if window.label() == expected_label {
        Ok(())
    } else {
        Err("This command is not available from the current window.".to_owned())
    }
}

#[tauri::command]
pub(crate) fn get_updater_snapshot(
    window: WebviewWindow,
    state: tauri::State<'_, DesktopUpdaterState>,
) -> Result<UpdaterSnapshot, String> {
    require_window(&window, UPDATER_WINDOW_LABEL)?;
    state.snapshot()
}

#[tauri::command]
pub(crate) async fn check_for_updates(
    window: WebviewWindow,
    app: AppHandle,
    state: tauri::State<'_, DesktopUpdaterState>,
) -> Result<CheckOutcome, String> {
    require_window(&window, UPDATER_WINDOW_LABEL)?;
    let _check_guard = state.check_gate.lock().await;
    state.clear_for_check()?;
    let result = fetch_update(&app).await;
    if let Ok(now) = now_epoch_seconds() {
        if let Err(error) = save_last_check_at(&app, now) {
            eprintln!("Could not save the manual update check time: {error}");
        }
    }

    match result? {
        Some(update) => {
            let metadata = UpdateMetadata::from(&update);
            if app.get_webview_window(UPDATER_WINDOW_LABEL).is_some() {
                state.set_available(PendingUpdate {
                    update,
                    metadata: metadata.clone(),
                })?;
            }
            Ok(CheckOutcome::Available { update: metadata })
        }
        None => Ok(CheckOutcome::UpToDate {
            current_version: app.package_info().version.to_string(),
        }),
    }
}

#[tauri::command]
pub(crate) async fn download_update(
    window: WebviewWindow,
    app: AppHandle,
    state: tauri::State<'_, DesktopUpdaterState>,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    require_window(&window, UPDATER_WINDOW_LABEL)?;
    let pending = state.begin_download()?;
    if let Err(error) = clear_skipped_version(&app, &pending.metadata.version) {
        eprintln!("Could not clear the skipped update version: {error}");
    }

    let started = AtomicBool::new(false);
    let download_result = pending
        .update
        .download(
            |chunk_length, content_length| {
                if !started.swap(true, Ordering::Relaxed) {
                    let _ = on_event.send(DownloadEvent::Started { content_length });
                }
                let _ = on_event.send(DownloadEvent::Progress { chunk_length });
            },
            || {
                if !started.swap(true, Ordering::Relaxed) {
                    let _ = on_event.send(DownloadEvent::Started {
                        content_length: None,
                    });
                }
                let _ = on_event.send(DownloadEvent::Finished);
            },
        )
        .await;

    match download_result {
        Ok(bytes) => state.finish_download(DownloadedUpdate {
            update: pending.update,
            metadata: pending.metadata,
            bytes,
        }),
        Err(error) => {
            state.restore_available(pending)?;
            Err(error.to_string())
        }
    }
}

#[tauri::command]
pub(crate) fn install_update(
    window: WebviewWindow,
    app: AppHandle,
    state: tauri::State<'_, DesktopUpdaterState>,
) -> Result<(), String> {
    require_window(&window, UPDATER_WINDOW_LABEL)?;
    let downloaded = state.begin_install()?;
    if let Err(error) = downloaded.update.install(&downloaded.bytes) {
        state.restore_downloaded(downloaded)?;
        return Err(error.to_string());
    }
    app.restart();
}

#[tauri::command]
pub(crate) fn dismiss_update(
    window: WebviewWindow,
    app: AppHandle,
    state: tauri::State<'_, DesktopUpdaterState>,
    disposition: DismissDisposition,
) -> Result<(), String> {
    require_window(&window, UPDATER_WINDOW_LABEL)?;
    if matches!(disposition, DismissDisposition::Skip) {
        let version = state
            .dismissible_version()?
            .ok_or_else(|| "There is no update to skip.".to_owned())?;
        save_skipped_version(&app, &version)?;
    }
    state.dismiss()?;
    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn open_update_link(
    window: WebviewWindow,
    app: AppHandle,
    url: String,
) -> Result<(), String> {
    require_window(&window, UPDATER_WINDOW_LABEL)?;
    let parsed = validated_update_link(&url)?;
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn get_update_preferences(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<UpdatePreferences, String> {
    require_window(&window, "main")?;
    let preferences = load_preferences(&app)?;
    Ok(UpdatePreferences {
        automatic_checks: preferences.automatic_checks,
    })
}

#[tauri::command]
pub(crate) fn set_automatic_update_checks(
    window: WebviewWindow,
    app: AppHandle,
    enabled: bool,
) -> Result<UpdatePreferences, String> {
    require_window(&window, "main")?;
    save_automatic_checks(&app, enabled)?;
    if enabled {
        schedule_automatic_check(app);
    }
    Ok(UpdatePreferences {
        automatic_checks: enabled,
    })
}

pub(crate) fn handle_window_event(window: &Window, event: &WindowEvent) -> bool {
    if window.label() != UPDATER_WINDOW_LABEL {
        return false;
    }
    let WindowEvent::CloseRequested { .. } = event else {
        return false;
    };
    let state = window.state::<DesktopUpdaterState>();
    if state.prevents_close() {
        return true;
    }
    let _ = state.dismiss();
    false
}

#[cfg(test)]
mod tests {
    use super::{
        automatic_check_is_due, should_present_update, transition_allowed, validated_update_link,
        DesktopUpdaterState, OperationPhase, StoredPreferences, UpdaterSnapshot,
        AUTOMATIC_CHECK_INTERVAL,
    };

    #[test]
    fn automatic_checks_default_to_enabled_and_due() {
        let preferences = StoredPreferences::default();

        assert!(automatic_check_is_due(&preferences, 1_000));
    }

    #[test]
    fn disabled_automatic_checks_are_not_due() {
        let preferences = StoredPreferences {
            automatic_checks: false,
            last_check_at: None,
            skipped_version: None,
        };

        assert!(!automatic_check_is_due(&preferences, 1_000));
    }

    #[test]
    fn recent_automatic_check_is_not_due() {
        let now = AUTOMATIC_CHECK_INTERVAL.as_secs() + 100;
        let preferences = StoredPreferences {
            automatic_checks: true,
            last_check_at: Some(101),
            skipped_version: None,
        };

        assert!(!automatic_check_is_due(&preferences, now));
    }

    #[test]
    fn automatic_check_becomes_due_after_twenty_four_hours() {
        let preferences = StoredPreferences {
            automatic_checks: true,
            last_check_at: Some(100),
            skipped_version: None,
        };

        assert!(automatic_check_is_due(
            &preferences,
            100 + AUTOMATIC_CHECK_INTERVAL.as_secs()
        ));
    }

    #[test]
    fn skipped_version_is_suppressed_only_for_automatic_checks() {
        assert!(!should_present_update(false, Some("0.8.0"), "0.8.0"));
        assert!(should_present_update(true, Some("0.8.0"), "0.8.0"));
    }

    #[test]
    fn newer_version_is_not_suppressed_by_an_older_skip() {
        assert!(should_present_update(false, Some("0.8.0"), "0.8.1"));
    }

    #[test]
    fn release_note_links_allow_only_https() {
        assert!(validated_update_link("https://example.com/release").is_ok());
        assert!(validated_update_link("http://example.com/release").is_err());
        assert!(validated_update_link("file:///tmp/release").is_err());
        assert!(validated_update_link("not a URL").is_err());
    }

    #[test]
    fn operation_transitions_cover_download_and_install_recovery() {
        let transitions = [
            (OperationPhase::Idle, OperationPhase::Available),
            (OperationPhase::Available, OperationPhase::Downloading),
            (OperationPhase::Downloading, OperationPhase::Available),
            (OperationPhase::Downloading, OperationPhase::ReadyToInstall),
            (OperationPhase::ReadyToInstall, OperationPhase::Installing),
            (OperationPhase::Installing, OperationPhase::ReadyToInstall),
        ];

        assert!(transitions
            .into_iter()
            .all(|(from, to)| transition_allowed(from, to)));
    }

    #[test]
    fn check_gate_allows_only_one_active_check() {
        let state = DesktopUpdaterState::default();
        let guard = state
            .check_gate
            .try_lock()
            .expect("first check should start");

        assert!(state.check_gate.try_lock().is_err());
        drop(guard);
        assert!(state.check_gate.try_lock().is_ok());
    }

    #[test]
    fn dismissal_cleans_up_an_idle_operation() {
        let state = DesktopUpdaterState::default();

        state.dismiss().expect("idle dismissal should be harmless");

        assert_eq!(state.snapshot(), Ok(UpdaterSnapshot::Idle));
    }

    #[test]
    fn operation_transitions_reject_install_without_download() {
        assert!(!transition_allowed(
            OperationPhase::Available,
            OperationPhase::Installing
        ));
    }
}
