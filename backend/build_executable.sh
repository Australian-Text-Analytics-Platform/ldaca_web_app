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

# Determine primary output paths (one-directory layout)
OUTPUT_DIR="dist/ldaca_web_app_backend_bundle"
OUTPUT_BIN="$OUTPUT_DIR/ldaca_web_app_backend"

if [[ ! -d "$OUTPUT_DIR" ]] || [[ ! -f "$OUTPUT_BIN" && ! -f "${OUTPUT_BIN}.exe" ]]; then
    echo "❌ Expected one-directory PyInstaller output not found."
    echo "   Looked for $OUTPUT_BIN (and .exe on Windows)."
    exit 1
fi

# Determine platform architecture suffix for Tauri
ARCH_SUFFIX=""
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS - detect architecture
    MACHINE=$(uname -m)
    if [[ "$MACHINE" == "arm64" ]]; then
        ARCH_SUFFIX="-aarch64-apple-darwin"
    else
        ARCH_SUFFIX="-x86_64-apple-darwin"
    fi
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    MACHINE=$(uname -m)
    if [[ "$MACHINE" == "x86_64" ]]; then
        ARCH_SUFFIX="-x86_64-unknown-linux-gnu"
    elif [[ "$MACHINE" == "aarch64" ]]; then
        ARCH_SUFFIX="-aarch64-unknown-linux-gnu"
    fi
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
    # Windows
    ARCH_SUFFIX="-x86_64-pc-windows-msvc"
fi

# Copy binary with architecture suffix for Tauri
if [[ -n "$ARCH_SUFFIX" ]]; then
    echo "📦 Creating platform-specific artifacts for Tauri..."

    if [[ -f "$OUTPUT_BIN" ]]; then
        cp "$OUTPUT_BIN" "${OUTPUT_BIN}${ARCH_SUFFIX}"
        chmod +x "${OUTPUT_BIN}${ARCH_SUFFIX}"
    elif [[ -f "${OUTPUT_BIN}.exe" ]]; then
        cp "${OUTPUT_BIN}.exe" "${OUTPUT_BIN}${ARCH_SUFFIX}.exe"
    fi

    DEST_DIR="dist/ldaca_web_app_backend_bundle${ARCH_SUFFIX}"
    rm -rf "$DEST_DIR"
    cp -R "$OUTPUT_DIR" "$DEST_DIR"
    if [[ -f "$DEST_DIR/ldaca_web_app_backend" ]]; then
        chmod +x "$DEST_DIR/ldaca_web_app_backend"
    fi
    echo "   Created bundle copy: ${DEST_DIR}"
    echo ""
fi

echo "Output:"
echo "   Bundle directory: $OUTPUT_DIR"
if [[ -f "$OUTPUT_BIN" ]]; then
    echo "   Executable: $OUTPUT_BIN"
elif [[ -f "${OUTPUT_BIN}.exe" ]]; then
    echo "   Executable: ${OUTPUT_BIN}.exe"
fi
if [[ -n "$ARCH_SUFFIX" ]]; then
    echo "   Tauri bundle: dist/ldaca_web_app_backend_bundle${ARCH_SUFFIX}"
fi
echo ""
echo "To run the executable:"
if [[ -f "$OUTPUT_BIN" ]]; then
    echo "   $OUTPUT_BIN"
else
    echo "   ${OUTPUT_BIN}.exe"
fi
echo ""
echo "Note: The executable will create a 'data' folder in the"
echo "      current working directory for runtime data."
echo ""
