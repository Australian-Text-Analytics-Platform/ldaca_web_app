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

# Check if backend executable exists
if [ ! -f "$DIST_DIR/ldaca_web_app_backend" ] && [ ! -f "$DIST_DIR/ldaca_web_app_backend.exe" ]; then
    echo "❌ Backend executable not found!"
    echo "   Expected: $DIST_DIR/ldaca_web_app_backend"
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
echo "Source: $DIST_DIR/$EXE_NAME"
echo "Destination: $DIST_DIR/ldaca_web_app_backend-$TARGET"
echo ""

# Copy and rename for sidecar
cp "$DIST_DIR/$EXE_NAME" "$DIST_DIR/ldaca_web_app_backend-$TARGET"

# Make executable (Linux/macOS)
if [ "$EXE_NAME" != "ldaca_web_app_backend.exe" ]; then
    chmod +x "$DIST_DIR/ldaca_web_app_backend-$TARGET"
fi

echo "✅ Backend prepared for Tauri sidecar"
echo ""
echo "Sidecar binary: $DIST_DIR/ldaca_web_app_backend-$TARGET"
