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
SOURCE_ICON="$SCRIPT_DIR/../frontend/public/logo512.png"

# Use ImageMagick's 'magick' CLI (user requested Python fallbacks be removed)
if ! command -v magick &> /dev/null; then
    echo "❌ ImageMagick (magick) not found. Please install it:"
    echo "   macOS: brew install imagemagick"
    echo "   Linux: sudo apt-get install imagemagick"
    exit 1
fi

# Check if source icon exists
if [ ! -f "$SOURCE_ICON" ]; then
    echo "❌ Source icon not found: $SOURCE_ICON"
    exit 1
fi

echo "🎨 Generating Tauri icons from: $SOURCE_ICON"
echo ""

# Create icons directory
mkdir -p "$ICONS_DIR"

# Generate PNG icons (ensure alpha channel / RGBA - force PNG32 output)
echo "📱 Generating PNG icons..."
# Use PNG32: prefix to force RGBA (4-channel) PNG output which Tauri requires
magick "$SOURCE_ICON" -alpha set -background none -resize 32x32 PNG32:"$ICONS_DIR/32x32.png"
magick "$SOURCE_ICON" -alpha set -background none -resize 128x128 PNG32:"$ICONS_DIR/128x128.png"
magick "$SOURCE_ICON" -alpha set -background none -resize 256x256 PNG32:"$ICONS_DIR/128x128@2x.png"
magick "$SOURCE_ICON" -alpha set -background none -resize 256x256 PNG32:"$ICONS_DIR/icon.png"

# Generate macOS icon (.icns) - requires multiple sizes collected into an .iconset
echo "🍎 Generating macOS icon..."
ICONSET_DIR="$ICONS_DIR/icon.iconset"
mkdir -p "$ICONSET_DIR"

magick "$SOURCE_ICON" -alpha set -background none -resize 16x16 PNG32:"$ICONSET_DIR/icon_16x16.png"
magick "$SOURCE_ICON" -alpha set -background none -resize 32x32 PNG32:"$ICONSET_DIR/icon_16x16@2x.png"
magick "$SOURCE_ICON" -alpha set -background none -resize 32x32 PNG32:"$ICONSET_DIR/icon_32x32.png"
magick "$SOURCE_ICON" -alpha set -background none -resize 64x64 PNG32:"$ICONSET_DIR/icon_32x32@2x.png"
magick "$SOURCE_ICON" -alpha set -background none -resize 128x128 PNG32:"$ICONSET_DIR/icon_128x128.png"
magick "$SOURCE_ICON" -alpha set -background none -resize 256x256 PNG32:"$ICONSET_DIR/icon_128x128@2x.png"
magick "$SOURCE_ICON" -alpha set -background none -resize 256x256 PNG32:"$ICONSET_DIR/icon_256x256.png"
magick "$SOURCE_ICON" -alpha set -background none -resize 512x512 PNG32:"$ICONSET_DIR/icon_256x256@2x.png"
magick "$SOURCE_ICON" -alpha set -background none -resize 512x512 PNG32:"$ICONSET_DIR/icon_512x512.png"
magick "$SOURCE_ICON" -alpha set -background none -resize 1024x1024 PNG32:"$ICONSET_DIR/icon_512x512@2x.png"

if command -v iconutil &> /dev/null; then
    iconutil -c icns "$ICONSET_DIR" -o "$ICONS_DIR/icon.icns"
    rm -rf "$ICONSET_DIR"
else
    echo "⚠️  iconutil not found (macOS only). Skipping .icns generation."
fi

# Generate Windows icon (.ico)
echo "🪟 Generating Windows icon..."
magick "$SOURCE_ICON" -alpha set -background none -define icon:auto-resize=256,128,96,64,48,32,16 "$ICONS_DIR/icon.ico"

echo ""
echo "✅ Icons generated successfully in: $ICONS_DIR"
echo ""
echo "Generated files:"
ls -lh "$ICONS_DIR"
