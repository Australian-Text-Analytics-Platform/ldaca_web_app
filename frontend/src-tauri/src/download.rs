//! Native saves restricted to the supervised local backend and user-selected paths.

use crate::supervisor::BackendSupervisor;
use futures_util::StreamExt;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tokio::io::AsyncWriteExt;

fn safe_filename(name: &str) -> Result<&str, String> {
    let path = Path::new(name);
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    let windows_reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit()
            && stem.as_bytes()[3] != b'0');
    let valid = !name.is_empty()
        && name != "."
        && name != ".."
        && !name.ends_with('.')
        && !name.ends_with(' ')
        && !windows_reserved
        && path.file_name().and_then(|value| value.to_str()) == Some(name)
        && !name.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
        });
    valid
        .then_some(name)
        .ok_or_else(|| "invalid_download_filename".to_owned())
}

fn backend_download_url(base_url: &str, api_path: &str) -> Result<reqwest::Url, String> {
    if !api_path.starts_with("/api/")
        || api_path.contains('\\')
        || api_path.contains('#')
        || api_path.chars().any(char::is_control)
    {
        return Err("invalid_backend_download_path".to_owned());
    }
    let base = reqwest::Url::parse(&format!("{}/", base_url.trim_end_matches('/')))
        .map_err(|_| "backend_unavailable".to_owned())?;
    let url = base
        .join(api_path.trim_start_matches('/'))
        .map_err(|_| "invalid_backend_download_path".to_owned())?;
    if url.scheme() != base.scheme()
        || url.host_str() != base.host_str()
        || url.port_or_known_default() != base.port_or_known_default()
        || !url.path().starts_with("/api/")
    {
        return Err("invalid_backend_download_path".to_owned());
    }
    Ok(url)
}

fn temporary_path(target: &Path) -> Result<PathBuf, String> {
    let directory = target
        .parent()
        .ok_or_else(|| "download_directory_unavailable".to_owned())?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "download_clock_invalid".to_owned())?
        .as_nanos();
    Ok(directory.join(format!(
        ".wordflow-download-{}-{nonce}.part",
        std::process::id()
    )))
}

fn selected_save_path(window: &WebviewWindow, filename: &str) -> Result<Option<PathBuf>, String> {
    let filename = safe_filename(filename)?;
    window
        .dialog()
        .file()
        .set_parent(window)
        .set_file_name(filename)
        .blocking_save_file()
        .map(|path| {
            path.into_path()
                .map_err(|_| "download_path_unavailable".to_owned())
        })
        .transpose()
}

async fn install_temporary(target: &Path, temporary: &Path) -> Result<PathBuf, String> {
    tokio::fs::rename(temporary, target)
        .await
        .map_err(|_| "download_install_failed".to_owned())?;
    Ok(target.to_path_buf())
}

fn backend_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "download_client_failed".to_owned())
}

/// Stream one local API response to a private temporary file, then install it.
async fn download_response(
    target: &Path,
    request: reqwest::RequestBuilder,
) -> Result<(PathBuf, reqwest::header::HeaderMap), String> {
    let temporary = temporary_path(target)?;
    let response = request
        .send()
        .await
        .map_err(|_| "backend_download_failed".to_owned())?;
    if !response.status().is_success() {
        return Err(format!(
            "backend_download_http_{}",
            response.status().as_u16()
        ));
    }
    let response_headers = response.headers().clone();

    let result = async {
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .await
            .map_err(|_| "download_temporary_create_failed".to_owned())?;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            file.write_all(&chunk.map_err(|_| "backend_download_failed".to_owned())?)
                .await
                .map_err(|_| "download_write_failed".to_owned())?;
        }
        file.flush()
            .await
            .map_err(|_| "download_flush_failed".to_owned())?;
        file.sync_all()
            .await
            .map_err(|_| "download_flush_failed".to_owned())?;
        drop(file);
        install_temporary(target, &temporary).await
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&temporary).await;
    }
    result.map(|path| (path, response_headers))
}

async fn save_bytes(target: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    let temporary = temporary_path(target)?;
    let result = async {
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .await
            .map_err(|_| "download_temporary_create_failed".to_owned())?;
        file.write_all(bytes)
            .await
            .map_err(|_| "download_write_failed".to_owned())?;
        file.flush()
            .await
            .map_err(|_| "download_flush_failed".to_owned())?;
        file.sync_all()
            .await
            .map_err(|_| "download_flush_failed".to_owned())?;
        drop(file);
        install_temporary(target, &temporary).await
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&temporary).await;
    }
    result
}

/// Stream one GET-only relative `/api/` resource from the supervised backend.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackendDownloadResult {
    full_path: String,
    omitted_tab_count: u64,
    omitted_analysis_count: u64,
}

fn omission_count(headers: &reqwest::header::HeaderMap, name: &str) -> u64 {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok())
        .unwrap_or(0)
}

#[tauri::command]
pub(crate) async fn save_backend_download(
    window: WebviewWindow,
    state: State<'_, BackendSupervisor>,
    api_path: String,
    filename: String,
) -> Result<Option<BackendDownloadResult>, String> {
    let Some(target) = selected_save_path(&window, &filename)? else {
        return Ok(None);
    };
    let backend_url = state.backend_url()?;
    let url = backend_download_url(&backend_url, &api_path)?;
    let request = backend_client()?.get(url);
    download_response(&target, request)
        .await
        .map(|(path, headers)| BackendDownloadResult {
            full_path: path.to_string_lossy().into_owned(),
            omitted_tab_count: omission_count(&headers, "x-wordflow-omitted-tab-count"),
            omitted_analysis_count: omission_count(&headers, "x-wordflow-omitted-analysis-count"),
        })
        .map(Some)
}

#[derive(Serialize)]
struct DataBlockExportBody<'a> {
    node_ids: &'a [String],
    format: &'a str,
}

fn data_block_export_request(
    base_url: &str,
    workspace_id: &str,
    node_ids: &[String],
    format: &str,
    csrf_token: &str,
) -> Result<reqwest::RequestBuilder, String> {
    let valid_workspace_id = !workspace_id.is_empty()
        && workspace_id
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character == '-');
    if !valid_workspace_id || node_ids.is_empty() {
        return Err("invalid_data_block_export".to_owned());
    }
    if !matches!(format, "csv" | "json" | "ndjson" | "parquet" | "ipc") {
        return Err("invalid_data_block_export".to_owned());
    }
    let api_path = format!("/api/workspaces/{workspace_id}/nodes/exports");
    let url = backend_download_url(base_url, &api_path)?;
    let origin = url.origin().ascii_serialization();
    let csrf_header = reqwest::header::HeaderValue::from_str(csrf_token)
        .map_err(|_| "invalid_data_block_export".to_owned())?;
    let body = serde_json::to_vec(&DataBlockExportBody { node_ids, format })
        .map_err(|_| "invalid_data_block_export".to_owned())?;
    Ok(backend_client()?
        .post(url)
        .header(reqwest::header::ORIGIN, origin)
        .header("X-CSRF-Token", csrf_header)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body))
}

/// Stream the one supported POST export without exposing a generic HTTP proxy.
#[tauri::command]
pub(crate) async fn save_data_block_export(
    window: WebviewWindow,
    state: State<'_, BackendSupervisor>,
    workspace_id: String,
    node_ids: Vec<String>,
    format: String,
    filename: String,
    csrf_token: String,
) -> Result<Option<String>, String> {
    let Some(target) = selected_save_path(&window, &filename)? else {
        return Ok(None);
    };
    let backend_url = state.backend_url()?;
    let request =
        data_block_export_request(&backend_url, &workspace_id, &node_ids, &format, &csrf_token)?;
    download_response(&target, request)
        .await
        .map(|(path, _headers)| Some(path.to_string_lossy().into_owned()))
}

/// Save webview-generated bytes to a path selected by the native dialog.
#[tauri::command]
pub(crate) async fn save_generated_bytes(
    window: WebviewWindow,
    filename: String,
    bytes: Vec<u8>,
) -> Result<Option<String>, String> {
    let Some(target) = selected_save_path(&window, &filename)? else {
        return Ok(None);
    };
    save_bytes(&target, &bytes)
        .await
        .map(|path| Some(path.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn filename_and_url_boundaries_are_strict() {
        assert!(safe_filename("result.csv").is_ok());
        assert!(safe_filename("../result.csv").is_err());
        assert!(safe_filename("CON.txt").is_err());
        assert!(safe_filename("result.").is_err());
        assert!(backend_download_url("http://127.0.0.1:8001", "/api/files/1").is_ok());
        assert!(backend_download_url("http://127.0.0.1:8001", "https://evil.test").is_err());
        assert!(backend_download_url("http://127.0.0.1:8001", "/api/../health").is_err());
    }

    #[tokio::test]
    async fn native_download_streams_local_api_response_to_disk() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind fixture server");
        let address = listener.local_addr().expect("server address");
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            let mut request = [0_u8; 2048];
            let read = stream.read(&mut request).expect("read request");
            assert!(String::from_utf8_lossy(&request[..read]).contains("GET /api/file"));
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 7\r\nX-Wordflow-Omitted-Analysis-Count: 2\r\nConnection: close\r\n\r\npayload",
                )
                .expect("write response");
        });
        let directory = std::env::temp_dir().join(format!(
            "ldaca-download-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).expect("download directory");

        let url =
            backend_download_url(&format!("http://{address}"), "/api/file").expect("fixture URL");
        let target = directory.join("result.bin");
        let (output, headers) =
            download_response(&target, backend_client().expect("client").get(url))
                .await
                .expect("download succeeds");

        assert_eq!(std::fs::read(output).expect("read output"), b"payload");
        assert_eq!(
            omission_count(&headers, "x-wordflow-omitted-analysis-count"),
            2
        );
        server.join().expect("server thread");
        std::fs::remove_dir_all(directory).expect("remove downloads");
    }

    #[tokio::test]
    async fn native_byte_save_replaces_the_selected_file() {
        let directory = std::env::temp_dir().join(format!(
            "ldaca-byte-save-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).expect("download directory");
        let target = directory.join("result.bin");
        std::fs::write(&target, b"existing").expect("existing file");

        let output = save_bytes(&target, b"payload")
            .await
            .expect("byte save succeeds");

        assert_eq!(output, target);
        assert_eq!(std::fs::read(output).expect("read output"), b"payload");
        std::fs::remove_dir_all(directory).expect("remove downloads");
    }

    #[tokio::test]
    async fn failed_install_removes_the_temporary_file() {
        let directory = std::env::temp_dir().join(format!(
            "ldaca-byte-save-failure-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let target = directory.join("existing-directory");
        std::fs::create_dir_all(&target).expect("target directory");

        let result = save_bytes(&target, b"payload").await;
        let temporary_remains = std::fs::read_dir(&directory)
            .expect("read directory")
            .filter_map(Result::ok)
            .any(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".wordflow-download-")
            });

        assert!(result.is_err() && !temporary_remains);
        std::fs::remove_dir_all(directory).expect("remove downloads");
    }

    #[tokio::test]
    async fn data_block_export_uses_the_one_supported_post_contract() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind fixture server");
        let address = listener.local_addr().expect("server address");
        let (request_sender, request_receiver) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            let mut request = [0_u8; 4096];
            let read = stream.read(&mut request).expect("read request");
            request_sender
                .send(String::from_utf8_lossy(&request[..read]).into_owned())
                .expect("capture request");
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\npayload",
                )
                .expect("write response");
        });
        let directory = std::env::temp_dir().join(format!(
            "ldaca-post-download-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).expect("download directory");
        let node_ids = vec!["00000000-0000-0000-0000-000000000002".to_owned()];
        let request = data_block_export_request(
            &format!("http://{address}"),
            "00000000-0000-0000-0000-000000000001",
            &node_ids,
            "parquet",
            "desktop-csrf",
        )
        .expect("export request");

        download_response(&directory.join("result.parquet"), request)
            .await
            .expect("download succeeds");
        let captured = request_receiver.recv().expect("captured request");
        let captured_lower = captured.to_ascii_lowercase();

        assert!(captured.starts_with(
            "POST /api/workspaces/00000000-0000-0000-0000-000000000001/nodes/exports HTTP/1.1"
        ));
        assert!(captured_lower.contains(&format!("origin: http://{address}")));
        assert!(captured_lower.contains("x-csrf-token: desktop-csrf"));
        assert!(captured.contains(
            r#"{"node_ids":["00000000-0000-0000-0000-000000000002"],"format":"parquet"}"#
        ));
        server.join().expect("server thread");
        std::fs::remove_dir_all(directory).expect("remove downloads");
    }
}
