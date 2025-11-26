#!/usr/bin/env bash
# This compatibility shim forwards to the Python implementation.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_SCRIPT="$SCRIPT_DIR/package_backend_runtime.py"

if [[ ! -f "$PACKAGE_SCRIPT" ]]; then
    echo "❌ package_backend_runtime.py not found at $PACKAGE_SCRIPT" >&2
    exit 1
fi

echo "⚠️  package_backend_runtime.sh is deprecated. Forwarding to package_backend_runtime.py" >&2

if command -v uv >/dev/null 2>&1; then
    exec uv run python "$PACKAGE_SCRIPT" "$@"
fi

PYTHON_BIN="python3"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    PYTHON_BIN="python"
fi

exec "$PYTHON_BIN" "$PACKAGE_SCRIPT" "$@"
