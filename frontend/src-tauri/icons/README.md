# Tauri App Icons

The Icon Composer document is the native source for the Wordflow app icon.
Rendered files provide fallbacks for older macOS versions and the other
desktop platforms.

## Contents

- `wordflow.icon` (Icon Composer source and macOS Liquid Glass icon)
- `32x32.png`
- `128x128.png`
- `128x128@2x.png` (256×256)
- `icon.png` (1024×1024 flattened master)
- `icon.icns` (macOS fallback)
- `icon.ico` (Windows)

## Regenerating Icons

Export a 1024×1024 macOS image from `wordflow.icon`, save it as `icon.png`,
then regenerate the platform fallbacks with the repository's Tauri CLI:

```bash
pnpm -C frontend exec tauri icon src-tauri/icons/icon.png --output src-tauri/icons
```

The browser favicon and startup icon are rendered from the same flattened
master. Keep them in sync when the native composition changes.

## Packaging

Tauri compiles `wordflow.icon` into the macOS asset catalog when the current
Apple toolchain supports Icon Composer bundles. `icon.icns` remains configured
as a compatibility fallback. Windows and development surfaces use the rendered
PNG or ICO files.
