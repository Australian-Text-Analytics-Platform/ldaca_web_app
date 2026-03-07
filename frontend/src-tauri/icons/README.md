# Tauri App Icons

Pre-generated icon files for the Tauri desktop app.

## Contents

- `32x32.png`
- `128x128.png`
- `128x128@2x.png` (256×256)
- `icon.png` (1024×1024 master)
- `icon.icns` (macOS)
- `icon.ico` (Windows)

## Regenerating Icons

To regenerate from a source image, use the Tauri CLI:

```bash
cargo install tauri-cli
cargo tauri icon path/to/source-image.png
```

## For Development

The current PNG icons are sufficient for development and testing. Platform-specific icons (.icns, .ico) are only required for production builds on macOS and Windows respectively.
