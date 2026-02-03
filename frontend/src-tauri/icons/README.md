# Icon Generation

## Current Status

Basic PNG icons have been copied from the frontend logos:
- 32x32.png
- 128x128.png
- 128x128@2x.png
- icon.png

## Missing Icons

The following platform-specific icons need to be generated:
- **icon.icns** (macOS) - requires `iconutil` (macOS only)
- **icon.ico** (Windows) - requires ImageMagick

## To Generate All Icons

### Option 1: Use the script (requires ImageMagick)

```bash
# Install ImageMagick
brew install imagemagick  # macOS
# or
sudo apt-get install imagemagick  # Linux

# Run the generation script
bash generate-icons.sh
```

### Option 2: Use Tauri Icon Generator (recommended)

```bash
npm install -g @tauri-apps/cli
cargo install tauri-cli

# From the frontend directory
tauri icon ../frontend/public/logo512.png
```

This will automatically generate all required icon formats.

### Option 3: Manual Generation

Use any icon generator tool to create:
- 32x32.png
- 128x128.png
- 128x128@2x.png (256x256)
- icon.icns (macOS bundle)
- icon.ico (Windows executable)

## For Development

The current PNG icons are sufficient for development and testing. Platform-specific icons (.icns, .ico) are only required for production builds on macOS and Windows respectively.
