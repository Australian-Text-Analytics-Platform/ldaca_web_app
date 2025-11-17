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
cd "$PROJECT_ROOT"

RUNTIME_NAME="backend-runtime"
DIST_ROOT="$PROJECT_ROOT/dist-tauri"
OUTPUT_DIR="$DIST_ROOT/$RUNTIME_NAME"
LOCKFILE_NAME="${RUNTIME_NAME}-requirements.txt"
LOCKFILE="$DIST_ROOT/$LOCKFILE_NAME"
PYTHON_VERSION="3.12"
CLEAN=false

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

# Step 1: Generate a lockfile for reproducible installs
if [[ -f "$LOCKFILE" ]]; then
    rm -f "$LOCKFILE"
fi

echo "🔒 Resolving dependencies via uv pip compile"
uv pip compile pyproject.toml \
    --python-version "$PYTHON_VERSION" \
    --output-file "$LOCKFILE"

echo "📁 Lockfile created at $LOCKFILE"

# Step 2: Create a dedicated virtual environment under the runtime folder
echo "🧰 Ensuring Python $PYTHON_VERSION via uv"
uv python install "$PYTHON_VERSION"

echo "🐍 Creating virtual environment"
uv venv --python "$PYTHON_VERSION" "$OUTPUT_DIR/.venv"

VENV_BIN_DIR="$OUTPUT_DIR/.venv/bin"
if [[ ! -d "$VENV_BIN_DIR" ]]; then
    VENV_BIN_DIR="$OUTPUT_DIR/.venv/Scripts"
fi
PYTHON_BIN="$VENV_BIN_DIR/python"
if [[ ! -x "$PYTHON_BIN" ]]; then
    PYTHON_BIN="$VENV_BIN_DIR/python.exe"
fi
if [[ ! -x "$PYTHON_BIN" ]]; then
    echo "❌ Could not locate python executable inside $OUTPUT_DIR/.venv" >&2
    exit 1
fi

# Step 3: Install dependencies + the backend package into the runtime venv
echo "📥 Installing backend dependencies"
uv pip install --python "$PYTHON_BIN" -r "$LOCKFILE"

echo "📦 Installing ldaca_web_app_backend into runtime venv"
uv pip install --python "$PYTHON_BIN" "$PROJECT_ROOT"

# Step 4: Create launch assets (run script + env template + README)
RUNNER_PATH="$OUTPUT_DIR/run_backend.sh"
cat > "$RUNNER_PATH" <<'RUNNER'
#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
if [[ -d "$VENV_DIR/bin" ]]; then
    PYTHON_BIN="$VENV_DIR/bin/python"
elif [[ -d "$VENV_DIR/Scripts" ]]; then
    PYTHON_BIN="$VENV_DIR/Scripts/python.exe"
else
    echo "Virtual environment missing at $VENV_DIR" >&2
    exit 1
fi

if [[ -f "$SCRIPT_DIR/.env" ]]; then
    set -a
    source "$SCRIPT_DIR/.env"
    set +a
fi

if [[ -f "$SCRIPT_DIR/.env.desktop" ]]; then
    set -a
    source "$SCRIPT_DIR/.env.desktop"
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
# common macOS targets to keep the relative .venv path intact.
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

- `.venv/` – self-contained Python interpreter with all backend dependencies
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
bundled virtual environment regardless of the build target.

At runtime the Tauri shell executes `run_backend.sh`, which in turn boots
`ldaca_web_app_backend.cli` inside the bundled virtual environment.
DOCS

cat <<EOF
✅ Backend runtime created
   Runtime folder: $OUTPUT_DIR
   Launch script:  $RUNNER_PATH
   Lockfile:       $LOCKFILE
EOF
