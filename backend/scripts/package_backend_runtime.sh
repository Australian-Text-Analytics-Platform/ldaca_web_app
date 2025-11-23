#!/usr/bin/env bash
#
# Package the FastAPI backend into a relocatable runtime folder for Tauri.
# The runtime bundles a Python virtual environment plus a launch script that
# Tauri can execute as a sidecar. By default the output lives under
#   backend/dist-tauri/backend-runtime
#
# Usage:
#   bash scripts/package_backend_runtime.sh [--clean] [--output <dir>] [--python-version <x.y>]
#
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PROJECT_ROOT/../.." && pwd)"
cd "$PROJECT_ROOT"

RUNTIME_NAME="backend-runtime"
DIST_ROOT="$PROJECT_ROOT/dist-tauri"
OUTPUT_DIR="$DIST_ROOT/$RUNTIME_NAME"
LOCKFILE_NAME="${RUNTIME_NAME}-requirements.txt"
LOCKFILE="$DIST_ROOT/$LOCKFILE_NAME"
SANITIZED_LOCKFILE="$DIST_ROOT/${RUNTIME_NAME}-thirdparty.txt"
PYTHON_VERSION="3.12"
CLEAN=false
WHEEL_DIR="$DIST_ROOT/wheels"

DOCFRAME_DIR="$REPO_ROOT/docframe"
DOCWORKSPACE_DIR="$REPO_ROOT/ldaca_web_app/docworkspace"

usage() {
    cat <<'EOF'
Package the LDaCA backend for inclusion inside the Tauri desktop bundle.

Options:
  --clean                 Remove any previous runtime output before packaging
  --output <dir>          Custom output directory (default: dist-tauri/backend-runtime)
  --python-version <ver>  Python version to resolve dependencies against (default: 3.12)
  -h, --help              Show this help message
EOF
}

resolve_path() {
    local input="$1"
    if [[ "$input" == /* ]]; then
        printf '%s\n' "$input"
    else
        printf '%s\n' "$(pwd)/$input"
    fi
}

resolve_python_bin() {
    local python_bin="$1"
    local python_cmd=""

    if command -v python3 >/dev/null 2>&1; then
        python_cmd="python3"
    elif command -v python >/dev/null 2>&1; then
        python_cmd="python"
    fi

    if [[ -n "$python_cmd" ]]; then
        "$python_cmd" - "$python_bin" <<'PY'
import os
import sys
import pathlib

candidate = pathlib.Path(sys.argv[1])
resolved = candidate.resolve()
venv_cfg = candidate.parent.parent / "pyvenv.cfg"

if venv_cfg.exists():
    home_value = ""
    for line in venv_cfg.read_text().splitlines():
        line = line.strip()
        if line.startswith("home"):
            _, value = line.split("=", 1)
            home_value = value.strip()
            break

    if home_value:
        home_path = pathlib.Path(home_value)
        candidates = []

        if home_path.is_file():
            candidates.append(home_path)
        else:
            candidates.extend([
                home_path / "python3",
                home_path / "python3.12",
                home_path / "python.exe",
                home_path / "python",
            ])

        for option in candidates:
            if option.exists():
                resolved = option.resolve()
                break

print(resolved)
PY
        return
    fi

    printf '%s\n' "$python_bin"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --clean)
            CLEAN=true
            ;;
        --output)
            shift || true
            [[ -n "${1:-}" ]] || { echo "--output requires a directory" >&2; exit 1; }
            OUTPUT_DIR="$(resolve_path "$1")"
            DIST_ROOT="$(cd "$(dirname "$OUTPUT_DIR")" && pwd)"
            RUNTIME_NAME="$(basename "$OUTPUT_DIR")"
            LOCKFILE_NAME="${RUNTIME_NAME}-requirements.txt"
            LOCKFILE="$DIST_ROOT/$LOCKFILE_NAME"
            ;;
        --python-version)
            shift || true
            [[ -n "${1:-}" ]] || { echo "--python-version requires a value" >&2; exit 1; }
            PYTHON_VERSION="$1"
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage
            exit 1
            ;;
    esac
    shift || true
done

if ! command -v uv >/dev/null 2>&1; then
    echo "❌ The 'uv' CLI is required but was not found in PATH" >&2
    exit 1
fi

echo "📦 Packaging backend runtime"
echo "   Output directory: $OUTPUT_DIR"
echo "   Python version:   $PYTHON_VERSION"
echo ""

if [[ "$CLEAN" == true ]]; then
    echo "🧹 Removing previous dist at $DIST_ROOT"
    rm -rf "$DIST_ROOT"
fi

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"
mkdir -p "$DIST_ROOT"
rm -rf "$WHEEL_DIR"
mkdir -p "$WHEEL_DIR"

rm -f "$LOCKFILE" "$SANITIZED_LOCKFILE"

# Step 1: Generate a lockfile for reproducible installs
if [[ -f "$LOCKFILE" ]]; then
    rm -f "$LOCKFILE"
fi

echo "🔒 Resolving dependencies via uv pip compile"
uv pip compile pyproject.toml \
    --python-version "$PYTHON_VERSION" \
    --output-file "$LOCKFILE"

echo "🧹 Filtering editable workspace entries"
grep -Ev '^\s*-e\s' "$LOCKFILE" > "$SANITIZED_LOCKFILE"
echo "📁 Third-party lock written to $SANITIZED_LOCKFILE"

# Step 2: Bundle a standalone Python interpreter
echo "🧰 Ensuring Python $PYTHON_VERSION via uv"
uv python install "$PYTHON_VERSION"

# Find the base python executable and resolve through any active venvs/symlinks
BASE_PYTHON_BIN="$(cd /tmp && uv python find --managed-python "$PYTHON_VERSION")"
RESOLVED_PYTHON_BIN="$(resolve_python_bin "$BASE_PYTHON_BIN")"

if [[ -z "$RESOLVED_PYTHON_BIN" ]]; then
    echo "❌ Unable to resolve interpreter for $BASE_PYTHON_BIN" >&2
    exit 1
fi

echo "   Base Python found at: $BASE_PYTHON_BIN"
if [[ "$RESOLVED_PYTHON_BIN" != "$BASE_PYTHON_BIN" ]]; then
    echo "   Resolved interpreter: $RESOLVED_PYTHON_BIN"
fi

# Resolve the installation root (bin/python -> bin/ -> root)
PYTHON_INSTALL_ROOT="$(dirname "$(dirname "$RESOLVED_PYTHON_BIN")")"
echo "   Copying Python installation from $PYTHON_INSTALL_ROOT"

# Copy the entire python installation to the runtime folder, materializing
# symlinks so the runtime stays self-contained when moved to another machine.
mkdir -p "$OUTPUT_DIR/python"
rsync -a --copy-links "$PYTHON_INSTALL_ROOT"/ "$OUTPUT_DIR/python"/

# Remove EXTERNALLY-MANAGED to allow pip installs into this copy
find "$OUTPUT_DIR/python" -name "EXTERNALLY-MANAGED" -delete

PYTHON_BIN="$OUTPUT_DIR/python/bin/python3"
if [[ ! -x "$PYTHON_BIN" ]]; then
    PYTHON_BIN="$OUTPUT_DIR/python/python.exe"
fi
if [[ ! -x "$PYTHON_BIN" ]]; then
    echo "❌ Could not locate python executable inside $OUTPUT_DIR/python" >&2
    exit 1
fi

# Step 3: Install dependencies + the backend package into the bundled python
build_local_wheel() {
    local source_dir="$1"
    local label="$2"

    if [[ ! -d "$source_dir" ]]; then
        echo "❌ Source directory for $label not found at $source_dir" >&2
        exit 1
    fi

    echo "🛞 Building wheel for $label"
    uv build "$source_dir" --wheel --out-dir "$WHEEL_DIR" >/dev/null
}

build_local_wheel "$DOCFRAME_DIR" "docframe"
build_local_wheel "$DOCWORKSPACE_DIR" "docworkspace"
build_local_wheel "$PROJECT_ROOT" "ldaca-web-app-backend"

echo "📥 Installing third-party dependencies"
uv pip install --python "$PYTHON_BIN" -r "$SANITIZED_LOCKFILE"

shopt -s nullglob
DOCFRAME_WHEEL=("$WHEEL_DIR"/docframe-*.whl)
DOCWORKSPACE_WHEEL=("$WHEEL_DIR"/docworkspace-*.whl)
BACKEND_WHEEL=("$WHEEL_DIR"/ldaca_web_app_backend-*.whl)
shopt -u nullglob

if [[ ${#DOCFRAME_WHEEL[@]} -eq 0 || ${#DOCWORKSPACE_WHEEL[@]} -eq 0 || ${#BACKEND_WHEEL[@]} -eq 0 ]]; then
    echo "❌ Missing one or more wheel artifacts in $WHEEL_DIR" >&2
    exit 1
fi

echo "📦 Installing bundled workspace packages"
uv pip install --python "$PYTHON_BIN" --no-deps "${DOCFRAME_WHEEL[@]}"
uv pip install --python "$PYTHON_BIN" --no-deps "${DOCWORKSPACE_WHEEL[@]}"
uv pip install --python "$PYTHON_BIN" --no-deps "${BACKEND_WHEEL[@]}"

rm -f "$LOCKFILE" "$SANITIZED_LOCKFILE"
echo "🧽 Removed temporary lockfiles"

# Step 4: Create launch assets (run script + env template + README)
RUNNER_PATH="$OUTPUT_DIR/run_backend.sh"
cat > "$RUNNER_PATH" <<'RUNNER'
#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Debug logging
echo "[Backend] Launcher starting. SCRIPT_DIR=$SCRIPT_DIR" >&2

# Locate the runtime directory (containing python and .env files)
# 1. Default to SCRIPT_DIR (local development or side-by-side deployment)
RUNTIME_DIR="$SCRIPT_DIR"

# 2. If running from macOS bundle (Contents/MacOS), look in Contents/Resources
if [[ "$SCRIPT_DIR" == *"/Contents/MacOS" ]]; then
    BUNDLE_RESOURCES="$SCRIPT_DIR/../Resources"
    echo "[Backend] Running in bundle. Checking Resources at $BUNDLE_RESOURCES" >&2
    
    # Check possible resource paths based on Tauri bundling behavior
    if [[ -d "$BUNDLE_RESOURCES/backend-runtime" ]]; then
        RUNTIME_DIR="$BUNDLE_RESOURCES/backend-runtime"
    elif [[ -d "$BUNDLE_RESOURCES/backend/dist-tauri/backend-runtime" ]]; then
        RUNTIME_DIR="$BUNDLE_RESOURCES/backend/dist-tauri/backend-runtime"
    elif [[ -d "$BUNDLE_RESOURCES/_up_/backend/dist-tauri/backend-runtime" ]]; then
        RUNTIME_DIR="$BUNDLE_RESOURCES/_up_/backend/dist-tauri/backend-runtime"
    fi
fi

echo "[Backend] Resolved RUNTIME_DIR=$RUNTIME_DIR" >&2

PYTHON_BIN="$RUNTIME_DIR/python/bin/python3"
if [[ ! -x "$PYTHON_BIN" ]]; then
    # Windows fallback
    PYTHON_BIN="$RUNTIME_DIR/python/python.exe"
fi

if [[ ! -x "$PYTHON_BIN" ]]; then
    echo "[Backend] Python executable missing at $PYTHON_BIN" >&2
    echo "[Backend] Search path was: $RUNTIME_DIR" >&2
    
    # Fallback check for legacy venv (if user didn't clean build)
    if [[ -d "$RUNTIME_DIR/venv/bin" ]]; then
         echo "[Backend] Found legacy venv, trying that..." >&2
         PYTHON_BIN="$RUNTIME_DIR/venv/bin/python"
    else
         exit 1
    fi
fi

if [[ -f "$RUNTIME_DIR/.env" ]]; then
    set -a
    source "$RUNTIME_DIR/.env"
    set +a
fi

if [[ -f "$RUNTIME_DIR/.env.desktop" ]]; then
    set -a
    source "$RUNTIME_DIR/.env.desktop"
    set +a
fi

PORT_VALUE="${BACKEND_PORT:-${LDACA_BACKEND_PORT:-8001}}"
HOST_VALUE="${SERVER_HOST:-${LDACA_SERVER_HOST:-127.0.0.1}}"

export BACKEND_PORT="$PORT_VALUE"
export LDACA_BACKEND_PORT="$PORT_VALUE"
export SERVER_HOST="$HOST_VALUE"
export LDACA_SERVER_HOST="$HOST_VALUE"
export PYTHONUNBUFFERED=1
export LDACA_CONFIG_PROFILE="${LDACA_CONFIG_PROFILE:-desktop}"

exec "$PYTHON_BIN" -m ldaca_web_app_backend.cli
RUNNER
chmod +x "$RUNNER_PATH"

# Create architecture-specific copies so Tauri's externalBin lookup succeeds.
# Tauri appends the target triple to the filename when bundling sidecars,
# e.g. run_backend.sh-aarch64-apple-darwin. We duplicate the launcher for the
# common macOS targets to keep the relative venv path intact.
if [[ "$(uname -s)" == "Darwin" ]]; then
    echo "🔧 Creating macOS sidecar aliases"
    for target in aarch64-apple-darwin x86_64-apple-darwin; do
        alias_path="${RUNNER_PATH}-${target}"
        cp "$RUNNER_PATH" "$alias_path"
        chmod +x "$alias_path"
    done
fi

env_template="$OUTPUT_DIR/.env.desktop.example"
cat > "$env_template" <<'ENV'
# Desktop-specific overrides for the bundled backend
# Copy this file to .env.desktop and adjust values if needed.
#
#BACKEND_PORT=8001
#SERVER_HOST=127.0.0.1
#LDACA_DATA_ROOT=$HOME/Documents/ldaca
ENV

docs_path="$OUTPUT_DIR/README_RUNTIME.md"
cat > "$docs_path" <<'DOCS'
# LDaCA Backend Runtime

This folder is generated by `scripts/package_backend_runtime.sh` and contains:

- `python/` – a standalone Python interpreter with all dependencies preinstalled
    (third-party wheels resolved via `uv pip compile` plus local docframe,
    docworkspace, and backend wheels)
- `run_backend.sh` – launcher script used by the Tauri shell
- `run_backend.sh-*` – architecture-specific copies for Tauri sidecar lookup
- `.env.desktop.example` – optional overrides for runtime configuration

The launcher expects the following environment variables (all optional):

| Variable | Purpose |
|----------|---------|
| `BACKEND_PORT` / `LDACA_BACKEND_PORT` | Port to bind the FastAPI server (defaults to 8001) |
| `SERVER_HOST` / `LDACA_SERVER_HOST` | Network interface to bind (defaults to 127.0.0.1) |
| `LDACA_DATA_ROOT` | Location for workspace + user data (default `~/Documents/ldaca`) |
| `LDACA_CONFIG_PROFILE` | Arbitrary label for downstream logging (defaults to `desktop`) |

On macOS the script also creates `run_backend.sh-aarch64-apple-darwin` and
`run_backend.sh-x86_64-apple-darwin`. Tauri appends the Rust target triple when
searching for sidecars, so these aliases ensure the launcher sits next to its
bundled runtime regardless of the build target.

At runtime the Tauri shell executes `run_backend.sh`, which boots
`ldaca_web_app_backend.cli` inside the bundled interpreter.
DOCS

cat <<EOF
✅ Backend runtime created
   Runtime folder: $OUTPUT_DIR
   Launch script:  $RUNNER_PATH
    Wheels staged:  $WHEEL_DIR
EOF
