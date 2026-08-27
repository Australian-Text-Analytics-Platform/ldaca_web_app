use serde::Deserialize;
use std::error::Error;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use tauri::{path::BaseDirectory, AppHandle, Manager};

const DEV_BACKEND_RUNTIME: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/backend-runtime");
const BUNDLE_RUNTIME_DIR: &str = "backend-runtime";
const RUNTIME_MANIFEST: &str = "runtime-manifest.json";

#[derive(Debug, Deserialize)]
struct RuntimeManifest {
    schema_version: u32,
    backend_version: String,
    target_os: String,
    target_arch: String,
    python_selector: String,
    python_version: String,
    python_free_threaded: bool,
    uv_lock_sha256: String,
    python_executable: String,
    python_home: String,
    site_packages: String,
}

/// Fully resolved packaged-Python layout used by backend launch and validation.
///
/// Constructed only by [`BackendRuntime::from_root`]. All fields originate in
/// one relative manifest and are resolved once against the runtime resource
/// root, so consumers never repeat platform directory scans.
#[derive(Clone, Debug)]
pub(crate) struct BackendRuntime {
    pub(crate) root: PathBuf,
    pub(crate) python: PathBuf,
    pub(crate) python_home: PathBuf,
    pub(crate) site_packages: PathBuf,
}

impl BackendRuntime {
    /// Parse and validate an authoritative runtime manifest.
    ///
    /// Used by [`locate_backend_runtime`] and unit tests. Validation rejects
    /// absolute, escaping, missing, or unsupported layouts before a process is
    /// spawned, which makes relocation failures explicit at the boundary.
    pub(crate) fn from_root(root: impl AsRef<Path>) -> Result<Self, Box<dyn Error>> {
        let root = strip_unc_prefix(root.as_ref());
        let manifest_path = root.join(RUNTIME_MANIFEST);
        let bytes = fs::read(&manifest_path).map_err(|error| {
            io::Error::new(
                error.kind(),
                format!("Cannot read {}: {error}", manifest_path.display()),
            )
        })?;
        let manifest: RuntimeManifest = serde_json::from_slice(&bytes).map_err(|error| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("Invalid {}: {error}", manifest_path.display()),
            )
        })?;
        if manifest.schema_version != 3 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!(
                    "Unsupported runtime manifest schema {}",
                    manifest.schema_version
                ),
            )
            .into());
        }
        if manifest.target_os != std::env::consts::OS
            || manifest.target_arch != std::env::consts::ARCH
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!(
                    "Runtime target {}/{} does not match {}/{}",
                    manifest.target_os,
                    manifest.target_arch,
                    std::env::consts::OS,
                    std::env::consts::ARCH
                ),
            )
            .into());
        }
        if manifest.backend_version != env!("CARGO_PKG_VERSION") {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!(
                    "Runtime backend version {} does not match desktop version {}",
                    manifest.backend_version,
                    env!("CARGO_PKG_VERSION")
                ),
            )
            .into());
        }
        if manifest.python_selector != "3.14"
            || !manifest.python_version.starts_with("3.14.")
            || manifest.python_free_threaded
            || manifest.uv_lock_sha256 != env!("LDACA_UV_LOCK_SHA256")
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Runtime Python or lock provenance is incompatible",
            )
            .into());
        }

        Ok(Self {
            python: resolve_manifest_path(&root, "python_executable", &manifest.python_executable)?,
            python_home: resolve_manifest_path(&root, "python_home", &manifest.python_home)?,
            site_packages: resolve_manifest_path(&root, "site_packages", &manifest.site_packages)?,
            root,
        })
    }
}

fn resolve_manifest_path(root: &Path, field: &str, value: &str) -> Result<PathBuf, Box<dyn Error>> {
    let path = Path::new(value);
    let portable = !value.is_empty()
        && !value.contains('\\')
        && !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)));
    if !portable {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Runtime manifest {field} must be a portable relative path"),
        )
        .into());
    }
    let resolved = strip_unc_prefix(&root.join(path));
    if !resolved.exists() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!(
                "Runtime manifest {field} does not exist: {}",
                resolved.display()
            ),
        )
        .into());
    }
    Ok(resolved)
}

/// Resolve the one runtime root selected by the compiled desktop profile.
///
/// Development builds explicitly enable `dev-runtime` and use the prepared
/// source-tree runtime. Packaged builds resolve only the Tauri resource path.
pub(crate) fn locate_backend_runtime(app: &AppHandle) -> Result<BackendRuntime, Box<dyn Error>> {
    let root = if cfg!(feature = "dev-runtime") {
        PathBuf::from(DEV_BACKEND_RUNTIME)
    } else {
        app.path()
            .resolve(BUNDLE_RUNTIME_DIR, BaseDirectory::Resource)
            .map_err(|error| io::Error::other(format!("Cannot resolve bundled runtime: {error}")))?
    };
    BackendRuntime::from_root(root)
}

/// Remove Windows extended path prefixes before forwarding paths to Python.
///
/// Used by manifest resolution because some Python libraries join paths with
/// forward slashes, which the extended Win32 prefix rejects. Other platforms
/// return the input unchanged.
fn strip_unc_prefix(path: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    if let Some(value) = path.to_str() {
        if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = value.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
    }
    path.to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture_root(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock must follow Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("ldaca-runtime-{name}-{nonce}"))
    }

    fn write_layout(root: &Path) {
        let python = root.join("managed-python/cpython-test/bin/python3");
        let home = root.join("managed-python/cpython-test");
        let site_packages = root.join("python/lib/python3.14/site-packages");
        fs::create_dir_all(python.parent().expect("python parent")).expect("python dir");
        fs::write(&python, b"fixture").expect("python fixture");
        fs::create_dir_all(&home).expect("home dir");
        fs::create_dir_all(&site_packages).expect("site packages");
        fs::write(
            root.join(RUNTIME_MANIFEST),
            format!(r#"{{"schema_version":3,"backend_version":"{}","target_os":"{}","target_arch":"{}","python_selector":"3.14","python_version":"3.14.0","python_free_threaded":false,"uv_lock_sha256":"{}","python_executable":"managed-python/cpython-test/bin/python3","python_home":"managed-python/cpython-test","site_packages":"python/lib/python3.14/site-packages"}}"#, env!("CARGO_PKG_VERSION"), std::env::consts::OS, std::env::consts::ARCH, env!("LDACA_UV_LOCK_SHA256")),
        )
        .expect("manifest");
    }

    #[test]
    fn relative_layout_survives_relocation() {
        let original = fixture_root("original");
        write_layout(&original);
        let relocated = fixture_root("relocated");
        fs::rename(&original, &relocated).expect("relocate runtime");

        let runtime = BackendRuntime::from_root(&relocated).expect("valid runtime");

        assert_eq!(runtime.root, relocated);
        assert!(runtime.python.starts_with(&runtime.root));
        assert!(runtime.python_home.starts_with(&runtime.root));
        assert!(runtime.site_packages.starts_with(&runtime.root));
        fs::remove_dir_all(&runtime.root).expect("remove fixture");
    }

    #[test]
    fn missing_corrupt_and_escaping_manifests_fail_at_resolution() {
        let root = fixture_root("invalid");
        fs::create_dir_all(&root).expect("fixture root");
        assert!(BackendRuntime::from_root(&root).is_err());

        fs::write(root.join(RUNTIME_MANIFEST), b"{").expect("corrupt manifest");
        assert!(BackendRuntime::from_root(&root).is_err());

        write_layout(&root);
        let manifest_path = root.join(RUNTIME_MANIFEST);
        let manifest = fs::read_to_string(&manifest_path).expect("read manifest");
        fs::write(
            &manifest_path,
            manifest.replace(
                r#""python_free_threaded":false"#,
                r#""python_free_threaded":true"#,
            ),
        )
        .expect("free-threaded manifest");
        assert!(BackendRuntime::from_root(&root).is_err());

        write_layout(&root);
        fs::write(
            root.join(RUNTIME_MANIFEST),
            format!(r#"{{"schema_version":3,"backend_version":"{}","target_os":"{}","target_arch":"{}","python_selector":"3.14","python_version":"3.14.0","python_free_threaded":false,"uv_lock_sha256":"{}","python_executable":"../python","python_home":"managed-python/cpython-test","site_packages":"python/lib/python3.14/site-packages"}}"#, env!("CARGO_PKG_VERSION"), std::env::consts::OS, std::env::consts::ARCH, env!("LDACA_UV_LOCK_SHA256")),
        )
        .expect("escaping manifest");
        let error = BackendRuntime::from_root(&root).expect_err("escape must fail");
        assert!(error.to_string().contains("portable relative path"));
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn stale_backend_version_and_lockfile_fail_at_resolution() {
        let root = fixture_root("stale-provenance");
        write_layout(&root);
        let manifest_path = root.join(RUNTIME_MANIFEST);
        let manifest = fs::read_to_string(&manifest_path).expect("read manifest");
        fs::write(
            &manifest_path,
            manifest.replace(env!("CARGO_PKG_VERSION"), "0.0.0-stale"),
        )
        .expect("stale version manifest");
        let error = BackendRuntime::from_root(&root).expect_err("stale version must fail");
        assert!(error.to_string().contains("does not match desktop version"));

        write_layout(&root);
        let manifest = fs::read_to_string(&manifest_path).expect("read manifest");
        fs::write(
            &manifest_path,
            manifest.replace(env!("LDACA_UV_LOCK_SHA256"), &"0".repeat(64)),
        )
        .expect("stale lock manifest");
        let error = BackendRuntime::from_root(&root).expect_err("stale lock must fail");
        assert!(error
            .to_string()
            .contains("lock provenance is incompatible"));
        fs::remove_dir_all(root).expect("remove fixture");
    }
}
