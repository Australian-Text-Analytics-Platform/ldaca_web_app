#!/usr/bin/env python3
"""Package the LDaCA backend into a relocatable runtime for Tauri."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
BACKEND_PROJECT_ROOT = PROJECT_ROOT / "backend"
PACKAGED_PYTHON_SELECTOR = "3.14"


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
        default=PACKAGED_PYTHON_SELECTOR,
        choices=(PACKAGED_PYTHON_SELECTOR,),
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


def create_uv_managed_python_env(managed_install_dir: Path) -> dict[str, str]:
    """Point uv-managed Python discovery at the runtime-local install dir."""
    return {
        "UV_PYTHON_INSTALL_DIR": str(managed_install_dir),
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


def find_runtime_python_home(runtime_root: Path) -> Path:
    """Return the managed CPython home consumed by the desktop launcher.

    Used by :func:`write_runtime_manifest` after ``uv sync``. The directory
    must contain the standard-library encodings package so a partial or stale
    managed-Python download cannot become a valid desktop contract.
    """
    managed_dir = runtime_root / "managed-python"
    for candidate in managed_dir.glob("cpython-*"):
        if (candidate / "Lib" / "encodings").is_dir():
            return candidate
        if any((candidate / "lib").glob("python3.*/encodings")):
            return candidate
    raise RuntimeError(f"Unable to locate managed Python home inside {managed_dir}")


def find_runtime_site_packages(runtime_python_dir: Path) -> Path:
    """Return the venv site-packages directory used by the packaged backend.

    Called by :func:`write_runtime_manifest` so Rust never needs to infer the
    platform-specific venv layout at application startup.
    """
    windows_site_packages = runtime_python_dir / "Lib" / "site-packages"
    if windows_site_packages.is_dir():
        return windows_site_packages

    for candidate in (runtime_python_dir / "lib").glob("python3.*/site-packages"):
        if candidate.is_dir():
            return candidate
    raise RuntimeError(
        f"Unable to locate site-packages inside {runtime_python_dir}"
    )


def relative_runtime_path(path: Path, runtime_root: Path) -> str:
    """Serialize one runtime-owned path as a portable POSIX relative path.

    Used only when emitting the runtime manifest. Rejecting paths outside the
    runtime prevents checkout or build-machine locations from leaking into a
    bundle that is expected to survive relocation.
    """
    try:
        relative = path.resolve().relative_to(runtime_root.resolve())
    except ValueError as exc:
        raise RuntimeError(
            f"Runtime path {path} is outside runtime root {runtime_root}"
        ) from exc
    return relative.as_posix()


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

    base_version = python_version.split("+", maxsplit=1)[0]
    major_minor = ".".join(base_version.split(".")[:2])
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
    *, runtime_python_dir: Path, managed_python_dir: Path
) -> None:
    print("[INFO] Syncing backend runtime environment from backend/uv.lock")
    sync_env = create_uv_managed_python_env(managed_python_dir)
    sync_env["UV_PROJECT_ENVIRONMENT"] = str(runtime_python_dir)
    run(
        [
            "uv",
            "sync",
            "--locked",
            "--no-dev",
            "--no-editable",
            "--link-mode",
            "copy",
            "--managed-python",
        ],
        cwd=BACKEND_PROJECT_ROOT,
        extra_env=sync_env,
    )


def remove_macos_metadata_files(root: Path) -> int:
    """Remove Finder metadata that cannot survive DMG installation intact."""
    removed = 0
    for pattern in ("._*", ".DS_Store"):
        for path in root.rglob(pattern):
            if path.is_file() or path.is_symlink():
                path.unlink()
                removed += 1
    if removed:
        print(f"[INFO] Removed {removed} macOS metadata files from packaged runtime")
    return removed


def write_runtime_manifest(
    *,
    output_dir: Path,
    python_bin: Path,
    python_version: str,
) -> None:
    """Write the authoritative relative layout consumed by Tauri.

    Called after environment synchronization. The launcher resolves these
    three paths against the relocated ``backend-runtime`` root and does no
    interpreter, Python-home, or site-packages scanning of its own.
    """
    python_home = find_runtime_python_home(output_dir)
    site_packages = find_runtime_site_packages(output_dir / "python")
    interpreter = json.loads(
        run(
            [
                str(python_bin),
                "-c",
                (
                    "import json,platform,sys,sysconfig;"
                    "print(json.dumps({'version':platform.python_version(),"
                    "'free_threaded':bool(sysconfig.get_config_var('Py_GIL_DISABLED')),"
                    "'platform':sys.platform,'machine':platform.machine().lower()}))"
                ),
            ],
            capture_output=True,
        ).stdout
    )
    if not interpreter["version"].startswith("3.14.") or interpreter["free_threaded"]:
        raise RuntimeError(
            "Packaged runtime must use standard (GIL-enabled) CPython 3.14"
        )
    target_os = {
        "darwin": "macos",
        "win32": "windows",
        "linux": "linux",
    }.get(interpreter["platform"])
    target_arch = {
        "arm64": "aarch64",
        "aarch64": "aarch64",
        "amd64": "x86_64",
        "x86_64": "x86_64",
    }.get(interpreter["machine"])
    if target_os is None or target_arch is None:
        raise RuntimeError("Unsupported packaged Python target platform")
    lock_hash = hashlib.sha256(
        (BACKEND_PROJECT_ROOT / "uv.lock").read_bytes()
    ).hexdigest()
    manifest = {
        "schema_version": 2,
        "target_os": target_os,
        "target_arch": target_arch,
        "python_selector": python_version,
        "python_version": interpreter["version"],
        "python_free_threaded": interpreter["free_threaded"],
        "uv_lock_sha256": lock_hash,
        "python_executable": relative_runtime_path(python_bin, output_dir),
        "python_home": relative_runtime_path(python_home, output_dir),
        "site_packages": relative_runtime_path(site_packages, output_dir),
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
    uv_managed_python_env = create_uv_managed_python_env(managed_python_dir)

    print("[INFO] Packaging backend runtime")
    print(f"   Output dir:     {output_dir}")
    print(f"   Python version: {args.python_version}\n")

    if args.clean and dist_root.exists():
        print(f"[INFO] Removing previous dist at {dist_root}")
        remove_tree_with_retries(dist_root)

    output_dir.mkdir(parents=True, exist_ok=True)
    runtime_python_dir = output_dir / "python"

    print("[INFO] Setting up managed Python runtime via uv venv...")
    run(
        [
            "uv",
            "venv",
            str(runtime_python_dir),
            "--python",
            args.python_version,
            "--managed-python",
            "--clear",
        ],
        extra_env=uv_managed_python_env,
    )

    python_bin = find_runtime_python(output_dir, runtime_python_dir)
    assert_runtime_python_is_relocatable(python_bin, output_dir)
    ensure_venv_libpython(
        managed_install_dir=managed_python_dir,
        runtime_python_dir=runtime_python_dir,
        python_version=args.python_version,
    )

    sync_runtime_environment(
        runtime_python_dir=runtime_python_dir,
        managed_python_dir=managed_python_dir,
    )
    remove_macos_metadata_files(output_dir)

    write_runtime_manifest(
        output_dir=output_dir,
        python_bin=python_bin,
        python_version=args.python_version,
    )

    print("[SUCCESS] Backend runtime created")
    print(f"   Runtime folder: {output_dir}")
    print(f"   Python entry:   {python_bin}")
    print("   Install mode:   uv sync --no-editable --link-mode copy")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        print(f"[ERROR] Command failed: {' '.join(exc.cmd)}", file=sys.stderr)
        sys.exit(exc.returncode)
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)
