#!/usr/bin/env bash
#
# Build Tauri desktop app from existing backend and frontend builds
# Prerequisites: 
#   - backend/dist/ldaca_web_app_backend executable exists
#   - frontend/build/ directory exists
#

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "=========================================="
echo "LDaCA Desktop App - Tauri Build"
echo "=========================================="
echo ""

# Check prerequisites
echo "Checking prerequisites..."
echo ""

# Check backend runtime folder
if [ ! -x "backend/dist-tauri/backend-runtime/run_backend.sh" ]; then
    echo "ERROR: Backend runtime not found!"
    echo "   Expected: backend/dist-tauri/backend-runtime/run_backend.sh"
    echo ""
    echo "   Create it with:"
    echo "   cd backend && bash scripts/package_backend_runtime.sh --clean"
    exit 1
fi
echo "Backend runtime found"

# Check frontend build
if [ ! -d "frontend/build" ] || [ ! -f "frontend/build/index.html" ]; then
    echo "ERROR: Frontend build not found!"
    echo "   Expected: frontend/build/index.html"
    echo ""
    echo "   Build it with:"
    echo "   cd frontend && npm run build"
    exit 1
fi
echo "Frontend build found"
echo ""

# Install npm dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing npm dependencies..."
    npm install
    echo ""
fi

# Check for build vs dev mode
MODE="${1:-build}"

case "$MODE" in
    "dev")
        echo "Starting Tauri in development mode..."
        echo "   (Frontend dev server will start on port 3000)"
        echo ""
        npm run tauri:dev
        ;;
    "build")
        echo "Building Tauri desktop application..."
        echo "   This may take several minutes..."
        echo ""
        npm run tauri:build
        echo ""
        echo "=========================================="
        echo "Build Complete!"
        echo "=========================================="
        echo ""
        echo "Installer location:"
        if [ "$(uname)" == "Darwin" ]; then
            echo "  src-tauri/target/release/bundle/dmg/"
            ls -lh src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null || echo "     (DMG not found)"
        elif [ "$(expr substr $(uname -s) 1 5)" == "Linux" ]; then
            echo "  src-tauri/target/release/bundle/deb/"
            ls -lh src-tauri/target/release/bundle/deb/*.deb 2>/dev/null || echo "     (DEB not found)"
            echo "  src-tauri/target/release/bundle/appimage/"
            ls -lh src-tauri/target/release/bundle/appimage/*.AppImage 2>/dev/null || echo "     (AppImage not found)"
        else
            echo "  src-tauri/target/release/bundle/msi/"
            ls -lh src-tauri/target/release/bundle/msi/*.msi 2>/dev/null || echo "     (MSI not found)"
        fi
        echo ""
        ;;
    *)
        echo "ERROR: Invalid mode: $MODE"
        echo ""
        echo "Usage:"
        echo "  bash build-tauri.sh           # Build production app"
        echo "  bash build-tauri.sh build     # Build production app"
        echo "  bash build-tauri.sh dev       # Start dev mode"
        exit 1
        ;;
esac
