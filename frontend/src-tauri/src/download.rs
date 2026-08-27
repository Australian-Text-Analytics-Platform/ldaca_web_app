//! Native streaming downloads restricted to the supervised local backend.

use crate::{live_backend_url, BackendState};
use futures_util::StreamExt;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, State};
use tokio::io::AsyncWriteExt;

fn safe_filename(name: &str) -> Result<&str, String> {
    let path = Path::new(name);
    let valid = !name.is_empty()
        && name != "."
        && name != ".."
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

fn unique_path(directory: &Path, filename: &str) -> Result<PathBuf, String> {
    let candidate = directory.join(filename);
    if !candidate.exists() {
        return Ok(candidate);
    }
    let path = Path::new(filename);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(filename);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    (1..1000)
        .map(|index| directory.join(format!("{stem} ({index}){extension}")))
        .find(|path| !path.exists())
        .ok_or_else(|| "download_name_exhausted".to_owned())
}

fn backend_download_url(base_url: &str, api_path: &str) -> Result<reqwest::Url, String> {
    if !api_path.starts_with("/api/")
        || api_path.contains('\\')
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
    {
        return Err("invalid_backend_download_path".to_owned());
    }
    Ok(url)
}

/// Stream one local API response to a private temporary file, then install it.
async fn download_from_backend(
    directory: &Path,
    base_url: &str,
    api_path: &str,
    filename: &str,
) -> Result<PathBuf, String> {
    let filename = safe_filename(filename)?;
    let target = unique_path(directory, filename)?;
    let url = backend_download_url(base_url, api_path)?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "download_clock_invalid".to_owned())?
        .as_nanos();
    let temporary = directory.join(format!(".{filename}.{}-{nonce}.part", std::process::id()));
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "download_client_failed".to_owned())?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "backend_download_failed".to_owned())?;
    if !response.status().is_success() {
        return Err(format!(
            "backend_download_http_{}",
            response.status().as_u16()
        ));
    }

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
        tokio::fs::hard_link(&temporary, &target)
            .await
            .map_err(|_| "download_install_failed".to_owned())?;
        tokio::fs::remove_file(&temporary)
            .await
            .map_err(|_| "download_cleanup_failed".to_owned())?;
        Ok::<(), String>(())
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&temporary).await;
    }
    result.map(|()| target)
}

/// Download only a relative `/api/` resource from the ready supervised backend.
#[tauri::command]
pub(crate) async fn download_to_downloads(
    app: tauri::AppHandle,
    state: State<'_, BackendState>,
    api_path: String,
    filename: String,
) -> Result<String, String> {
    let backend_url = live_backend_url(&state)?;
    let directory = app
        .path()
        .download_dir()
        .map_err(|_| "download_directory_unavailable".to_owned())?;
    download_from_backend(&directory, &backend_url, &api_path, &filename)
        .await
        .map(|path| path.to_string_lossy().into_owned())
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
        assert!(backend_download_url("http://127.0.0.1:8001", "/api/files/1").is_ok());
        assert!(backend_download_url("http://127.0.0.1:8001", "https://evil.test").is_err());
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
                    b"HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\npayload",
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

        let output = download_from_backend(
            &directory,
            &format!("http://{address}"),
            "/api/file",
            "result.bin",
        )
        .await
        .expect("download succeeds");

        assert_eq!(std::fs::read(output).expect("read output"), b"payload");
        server.join().expect("server thread");
        std::fs::remove_dir_all(directory).expect("remove downloads");
    }
}
