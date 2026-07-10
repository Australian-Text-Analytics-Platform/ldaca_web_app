fn main() {
    // Cargo source checks run without the generated runtime. Tauri's
    // beforeBuildCommand is the packaging gate; when the resource is absent
    // here, suppress only build-script resource copying so tests and Clippy
    // can compile the handwritten shell.
    if !std::path::Path::new("backend-runtime/runtime-manifest.json").is_file() {
        std::env::set_var("TAURI_CONFIG", r#"{"bundle":{"resources":[]}}"#);
    }
    tauri_build::build()
}
