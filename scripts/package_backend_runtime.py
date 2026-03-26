#!/usr/bin/env python3
"""Package the LDaCA backend into a relocatable runtime for Tauri."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import stat
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent


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
        default="3.14",
        help="Python version to vendor inside the runtime",
    )
    return parser.parse_args()


def run(
    cmd: list[str],
    *,
    cwd: Path | None = None,
    capture_output: bool = False,
    extra_env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess:
    display_cmd = " ".join(cmd)
    print(f"$ {display_cmd}")
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)
    return subprocess.run(
        cmd,
        cwd=cwd,
        check=True,
        capture_output=capture_output,
        text=True,
        env=env,
    )


def ensure_uv_is_available() -> None:
    if shutil.which("uv") is None:
        raise RuntimeError("The 'uv' CLI is required but was not found in PATH")


def _handle_remove_error(func: object, path: str, excinfo: BaseException) -> None:
    """Best-effort fixups for read-only files during recursive deletion."""
    _ = func  # unused but part of shutil callback contract
    _ = excinfo
    target = Path(path)
    try:
        os.chmod(target, stat.S_IWRITE)
        if target.is_dir():
            os.rmdir(target)
        else:
            os.remove(target)
    except Exception:
        # Let the outer retry/fallback logic decide what to do next.
        pass


def remove_tree_with_retries(
    path: Path, *, retries: int = 5, base_delay_seconds: float = 0.25
) -> None:
    """Remove a directory tree robustly, especially on Windows.

    Windows can intermittently throw errors like WinError 145 (directory not
    empty) during deep deletions due to delayed file handle release. We retry
    and then fall back to `rmdir /s /q` when needed.
    """
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

    # Final Windows-specific fallback.
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


def remove_externally_managed_markers(root: Path) -> None:
    for marker in root.rglob("EXTERNALLY-MANAGED"):
        marker.unlink()


def create_uv_packaging_env(managed_install_dir: Path) -> dict[str, str]:
    """Create a uv environment tuned for relocatable runtime packaging."""
    return {
        "UV_LINK_MODE": "copy",
        "UV_PYTHON_INSTALL_DIR": str(managed_install_dir),
        "UV_PYTHON_PREFER_MANAGED": "1",
        "UV_PYTHON_DOWNLOADS": "automatic",
        "UV_VENV_CLEAR": "1",
    }


def find_runtime_python(runtime_root: Path, runtime_python_dir: Path) -> Path:
    """Locate the preferred Python executable in packaged runtime.

    Prefer managed-python's real interpreter first for relocatability.
    Fall back to venv launchers across platforms if needed.
    """
    managed_python_dir = runtime_root / "managed-python"
    managed_candidates = [
        *managed_python_dir.glob("cpython-*/python.exe"),
        *managed_python_dir.glob("cpython-*/bin/python3"),
    ]
    candidates = [
        *managed_candidates,
        runtime_python_dir / "bin" / "python3",
        runtime_python_dir / "bin" / "python",
        runtime_python_dir / "Scripts" / "python.exe",
        runtime_python_dir / "python.exe",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise RuntimeError(
        f"Unable to locate python executable inside {runtime_python_dir}"
    )


def assert_runtime_python_is_relocatable(python_bin: Path, output_dir: Path) -> None:
    """Fail fast if runtime Python points outside the shipped runtime directory."""
    if python_bin.is_symlink():
        resolved = python_bin.resolve()
        if not resolved.is_relative_to(output_dir):
            raise RuntimeError(
                "Runtime python symlink points outside bundled runtime. "
                f"Resolved target: {resolved}, runtime root: {output_dir}"
            )


def ensure_venv_libpython(
    *,
    managed_install_dir: Path,
    runtime_python_dir: Path,
    python_version: str,
) -> None:
    """Copy libpython into the venv lib directory for relocatable execution.

    On macOS the vendored CPython resolves `@rpath/libpythonX.Y.dylib` against
    the virtualenv's `python/lib` directory.  On Linux a similar `.so` lookup
    applies.  On Windows the DLL lives next to `python.exe` and is found via
    the standard DLL search order, so no manual copy is needed.
    """
    if sys.platform == "win32":
        print("[INFO] Skipping libpython copy (not required on Windows)")
        return

    major_minor = ".".join(python_version.split(".")[:2])
    if sys.platform == "darwin":
        libpython_name = f"libpython{major_minor}.dylib"
    else:
        libpython_name = f"libpython{major_minor}.so"

    source = next(
        managed_install_dir.glob(f"**/{libpython_name}"),
        None,
    )
    if source is None:
        raise RuntimeError(
            f"Could not locate {libpython_name} under managed python at {managed_install_dir}"
        )

    venv_lib_dir = runtime_python_dir / "lib"
    venv_lib_dir.mkdir(parents=True, exist_ok=True)
    target = venv_lib_dir / libpython_name
    shutil.copy2(source, target)
    print(f"[INFO] Copied {libpython_name} to {target}")


def sync_runtime_environment(
    *, runtime_python_dir: Path, uv_packaging_env: dict[str, str]
) -> None:
    print("[INFO] Syncing backend runtime environment from uv.lock")
    sync_env = dict(uv_packaging_env)
    sync_env["UV_PROJECT_ENVIRONMENT"] = str(runtime_python_dir)
    sync_env["VIRTUAL_ENV"] = str(runtime_python_dir)
    run(
        [
            "uv",
            "sync",
            "--frozen",
            "--no-dev",
            "--no-editable",
        ],
        cwd=PROJECT_ROOT,
        extra_env=sync_env,
    )


def write_runtime_manifest(
    *,
    output_dir: Path,
    python_bin: Path,
    python_version: str,
) -> None:
    """Write a small manifest for debugging shipped runtime contents."""
    try:
        git_sha = run(
            ["git", "rev-parse", "HEAD"], cwd=PROJECT_ROOT, capture_output=True
        ).stdout.strip()
    except Exception:
        git_sha = "unknown"

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "python_version": python_version,
        "python_executable": str(python_bin),
        "git_sha": git_sha,
        "install_method": "uv-sync",
    }
    manifest_path = output_dir / "runtime-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"[INFO] Wrote runtime manifest to {manifest_path}")


def main() -> None:
    args = parse_args()
    ensure_uv_is_available()

    output_dir = Path(args.output).expanduser().resolve()
    dist_root = output_dir.parent
    managed_python_dir = output_dir / "managed-python"
    uv_packaging_env = create_uv_packaging_env(managed_python_dir)

    print("[INFO] Packaging backend runtime")
    print(f"   Output dir:     {output_dir}")
    print(f"   Python version: {args.python_version}\n")

    if args.clean and dist_root.exists():
        print(f"[INFO] Removing previous dist at {dist_root}")
        remove_tree_with_retries(dist_root)

    for d in (output_dir, dist_root):
        d.mkdir(parents=True, exist_ok=True)

    print("[INFO] Setting up Python runtime via uv venv...")
    run(
        ["uv", "python", "install", args.python_version],
        extra_env=uv_packaging_env,
    )

    runtime_python_dir = output_dir / "python"
    if runtime_python_dir.exists():
        remove_tree_with_retries(runtime_python_dir)

    run(
        [
            "uv",
            "venv",
            str(runtime_python_dir),
            "--python",
            args.python_version,
        ],
        extra_env=uv_packaging_env,
    )

    remove_externally_managed_markers(runtime_python_dir)

    python_bin = find_runtime_python(output_dir, runtime_python_dir)
    assert_runtime_python_is_relocatable(python_bin, output_dir)
    ensure_venv_libpython(
        managed_install_dir=managed_python_dir,
        runtime_python_dir=runtime_python_dir,
        python_version=args.python_version,
    )

    sync_runtime_environment(
        runtime_python_dir=runtime_python_dir,
        uv_packaging_env=uv_packaging_env,
    )

    write_runtime_manifest(
        output_dir=output_dir,
        python_bin=python_bin,
        python_version=args.python_version,
    )

    print("[SUCCESS] Backend runtime created")
    print(f"   Runtime folder: {output_dir}")
    print(f"   Python entry:   {python_bin}")
    print("   Install mode:   uv sync --no-editable")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        print(f"[ERROR] Command failed: {' '.join(exc.cmd)}", file=sys.stderr)
        sys.exit(exc.returncode)
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)
