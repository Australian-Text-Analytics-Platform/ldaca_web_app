#!/usr/bin/env bash
#
# Legacy helper kept for compatibility. The new packaging workflow
# bundles a relocatable virtualenv instead of a PyInstaller executable.
# This script simply proxies to scripts/package_backend_runtime.sh.
#

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/../backend"
PACKAGE_SCRIPT="$BACKEND_DIR/scripts/package_backend_runtime.sh"

if [ ! -f "$PACKAGE_SCRIPT" ]; then
    echo "❌ Unable to locate $PACKAGE_SCRIPT" >&2
    exit 1
fi

echo "🔧 prepare-sidecar.sh is deprecated; forwarding to package_backend_runtime.sh"
echo ""

exec bash "$PACKAGE_SCRIPT" "$@"
