//! Desktop-owned validation and atomic persistence of the backend data root.

use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const CONFIG_SCHEMA: u32 = 1;

#[cfg(unix)]
fn sync_directory(path: &Path) -> io::Result<()> {
    let directory = fs::File::open(path)?;
    directory.sync_all()
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(target_os = "windows")]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    // SAFETY: both vectors are owned, NUL-terminated UTF-16 strings that live
    // for the complete call, and the flags request one atomic replacement.
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[derive(Debug, Deserialize, Serialize)]
struct DataRootConfig {
    schema_version: u32,
    data_root: PathBuf,
}

/// Canonicalize and prove read/write ownership without modifying existing data.
pub(crate) fn validate_data_root(candidate: &Path) -> io::Result<PathBuf> {
    if !candidate.is_absolute()
        || candidate
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Data root must be a normalized absolute path",
        ));
    }
    fs::create_dir_all(candidate)?;
    let canonical = dunce::canonicalize(candidate)?;
    if canonical != candidate {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Data root cannot contain aliases, links, or reparse points",
        ));
    }
    let metadata = canonical.symlink_metadata()?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Data root must be a real directory",
        ));
    }
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(io::Error::other)?
        .as_nanos();
    let probe = canonical.join(format!(
        ".wordflow-write-probe-{}-{nonce}",
        std::process::id()
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)?;
    file.write_all(b"wordflow")?;
    file.sync_all()?;
    drop(file);
    fs::remove_file(probe)?;
    Ok(canonical)
}

pub(crate) fn read_config(path: &Path) -> io::Result<Option<PathBuf>> {
    if !path.exists() {
        return Ok(None);
    }
    let config: DataRootConfig = serde_json::from_slice(&fs::read(path)?).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Invalid data-root config: {error}"),
        )
    })?;
    if config.schema_version != CONFIG_SCHEMA {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Unsupported data-root config schema",
        ));
    }
    validate_data_root(&config.data_root).map(Some)
}

pub(crate) fn write_config(path: &Path, data_root: &Path) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Config path has no parent"))?;
    fs::create_dir_all(parent)?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(io::Error::other)?
        .as_nanos();
    let temporary = parent.join(format!(".data-root-{}-{nonce}.tmp", std::process::id()));
    let content = serde_json::to_vec(&DataRootConfig {
        schema_version: CONFIG_SCHEMA,
        data_root: data_root.to_path_buf(),
    })?;
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(fs::Permissions::from_mode(0o600))?;
        }
        file.write_all(&content)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        drop(file);
        replace_file(&temporary, path)?;
        sync_directory(parent)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_round_trip_preserves_validated_root() {
        let base = std::env::temp_dir().join(format!(
            "wordflow-data-root-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let root = base.join("data");
        fs::create_dir_all(&root).expect("root");
        let root = root.canonicalize().expect("canonical root");
        let config = base.join("config/backend.json");

        write_config(&config, &root).expect("write config");
        assert_eq!(read_config(&config).expect("read config"), Some(root));

        fs::remove_dir_all(base).expect("cleanup");
    }
}
