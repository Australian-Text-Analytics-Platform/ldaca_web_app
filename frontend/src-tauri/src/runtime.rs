//! Locate the bundled `uv` binary and the shipped backend project source.
//!
//! The bundle contains two resource trees (produced by
//! `scripts/package_backend_runtime.py`):
//!
//! - `uv-bin/uv` (or `uv.exe`): a pinned, statically-linked `uv` release.
//! - `backend-src/`: the workspace `pyproject.toml`, `uv.lock`, and the
//!   `backend/` source tree (including the pre-built frontend archive).
//!
//! At launch time the Rust shell invokes `uv run` against this project,
//! pointing uv at user-writable directories so the Python environment is
//! materialised on first launch and cached thereafter.

use std::path::PathBuf;

use tauri::{path::BaseDirectory, AppHandle, Manager};

use crate::platform::strip_unc_prefix;

const BUNDLE_UV_DIR: &str = "uv-bin";
const BUNDLE_BACKEND_SRC: &str = "backend-src";

/// Dev-mode fallback: when running `cargo run` / `tauri dev`, resources live
/// inside the un-bundled source tree.
const DEV_UV_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/uv-bin");
const DEV_BACKEND_SRC: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/backend-src");

/// Everything `backend::spawn` needs to launch `uv run`.
pub struct BackendRuntime {
    /// `uv` binary to execute.
    pub uv: PathBuf,
    /// Project root containing `pyproject.toml` + `uv.lock` + `backend/`.
    pub project: PathBuf,
}

pub fn locate(app: &AppHandle) -> Result<BackendRuntime, Box<dyn std::error::Error>> {
    let uv = resolve_resource(app, BUNDLE_UV_DIR, DEV_UV_DIR, "uv binary")?
        .join(uv_executable_name());
    if !uv.is_file() {
        return Err(format!("uv binary missing at {}", uv.display()).into());
    }

    let project = resolve_resource(app, BUNDLE_BACKEND_SRC, DEV_BACKEND_SRC, "backend-src")?;
    if !project.join("pyproject.toml").is_file() {
        return Err(format!(
            "backend-src is missing pyproject.toml (looked in {})",
            project.display()
        )
        .into());
    }

    Ok(BackendRuntime {
        uv: strip_unc_prefix(&uv),
        project: strip_unc_prefix(&project),
    })
}

fn resolve_resource(
    app: &AppHandle,
    bundle_name: &str,
    dev_path: &str,
    label: &str,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Ok(path) = app.path().resolve(bundle_name, BaseDirectory::Resource) {
        if path.exists() {
            return Ok(path);
        }
    }

    if cfg!(debug_assertions) {
        let dev = PathBuf::from(dev_path);
        if dev.exists() {
            return Ok(dev);
        }
    }

    Err(format!(
        "Could not locate {} (tried bundle resource `{}` and dev path `{}`)",
        label, bundle_name, dev_path
    )
    .into())
}

fn uv_executable_name() -> &'static str {
    if cfg!(windows) {
        "uv.exe"
    } else {
        "uv"
    }
}
