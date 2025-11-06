#!/usr/bin/env bash
#
# Complete build script for LDaCA Desktop Application
# Builds backend, frontend, and Tauri app
#

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "LDaCA Desktop App - Complete Build"
echo "=========================================="
echo ""

# Step 1: Build Backend
echo "📦 Step 1/3: Building backend executable..."
cd backend
if [ ! -f "build_executable.sh" ]; then
    echo "❌ Backend build script not found!"
    exit 1
fi
bash build_executable.sh --clean
cd ..
echo "✅ Backend built successfully"
echo ""

# Step 2: Build Frontend
echo "🎨 Step 2/3: Building frontend..."
cd frontend
if [ ! -f "package.json" ]; then
    echo "❌ Frontend package.json not found!"
    exit 1
fi
npm install
npm run build
cd ..
echo "✅ Frontend built successfully"
echo ""

# Step 3: Build Tauri App
echo "🖥️  Step 3/3: Building desktop application..."
if [ ! -f "package.json" ]; then
    echo "❌ Root package.json not found!"
    exit 1
fi
npm install
npm run tauri:build
echo "✅ Desktop app built successfully"
echo ""

# Show output location
echo "=========================================="
echo "✅ Build Complete!"
echo "=========================================="
echo ""
echo "Installer location:"
if [ "$(uname)" == "Darwin" ]; then
    echo "  📁 src-tauri/target/release/bundle/dmg/"
    ls -lh src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null || echo "  (DMG not found)"
elif [ "$(expr substr $(uname -s) 1 5)" == "Linux" ]; then
    echo "  📁 src-tauri/target/release/bundle/deb/"
    ls -lh src-tauri/target/release/bundle/deb/*.deb 2>/dev/null || echo "  (DEB not found)"
    echo "  📁 src-tauri/target/release/bundle/appimage/"
    ls -lh src-tauri/target/release/bundle/appimage/*.AppImage 2>/dev/null || echo "  (AppImage not found)"
else
    echo "  📁 src-tauri/target/release/bundle/msi/"
    ls -lh src-tauri/target/release/bundle/msi/*.msi 2>/dev/null || echo "  (MSI not found)"
fi
echo ""
