use sha2::{Digest, Sha256};
use std::{env, fs, path::PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let lock_path = manifest_dir.join("../../backend/uv.lock");
    println!("cargo:rerun-if-changed={}", lock_path.display());
    let lock = fs::read(&lock_path).unwrap_or_else(|error| {
        panic!(
            "Cannot read backend lockfile {}: {error}",
            lock_path.display()
        )
    });
    println!(
        "cargo:rustc-env=LDACA_UV_LOCK_SHA256={:x}",
        Sha256::digest(lock)
    );
    tauri_build::build()
}
