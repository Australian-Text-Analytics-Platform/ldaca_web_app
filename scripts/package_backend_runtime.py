#!/usr/bin/env python3
"""Stage the LDaCA backend project and a `uv` binary into the Tauri bundle.

The desktop shell no longer ships a pre-built Python runtime. Instead it
ships:

  * ``src-tauri/backend-src/`` – a clean copy of the root ``pyproject.toml``,
    ``uv.lock`` and the ``backend/`` source tree (the baked-in frontend
    archive included).
  * ``src-tauri/uv-bin/uv[.exe]`` – a pinned ``uv`` release binary downloaded
    at build time for the host platform.

At runtime the Rust launcher invokes ``uv run`` with ``UV_PROJECT_ENVIRONMENT``
pointed at a writable directory inside ``app_data_dir`` so the Python
environment materialises on first launch and is reused thereafter.

Only the build host's platform is targeted – ``tauri build`` always produces
a bundle for the host. The script exits on the first error.
"""

from __future__ import annotations

import argparse
import io
import os
import platform
import shutil
import stat
import subprocess
import sys
import tarfile
import time
import urllib.request
import zipfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent

# The bundle drops everything under ``frontend/src-tauri/`` so Tauri's
# ``bundle.resources`` glob can include it from a stable, src-tauri-relative
# location. The staging code cleans these before copying.
SRC_TAURI = PROJECT_ROOT / "frontend" / "src-tauri"
BACKEND_SRC_DST = SRC_TAURI / "backend-src"
UV_BIN_DST = SRC_TAURI / "uv-bin"

# Pin a known-good uv release; bump as needed. Overridable via --uv-version.
# Must be recent enough to know how to download the Python version that the
# backend's `requires-python` asks for (currently 3.14).
DEFAULT_UV_VERSION = "0.11.7"

# Top-level directory names excluded when copying ``backend/``. Anything not
# required at runtime is skipped to keep the bundle small.
_BACKEND_EXCLUDED_DIRS = {
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".venv",
    "venv",
    "env",
    "node_modules",
    "tests",
    "docs",
    ".git",
    ".idea",
    ".vscode",
    "build",  # the *extracted* frontend build dir – the tarball is what we ship
    "dist",  # local wheel/sdist artefacts from prior `uv build` runs
}
_BACKEND_EXCLUDED_SUFFIXES = (".pyc", ".pyo")
_BACKEND_EXCLUDED_NAMES = {".DS_Store", ".gitignore"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Remove existing bundle staging dirs before writing",
    )
    parser.add_argument(
        "--uv-version",
        default=os.environ.get("LDACA_UV_VERSION", DEFAULT_UV_VERSION),
        help=f"uv release to download (default: {DEFAULT_UV_VERSION})",
    )
    return parser.parse_args()


# ---------------------------------------------------------------------------
# Filesystem helpers
# ---------------------------------------------------------------------------


def _handle_remove_error(func: object, path: str, excinfo: BaseException) -> None:
    """Best-effort fixups for read-only files during recursive deletion."""
    _ = func
    _ = excinfo
    target = Path(path)
    try:
        os.chmod(target, stat.S_IWRITE)
        if target.is_dir():
            os.rmdir(target)
        else:
            os.remove(target)
    except Exception:
        pass


def remove_tree_with_retries(
    path: Path, *, retries: int = 5, base_delay_seconds: float = 0.25
) -> None:
    """Remove a directory tree robustly (Windows file-handle races, etc.)."""
    if not path.exists():
        return

    last_error: OSError | None = None
    for attempt in range(1, retries + 1):
        try:
            shutil.rmtree(path, onexc=_handle_remove_error)
            return
        except FileNotFoundError:
            return
        except OSError as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(base_delay_seconds * attempt)
                continue

    if os.name == "nt" and path.exists():
        subprocess.run(
            ["cmd", "/d", "/s", "/c", "rmdir", "/s", "/q", str(path)],
            check=False,
            capture_output=True,
            text=True,
        )
        if not path.exists():
            return

    if last_error is not None:
        raise last_error
    raise RuntimeError(f"Failed to remove directory: {path}")


# ---------------------------------------------------------------------------
# Copy the project source tree
# ---------------------------------------------------------------------------


def _ignore_backend_entries(dirpath: str, names: list[str]) -> list[str]:
    ignored: list[str] = []
    for name in names:
        if name in _BACKEND_EXCLUDED_DIRS or name in _BACKEND_EXCLUDED_NAMES:
            ignored.append(name)
        elif name.endswith(_BACKEND_EXCLUDED_SUFFIXES):
            ignored.append(name)
    return ignored


def stage_backend_source(dst: Path) -> None:
    """Populate *dst* with the project files needed for ``uv sync`` at launch.

    Copies the workspace-level ``pyproject.toml`` and ``uv.lock`` plus the
    ``backend/`` tree. The frontend archive at
    ``backend/src/ldaca_web_app/resources/frontend/build.tar.gz`` must exist;
    the upstream npm script builds the frontend and drops the archive in
    place before this step.
    """
    remove_tree_with_retries(dst)
    dst.mkdir(parents=True, exist_ok=True)

    for leaf in ("pyproject.toml", "uv.lock"):
        src = PROJECT_ROOT / leaf
        if not src.is_file():
            raise RuntimeError(f"Missing required file: {src}")
        shutil.copy2(src, dst / leaf)

    backend_src = PROJECT_ROOT / "backend"
    if not backend_src.is_dir():
        raise RuntimeError(f"Missing backend source: {backend_src}")

    frontend_archive = (
        backend_src
        / "src"
        / "ldaca_web_app"
        / "resources"
        / "frontend"
        / "build.tar.gz"
    )
    if not frontend_archive.is_file():
        raise RuntimeError(
            "Frontend archive missing at "
            f"{frontend_archive}. Run "
            "`npm run deploy_frontend_to_backend` before packaging."
        )

    shutil.copytree(
        backend_src,
        dst / "backend",
        ignore=_ignore_backend_entries,
        dirs_exist_ok=False,
    )
    print(f"[INFO] Staged backend sources to {dst}")


# ---------------------------------------------------------------------------
# Download the uv binary
# ---------------------------------------------------------------------------


def _uv_target_triple() -> str:
    """Return the uv release target triple for the host platform.

    Mirrors the naming convention used by https://github.com/astral-sh/uv
    release assets.
    """
    system = platform.system()
    machine = platform.machine().lower()

    if system == "Darwin":
        arch = "aarch64" if machine in {"arm64", "aarch64"} else "x86_64"
        return f"{arch}-apple-darwin"
    if system == "Windows":
        arch = "aarch64" if machine in {"arm64", "aarch64"} else "x86_64"
        return f"{arch}-pc-windows-msvc"
    if system == "Linux":
        if machine in {"arm64", "aarch64"}:
            return "aarch64-unknown-linux-gnu"
        if machine in {"x86_64", "amd64"}:
            return "x86_64-unknown-linux-gnu"
    raise RuntimeError(f"Unsupported host platform: {system} / {machine}")


def _uv_archive_name(triple: str) -> str:
    return (
        f"uv-{triple}.zip" if triple.endswith("windows-msvc") else f"uv-{triple}.tar.gz"
    )


def stage_uv_binary(dst: Path, version: str) -> None:
    """Download the pinned uv release for the host platform into *dst*.

    The binary lands at ``dst/uv`` (``dst/uv.exe`` on Windows) with the
    executable bit set on POSIX. Any previous staged binary is replaced.
    """
    remove_tree_with_retries(dst)
    dst.mkdir(parents=True, exist_ok=True)

    triple = _uv_target_triple()
    archive_name = _uv_archive_name(triple)
    url = f"https://github.com/astral-sh/uv/releases/download/{version}/{archive_name}"
    print(f"[INFO] Downloading uv {version} for {triple}")
    print(f"       {url}")

    with urllib.request.urlopen(url) as response:  # noqa: S310 - trusted GitHub release
        payload = response.read()

    is_windows = triple.endswith("windows-msvc")
    target_name = "uv.exe" if is_windows else "uv"
    target_path = dst / target_name

    if is_windows:
        with zipfile.ZipFile(io.BytesIO(payload)) as zf:
            member = next(
                (m for m in zf.namelist() if m.endswith("uv.exe")),
                None,
            )
            if member is None:
                raise RuntimeError(f"uv.exe not found inside {archive_name}")
            with zf.open(member) as src_file, target_path.open("wb") as dst_file:
                shutil.copyfileobj(src_file, dst_file)
    else:
        with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as tf:
            member = next(
                (
                    m
                    for m in tf.getmembers()
                    if m.name.endswith("/uv") or m.name == "uv"
                ),
                None,
            )
            if member is None:
                raise RuntimeError(f"uv binary not found inside {archive_name}")
            extracted = tf.extractfile(member)
            if extracted is None:
                raise RuntimeError(
                    f"Could not extract {member.name} from {archive_name}"
                )
            with target_path.open("wb") as dst_file:
                shutil.copyfileobj(extracted, dst_file)
        target_path.chmod(
            target_path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH
        )

    print(f"[INFO] Installed uv binary at {target_path}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    args = parse_args()
    print("[INFO] Packaging LDaCA backend bundle")
    print(f"       Backend src -> {BACKEND_SRC_DST}")
    print(f"       uv binary   -> {UV_BIN_DST}")
    print(f"       uv version  -> {args.uv_version}\n")

    if args.clean:
        for target in (BACKEND_SRC_DST, UV_BIN_DST):
            if target.exists():
                print(f"[INFO] Cleaning {target}")
                remove_tree_with_retries(target)

    stage_backend_source(BACKEND_SRC_DST)
    stage_uv_binary(UV_BIN_DST, args.uv_version)

    print("\n[SUCCESS] Bundle staging complete")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        print(f"[ERROR] Command failed: {' '.join(exc.cmd)}", file=sys.stderr)
        sys.exit(exc.returncode)
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)
