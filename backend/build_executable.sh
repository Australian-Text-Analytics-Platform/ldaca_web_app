#!/usr/bin/env bash
#
# Build script for LDaCA Backend executable using PyInstaller
#
# Usage:
#   bash build_executable.sh [--clean]
#
# Options:
#   --clean    Remove build artifacts before building
#

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "========================================"
echo "LDaCA Backend - PyInstaller Build"
echo "========================================"
echo ""

# Parse arguments
CLEAN=false
if [[ "$1" == "--clean" ]]; then
    CLEAN=true
fi

# Clean previous builds if requested
if [[ "$CLEAN" == true ]]; then
    echo "🧹 Cleaning previous build artifacts..."
    rm -rf build/ dist/
    echo ""
fi

# Ensure pyinstaller is available
echo "📦 Checking PyInstaller availability..."
if ! uv run python -c "import PyInstaller" 2>/dev/null; then
    echo "❌ PyInstaller not found in environment"
    echo "   Install it with: uv pip install pyinstaller"
    exit 1
fi
echo "✅ PyInstaller is available"
echo ""

# Run PyInstaller
echo "🔨 Building executable with PyInstaller..."
echo "   Spec file: ldaca_web_app_backend.spec"
echo "   This may take several minutes..."
echo ""

uv run pyinstaller ldaca_web_app_backend.spec

echo ""
echo "✅ Build complete!"
echo ""
echo "Output:"
echo "   Executable: dist/ldaca_web_app_backend"
echo ""
echo "To run the executable:"
echo "   ./dist/ldaca_web_app_backend"
echo ""
echo "Note: The executable will create a 'data' folder in the"
echo "      current working directory for runtime data."
echo ""
