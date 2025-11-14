#!/usr/bin/env bash
#
# Prepare backend executable for Tauri sidecar
# Copies and renames the backend executable to match Tauri's sidecar naming convention
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/../backend"
DIST_DIR="$BACKEND_DIR/dist"

echo "🔧 Preparing backend for Tauri sidecar..."
echo ""

# Check if backend bundle exists (one-directory layout)
if [ ! -d "$DIST_DIR/ldaca_web_app_backend_bundle" ]; then
    echo "❌ Backend bundle not found!"
    echo "   Expected directory: $DIST_DIR/ldaca_web_app_backend_bundle"
    echo ""
    echo "   Build it first with:"
    echo "   cd backend && bash build_executable.sh --clean"
    exit 1
fi

# Detect target triple
if [ "$(uname)" == "Darwin" ]; then
    # macOS
    ARCH="$(uname -m)"
    if [ "$ARCH" == "arm64" ]; then
        TARGET="aarch64-apple-darwin"
    else
        TARGET="x86_64-apple-darwin"
    fi
    EXE_NAME="ldaca_web_app_backend"
elif [ "$(expr substr $(uname -s) 1 5)" == "Linux" ]; then
    # Linux
    ARCH="$(uname -m)"
    if [ "$ARCH" == "aarch64" ]; then
        TARGET="aarch64-unknown-linux-gnu"
    else
        TARGET="x86_64-unknown-linux-gnu"
    fi
    EXE_NAME="ldaca_web_app_backend"
else
    # Windows
    TARGET="x86_64-pc-windows-msvc"
    EXE_NAME="ldaca_web_app_backend.exe"
fi

echo "Detected target: $TARGET"
DEST_DIR="$DIST_DIR/ldaca_web_app_backend_bundle-$TARGET"

echo "Detected target: $TARGET"
echo "Source bundle: $DIST_DIR/ldaca_web_app_backend_bundle"
echo "Destination bundle: $DEST_DIR"
echo ""

# Copy and rename for sidecar
# Copy bundle for sidecar consumption
rm -rf "$DEST_DIR"
cp -R "$DIST_DIR/ldaca_web_app_backend_bundle" "$DEST_DIR"

# Make executable (Linux/macOS)
if [ "$EXE_NAME" != "ldaca_web_app_backend.exe" ]; then
    chmod +x "$DEST_DIR/$EXE_NAME"
fi

echo "✅ Backend prepared for Tauri sidecar"
echo ""
echo "Sidecar bundle: $DEST_DIR"
