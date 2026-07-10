use futures_util::StreamExt;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::Manager;
use tokio::io::AsyncWriteExt;

fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            value if value.is_control() => '_',
            value => value,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "download".to_owned()
    } else {
        trimmed.to_owned()
    }
}

fn unique_path(directory: &Path, filename: &str) -> PathBuf {
    let candidate = directory.join(filename);
    if !candidate.exists() {
        return candidate;
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
        .unwrap_or_else(|| directory.join(format!("{stem}-overflow{extension}")))
}

/// Stream one backend response directly into a destination directory.
///
/// Used by the Tauri command and its native-download test. Keeping WebView IPC
/// out of the body path preserves reliable large downloads while this helper
/// owns status handling, filename safety, collision handling, and disk flush.
async fn download_url(
    directory: &Path,
    url: &str,
    headers: &HashMap<String, String>,
    filename: &str,
) -> Result<PathBuf, String> {
    let target = unique_path(directory, &sanitize_filename(filename));
    let client = reqwest::Client::builder()
        .build()
        .map_err(|error| format!("Failed to build HTTP client: {error}"))?;
    let mut request = client.get(url);
    for (name, value) in headers {
        request = request.header(name, value);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("Request failed: {error}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {body}"));
    }

    let mut file = tokio::fs::File::create(&target)
        .await
        .map_err(|error| format!("Failed to create file {}: {error}", target.display()))?;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        file.write_all(&chunk.map_err(|error| format!("Failed to read response: {error}"))?)
            .await
            .map_err(|error| format!("Failed to write {}: {error}", target.display()))?;
    }
    file.flush()
        .await
        .map_err(|error| format!("Failed to flush {}: {error}", target.display()))?;
    Ok(target)
}

/// Native command for streaming large backend exports to Downloads.
///
/// Invoked by the frontend download boundary. Only the final path crosses IPC;
/// response bytes flow from reqwest to disk inside Rust.
#[tauri::command]
pub(crate) async fn download_to_downloads(
    app: tauri::AppHandle,
    url: String,
    headers: HashMap<String, String>,
    filename: String,
) -> Result<String, String> {
    let directory = app
        .path()
        .download_dir()
        .map_err(|error| format!("Cannot resolve Downloads directory: {error}"))?;
    download_url(&directory, &url, &headers, &filename)
        .await
        .map(|path| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn filename_safety_and_collision_are_deterministic() {
        let directory = std::env::temp_dir().join("ldaca-download-name-test");
        std::fs::create_dir_all(&directory).expect("create directory");
        let safe = sanitize_filename(" ../bad:name?.csv ");
        assert_eq!(safe, "_bad_name_.csv");
        let first = directory.join(&safe);
        std::fs::write(&first, b"existing").expect("write collision");
        assert_eq!(
            unique_path(&directory, &safe),
            directory.join("_bad_name_ (1).csv")
        );
        std::fs::remove_dir_all(directory).expect("remove directory");
    }

    #[tokio::test]
    async fn native_download_streams_response_to_disk() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind fixture server");
        let address = listener.local_addr().expect("server address");
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            let mut request = [0_u8; 2048];
            let read = stream.read(&mut request).expect("read request");
            assert!(String::from_utf8_lossy(&request[..read]).contains("x-test: value"));
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\npayload",
                )
                .expect("write response");
        });
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("ldaca-download-{nonce}"));
        std::fs::create_dir_all(&directory).expect("download directory");
        let headers = HashMap::from([("x-test".to_owned(), "value".to_owned())]);

        let output = download_url(
            &directory,
            &format!("http://{address}/file"),
            &headers,
            "result.bin",
        )
        .await
        .expect("download succeeds");

        assert_eq!(std::fs::read(output).expect("read output"), b"payload");
        server.join().expect("server thread");
        std::fs::remove_dir_all(directory).expect("remove downloads");
    }
}
