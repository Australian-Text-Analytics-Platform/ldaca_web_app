#!/usr/bin/env bash
#
# Generate Tauri app icons from the frontend logo
#
# This script uses the frontend's logo to create all required icon formats for Tauri.
# Requires: ImageMagick (brew install imagemagick)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ICONS_DIR="$SCRIPT_DIR/icons"
SOURCE_ICON_SVG="$SCRIPT_DIR/../public/LDaCAFavicon_Dark.svg"
SOURCE_ICON_PNG="$SCRIPT_DIR/../public/logo512.png"
RENDER_DENSITY=1536

SOURCE_ICON=""
if [ -f "$SOURCE_ICON_SVG" ]; then
    SOURCE_ICON="$SOURCE_ICON_SVG"
elif [ -f "$SOURCE_ICON_PNG" ]; then
    SOURCE_ICON="$SOURCE_ICON_PNG"
fi

# Use ImageMagick's 'magick' CLI (user requested Python fallbacks be removed)
if ! command -v magick &> /dev/null; then
    echo "❌ ImageMagick (magick) not found. Please install it:"
    echo "   macOS: brew install imagemagick"
    echo "   Linux: sudo apt-get install imagemagick"
    exit 1
fi

# Check if source icon exists
if [ -z "$SOURCE_ICON" ]; then
    echo "❌ Source icon not found. Expected one of:"
    echo "   - $SOURCE_ICON_SVG"
    echo "   - $SOURCE_ICON_PNG"
    exit 1
fi

render_png_icon() {
    local size="$1"
    local output="$2"
    if [[ "$SOURCE_ICON" == *.svg ]]; then
        magick -density "$RENDER_DENSITY" "$SOURCE_ICON" \
          -background none \
          -filter LanczosSharp \
          -resize "${size}x${size}" \
          PNG32:"$output"
    else
        magick "$SOURCE_ICON" \
          -alpha set \
          -background none \
          -filter LanczosSharp \
          -resize "${size}x${size}" \
          PNG32:"$output"
    fi
}

echo "🎨 Generating Tauri icons from: $SOURCE_ICON"
echo ""

# Create icons directory
mkdir -p "$ICONS_DIR"

# Generate PNG icons (ensure alpha channel / RGBA - force PNG32 output)
echo "📱 Generating PNG icons..."
# Use PNG32: prefix to force RGBA (4-channel) PNG output which Tauri requires
render_png_icon 32 "$ICONS_DIR/32x32.png"
render_png_icon 128 "$ICONS_DIR/128x128.png"
render_png_icon 256 "$ICONS_DIR/128x128@2x.png"
render_png_icon 256 "$ICONS_DIR/icon.png"

# Generate macOS icon (.icns) - requires multiple sizes collected into an .iconset
echo "🍎 Generating macOS icon..."
ICONSET_DIR="$ICONS_DIR/icon.iconset"
mkdir -p "$ICONSET_DIR"

render_png_icon 16 "$ICONSET_DIR/icon_16x16.png"
render_png_icon 32 "$ICONSET_DIR/icon_16x16@2x.png"
render_png_icon 32 "$ICONSET_DIR/icon_32x32.png"
render_png_icon 64 "$ICONSET_DIR/icon_32x32@2x.png"
render_png_icon 128 "$ICONSET_DIR/icon_128x128.png"
render_png_icon 256 "$ICONSET_DIR/icon_128x128@2x.png"
render_png_icon 256 "$ICONSET_DIR/icon_256x256.png"
render_png_icon 512 "$ICONSET_DIR/icon_256x256@2x.png"
render_png_icon 512 "$ICONSET_DIR/icon_512x512.png"
render_png_icon 1024 "$ICONSET_DIR/icon_512x512@2x.png"

if command -v iconutil &> /dev/null; then
    iconutil -c icns "$ICONSET_DIR" -o "$ICONS_DIR/icon.icns"
    rm -rf "$ICONSET_DIR"
else
    echo "⚠️  iconutil not found (macOS only). Skipping .icns generation."
fi

# Generate Windows icon (.ico)
echo "🪟 Generating Windows icon..."
TMP_ICON_BASE="$ICONS_DIR/.icon-base-1024.png"
render_png_icon 1024 "$TMP_ICON_BASE"
magick "$TMP_ICON_BASE" -background none -define icon:auto-resize=256,128,96,64,48,32,16 "$ICONS_DIR/icon.ico"
rm -f "$TMP_ICON_BASE"

echo ""
echo "✅ Icons generated successfully in: $ICONS_DIR"
echo ""
echo "Generated files:"
ls -lh "$ICONS_DIR"
