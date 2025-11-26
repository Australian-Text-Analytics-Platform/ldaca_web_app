#!/usr/bin/env python3
"""Package the LDaCA backend into a relocatable runtime for Tauri."""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
REPO_ROOT = PROJECT_ROOT.parent.parent
DOCFRAME_DIR = REPO_ROOT / "docframe"
DOCWORKSPACE_DIR = REPO_ROOT / "ldaca_web_app" / "docworkspace"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Package the LDaCA backend runtime for inclusion in the desktop bundle."
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Remove the existing dist directory before packaging",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=str(PROJECT_ROOT / "dist-tauri" / "backend-runtime"),
        help="Custom output directory for the runtime (default: dist-tauri/backend-runtime)",
    )
    parser.add_argument(
        "--python-version",
        type=str,
        default="3.12",
        help="Python version to vendor inside the runtime",
    )
    return parser.parse_args()


def run(
    cmd: list[str], *, cwd: Path | None = None, capture_output: bool = False
) -> subprocess.CompletedProcess:
    display_cmd = " ".join(cmd)
    print(f"$ {display_cmd}")
    return subprocess.run(
        cmd,
        cwd=cwd,
        check=True,
        capture_output=capture_output,
        text=True,
    )


def ensure_uv_is_available() -> None:
    if shutil.which("uv") is None:
        raise RuntimeError("The 'uv' CLI is required but was not found in PATH")


def sanitize_lockfile(lockfile: Path, sanitized: Path) -> None:
    editable_prefixes = ("-e ", "--editable")
    with (
        lockfile.open("r", encoding="utf-8") as src,
        sanitized.open("w", encoding="utf-8") as dest,
    ):
        for line in src:
            stripped = line.lstrip()
            if stripped.startswith(editable_prefixes):
                continue
            dest.write(line)


def resolve_python_bin(python_bin: Path) -> Path:
    python_bin = python_bin.expanduser()
    try:
        python_bin = python_bin.resolve()
    except FileNotFoundError:
        pass

    venv_cfg = python_bin.parent.parent / "pyvenv.cfg"
    if venv_cfg.exists():
        home_value: str | None = None
        for raw_line in venv_cfg.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if line.startswith("home"):
                _, value = line.split("=", 1)
                home_value = value.strip()
                break

        if home_value:
            home_path = Path(home_value)
            candidates: list[Path]
            if home_path.is_file():
                candidates = [home_path]
            else:
                candidates = [
                    home_path / "python3",
                    home_path / "python3.12",
                    home_path / "python.exe",
                    home_path / "python",
                ]

            for candidate in candidates:
                if candidate.exists():
                    try:
                        return candidate.resolve()
                    except FileNotFoundError:
                        return candidate

    return python_bin


def copy_python_installation(source_root: Path, destination_root: Path) -> None:
    if destination_root.exists():
        shutil.rmtree(destination_root)
    print(f"📦 Copying Python installation from {source_root} to {destination_root}")
    shutil.copytree(
        source_root,
        destination_root,
        symlinks=False,
        dirs_exist_ok=True,
    )


def remove_externally_managed_markers(root: Path) -> None:
    for marker in root.rglob("EXTERNALLY-MANAGED"):
        marker.unlink()


def build_local_wheel(package_path: Path, wheel_dir: Path, label: str) -> None:
    if not package_path.exists():
        raise RuntimeError(f"Source directory for {label} not found at {package_path}")
    print(f"🛞 Building wheel for {label}")
    run(
        ["uv", "build", str(package_path), "--wheel", "--out-dir", str(wheel_dir)],
        cwd=package_path,
    )


def find_latest_wheel(wheel_dir: Path, prefix: str) -> Path:
    matches = sorted(wheel_dir.glob(f"{prefix}-*.whl"))
    if not matches:
        raise RuntimeError(f"Expected wheel starting with {prefix}- in {wheel_dir}")
    return matches[-1]


def write_file(path: Path, contents: str, *, mode: int | None = None) -> None:
    path.write_text(contents, encoding="utf-8")
    if mode is not None:
        os.chmod(path, mode)


def create_launcher_scripts(runtime_dir: Path) -> None:
    runner_path = runtime_dir / "run_backend.sh"
    runner_contents = (
        textwrap.dedent(
            """
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
        """
        ).strip()
        + "\n"
    )
    write_file(runner_path, runner_contents, mode=0o755)

    if platform.system() == "Darwin":
        print("🔧 Creating macOS sidecar aliases")
        for target in ("aarch64-apple-darwin", "x86_64-apple-darwin"):
            alias_path = runtime_dir / f"run_backend.sh-{target}"
            shutil.copy2(runner_path, alias_path)
            os.chmod(alias_path, 0o755)

    env_template = textwrap.dedent(
        """
        # Desktop-specific overrides for the bundled backend
        # Copy this file to .env.desktop and adjust values if needed.
        #
        #BACKEND_PORT=8001
        #SERVER_HOST=127.0.0.1
        #LDACA_DATA_ROOT=$HOME/Documents/ldaca
        """
    ).lstrip()
    write_file(runtime_dir / ".env.desktop.example", env_template)

    docs_contents = (
        textwrap.dedent(
            """
        # LDaCA Backend Runtime
        
        This folder is generated by `scripts/package_backend_runtime.py` and contains:
        
        - `python/` – a standalone Python interpreter with all dependencies preinstalled
            (third-party wheels resolved via `uv pip compile` plus local docframe,
            docworkspace, and backend wheels)
        - `run_backend.sh` – optional launcher for local debugging and CI smoke tests
        - `run_backend.sh-*` – architecture-specific copies kept for legacy sidecar flows
        - `.env.desktop.example` – optional overrides for runtime configuration
        
        The launcher expects the following environment variables (all optional):
        
        | Variable | Purpose |
        |----------|---------|
        | `BACKEND_PORT` / `LDACA_BACKEND_PORT` | Port to bind the FastAPI server (defaults to 8001) |
        | `SERVER_HOST` / `LDACA_SERVER_HOST` | Network interface to bind (defaults to 127.0.0.1) |
        | `LDACA_DATA_ROOT` | Location for workspace + user data (default `~/Documents/ldaca`) |
        | `LDACA_CONFIG_PROFILE` | Arbitrary label for downstream logging (defaults to `desktop`) |
        
        On macOS the script also creates `run_backend.sh-aarch64-apple-darwin` and
        `run_backend.sh-x86_64-apple-darwin`. Even though the desktop app now launches
        the bundled interpreter directly (`python/bin/python3` or `python/python.exe`),
        these aliases remain helpful when running the backend manually from the
        terminal or within older CI scripts.

        The Tauri host locates this runtime via `LDACA_BACKEND_RUNTIME` (or the
        bundled resource path) and spawns the interpreter with
        `python -m ldaca_web_app_backend.cli`. Before spawning it parses `.env` and
        `.env.desktop`, exporting the values alongside `BACKEND_PORT`,
        `LDACA_BACKEND_PORT`, `SERVER_HOST`, `LDACA_SERVER_HOST`, and
        `LDACA_CONFIG_PROFILE`. The optional shell launcher mirrors that behavior for
        engineers who prefer to start the backend outside the desktop app.
        """
        ).strip()
        + "\n"
    )
    write_file(runtime_dir / "README_RUNTIME.md", docs_contents)


def main() -> None:
    args = parse_args()
    ensure_uv_is_available()

    output_dir = Path(args.output).expanduser().resolve()
    dist_root = output_dir.parent
    runtime_name = output_dir.name
    lockfile = dist_root / f"{runtime_name}-requirements.txt"
    sanitized_lockfile = dist_root / f"{runtime_name}-thirdparty.txt"
    wheel_dir = dist_root / "wheels"

    print("📦 Packaging backend runtime")
    print(f"   Output directory: {output_dir}")
    print(f"   Python version:   {args.python_version}\n")

    if args.clean and dist_root.exists():
        print(f"🧹 Removing previous dist at {dist_root}")
        shutil.rmtree(dist_root)

    output_dir.mkdir(parents=True, exist_ok=True)
    dist_root.mkdir(parents=True, exist_ok=True)
    wheel_dir.mkdir(parents=True, exist_ok=True)

    if lockfile.exists():
        lockfile.unlink()
    if sanitized_lockfile.exists():
        sanitized_lockfile.unlink()

    print("🔒 Resolving dependencies via uv pip compile")
    run(
        [
            "uv",
            "pip",
            "compile",
            "pyproject.toml",
            "--python-version",
            args.python_version,
            "--output-file",
            str(lockfile),
        ],
        cwd=PROJECT_ROOT,
    )

    print("🧹 Filtering editable workspace entries")
    sanitize_lockfile(lockfile, sanitized_lockfile)
    print(f"📁 Third-party lock written to {sanitized_lockfile}")

    print("🧰 Ensuring requested Python version via uv")
    run(["uv", "python", "install", args.python_version])
    find_result = run(
        ["uv", "python", "find", "--managed-python", args.python_version],
        capture_output=True,
    )
    base_python_bin = Path(find_result.stdout.strip().splitlines()[-1])
    resolved_python_bin = resolve_python_bin(base_python_bin)

    print(f"   Base Python found at: {base_python_bin}")
    if resolved_python_bin != base_python_bin:
        print(f"   Resolved interpreter: {resolved_python_bin}")

    python_install_root = resolved_python_bin.parent.parent
    runtime_python_dir = output_dir / "python"
    copy_python_installation(python_install_root, runtime_python_dir)
    remove_externally_managed_markers(runtime_python_dir)

    python_bin = runtime_python_dir / "bin" / "python3"
    if not python_bin.exists():
        python_bin = runtime_python_dir / "python.exe"
    if not python_bin.exists():
        raise RuntimeError(
            f"Unable to locate python executable inside {runtime_python_dir}"
        )

    build_local_wheel(DOCFRAME_DIR, wheel_dir, "docframe")
    build_local_wheel(DOCWORKSPACE_DIR, wheel_dir, "docworkspace")
    build_local_wheel(PROJECT_ROOT, wheel_dir, "ldaca-web-app-backend")

    print("📥 Installing third-party dependencies")
    run(
        [
            "uv",
            "pip",
            "install",
            "--python",
            str(python_bin),
            "-r",
            str(sanitized_lockfile),
        ],
        cwd=PROJECT_ROOT,
    )

    docframe_wheel = find_latest_wheel(wheel_dir, "docframe")
    docworkspace_wheel = find_latest_wheel(wheel_dir, "docworkspace")
    backend_wheel = find_latest_wheel(wheel_dir, "ldaca_web_app_backend")

    print("📦 Installing bundled workspace packages")
    for wheel_path in (docframe_wheel, docworkspace_wheel, backend_wheel):
        run(
            [
                "uv",
                "pip",
                "install",
                "--python",
                str(python_bin),
                "--no-deps",
                str(wheel_path),
            ],
            cwd=PROJECT_ROOT,
        )

    if lockfile.exists():
        lockfile.unlink()
    if sanitized_lockfile.exists():
        sanitized_lockfile.unlink()
        print("🧽 Removed temporary lockfiles")

    create_launcher_scripts(output_dir)

    print("✅ Backend runtime created")
    print(f"   Runtime folder: {output_dir}")
    print(f"   Python entry:   {python_bin}")
    print(f"   Optional launcher: {output_dir / 'run_backend.sh'}")
    print(f"   Wheels staged:  {wheel_dir}")


def entrypoint() -> None:
    try:
        main()
    except subprocess.CalledProcessError as exc:
        print(f"❌ Command failed: {' '.join(exc.cmd)}", file=sys.stderr)
        sys.exit(exc.returncode)
    except Exception as exc:  # noqa: BLE001
        print(f"❌ {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    entrypoint()
