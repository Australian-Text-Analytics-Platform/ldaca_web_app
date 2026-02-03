#!/usr/bin/env python3
"""Package the LDaCA backend into a relocatable runtime for Tauri."""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
import tomllib
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


def copy_python_installation(source_root: Path, destination_root: Path) -> None:
    if destination_root.exists():
        shutil.rmtree(destination_root)
    print(
        f"[INFO] Copying Python installation from {source_root} to {destination_root}"
    )
    shutil.copytree(
        source_root,
        destination_root,
        symlinks=False,
        dirs_exist_ok=True,
    )


def fix_macos_python_linking(python_root: Path) -> None:
    """Fix Python dynamic library linking on macOS to be relocatable."""
    if platform.system() != "Darwin":
        return

    print("[INFO] Fixing macOS Python dynamic library linking for relocatability")

    # Find the Python binary
    python_bin = python_root / "bin" / "python3"
    if not python_bin.exists():
        print("   [WARNING] Python binary not found, skipping relinking")
        return

    # Find the Python dynamic library
    lib_dir = python_root / "lib"
    dylib_candidates = list(lib_dir.glob("libpython3*.dylib"))

    if not dylib_candidates:
        print("   [WARNING] Python dylib not found, skipping relinking")
        return

    dylib = dylib_candidates[0]
    print(f"   Found Python dylib: {dylib.name}")

    # Get the current install name
    result = subprocess.run(
        ["otool", "-L", str(python_bin)], capture_output=True, text=True, check=True
    )

    # Check if it references an absolute Framework path
    framework_ref = None
    for line in result.stdout.splitlines():
        if (
            "/Library/Frameworks/Python.framework" in line
            or "/Python.framework" in line
        ):
            framework_ref = line.strip().split()[0]
            break

    if framework_ref:
        print(f"   Changing {framework_ref}")
        print(f"   To @executable_path/../lib/{dylib.name}")

        # Change the Python binary to use @executable_path relative reference
        subprocess.run(
            [
                "install_name_tool",
                "-change",
                framework_ref,
                f"@executable_path/../lib/{dylib.name}",
                str(python_bin),
            ],
            check=True,
        )

        # Also update the dylib's own install name to be relative
        subprocess.run(
            [
                "install_name_tool",
                "-id",
                f"@rpath/{dylib.name}",
                str(dylib),
            ],
            check=True,
        )

        print("   [SUCCESS] Python linking fixed for bundle relocatability")
    else:
        print("   [INFO] No absolute Framework references found, already relocatable")


def remove_externally_managed_markers(root: Path) -> None:
    for marker in root.rglob("EXTERNALLY-MANAGED"):
        marker.unlink()


def build_local_wheel(package_path: Path, wheel_dir: Path, label: str) -> None:
    if not package_path.exists():
        raise RuntimeError(f"Source directory for {label} not found at {package_path}")
    print(f"[INFO] Building wheel for {label}")
    run(
        ["uv", "build", str(package_path), "--wheel", "--out-dir", str(wheel_dir)],
        cwd=package_path,
    )


def find_latest_wheel(wheel_dir: Path, prefix: str) -> Path:
    # Note: prefix should be the normalized package name (e.g. underscores instead of dashes for filenames)
    # But usually uv build outputs predictable names.
    # We'll use glob.
    matches = sorted(wheel_dir.glob(f"{prefix}-*.whl"))
    if not matches:
        raise RuntimeError(f"Expected wheel starting with {prefix}- in {wheel_dir}")
    return matches[-1]


def download_nltk_data(destination_dir: Path) -> None:
    print(f"[INFO] Downloading NLTK data to {destination_dir}")
    destination_dir.mkdir(parents=True, exist_ok=True)

    try:
        import nltk
    except ImportError:
        print("[ERROR] NLTK is not installed in the environment running this script.")
        print("[INFO] Please run this script with 'uv run ...' or install nltk.")
        sys.exit(1)

    resources = ["punkt_tab", "punkt", "averaged_perceptron_tagger_eng", "stopwords"]
    failed = []

    for res in resources:
        print(f"   Downloading {res}...")
        try:
            if not nltk.download(res, download_dir=str(destination_dir), quiet=True):
                failed.append(res)
        except Exception as e:
            print(f"   [ERROR] {res}: {e}")
            failed.append(res)

    if failed:
        print(f"   [ERROR] Failed: {failed}")
        sys.exit(1)

    print("   [SUCCESS] NLTK resources downloaded")


def get_workspace_packages(project_root: Path) -> list[tuple[str, Path]]:
    """Parse pyproject.toml to find workspace members."""
    pyproject = project_root / "pyproject.toml"
    if not pyproject.exists():
        print("[WARNING] No pyproject.toml found.")
        return []

    try:
        data = tomllib.loads(pyproject.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[WARNING] Failed to parse pyproject.toml: {e}")
        return []

    members = data.get("tool", {}).get("uv", {}).get("workspace", {}).get("members", [])
    if not members:
        print("[INFO] No workspace members found.")
        return []

    print(f"[INFO] Found workspace members: {members}")
    packages: list[tuple[str, Path]] = []

    for member_pattern in members:
        # Glob handles both direct paths and wildcards
        for path in project_root.glob(member_pattern):
            if path.is_dir() and (path / "pyproject.toml").exists():
                packages.append((path.name, path))

    return packages


def main() -> None:
    args = parse_args()
    ensure_uv_is_available()

    output_dir = Path(args.output).expanduser().resolve()
    dist_root = output_dir.parent
    runtime_name = output_dir.name
    lockfile = dist_root / f"{runtime_name}-requirements.txt"
    sanitized_lockfile = dist_root / f"{runtime_name}-thirdparty.txt"
    wheel_dir = dist_root / "wheels"

    print("[INFO] Packaging backend runtime")
    print(f"   Output dir:     {output_dir}")
    print(f"   Python version: {args.python_version}\n")

    if args.clean and dist_root.exists():
        print(f"[INFO] Removing previous dist at {dist_root}")
        shutil.rmtree(dist_root)

    for d in (output_dir, dist_root, wheel_dir):
        d.mkdir(parents=True, exist_ok=True)

    if lockfile.exists():
        lockfile.unlink()
    if sanitized_lockfile.exists():
        sanitized_lockfile.unlink()

    print("[INFO] Resolving dependencies...")
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

    sanitize_lockfile(lockfile, sanitized_lockfile)
    print(f"[INFO] Lockfile written to {sanitized_lockfile}")

    print("[INFO] Setting up Python...")

    # Prefer UV_PYTHON_INSTALL_DIR if set (CI/managed environments)
    uv_install_dir = os.environ.get("UV_PYTHON_INSTALL_DIR")
    if uv_install_dir:
        uv_install_path = Path(uv_install_dir)
        # Ensure the install directory exists
        uv_install_path.mkdir(parents=True, exist_ok=True)

        # Install Python to the custom directory
        run(["uv", "python", "install", args.python_version])

        # Find the installed managed Python in the custom directory
        managed_candidates = sorted(
            uv_install_path.glob(f"cpython-{args.python_version}*")
        )
        if managed_candidates:
            managed_root = managed_candidates[-1]
            print(f"   Using managed Python from UV_PYTHON_INSTALL_DIR: {managed_root}")
            python_install_root = managed_root
        else:
            raise RuntimeError(
                f"UV_PYTHON_INSTALL_DIR is set to {uv_install_dir}, "
                f"but no Python {args.python_version} installation was found there. "
                f"Found directories: {list(uv_install_path.iterdir())}"
            )
    else:
        # Fallback to standard uv python find
        run(["uv", "python", "install", args.python_version])
        find_result = run(
            ["uv", "python", "find", "--managed-python", args.python_version],
            capture_output=True,
        )
        # The detected path might be inside a venv (symlink). Resolve it to the actual interpreter.
        raw_python_bin = Path(find_result.stdout.strip().splitlines()[-1])
        base_python_bin = raw_python_bin.resolve()

        print(f"   Base Python found at: {base_python_bin}")
        if base_python_bin != raw_python_bin:
            print(f"   Resolved from: {raw_python_bin}")

        python_install_root = base_python_bin.parent.parent

    runtime_python_dir = output_dir / "python"
    copy_python_installation(python_install_root, runtime_python_dir)
    fix_macos_python_linking(runtime_python_dir)
    remove_externally_managed_markers(runtime_python_dir)

    python_bin = runtime_python_dir / "bin" / "python3"
    if not python_bin.exists():
        python_bin = runtime_python_dir / "python.exe"
    if not python_bin.exists():
        raise RuntimeError(
            f"Unable to locate python executable inside {runtime_python_dir}"
        )

    # DYNAMIC PACKAGE DISCOVERY
    workspace_packages = get_workspace_packages(PROJECT_ROOT)

    # Also build the root package (backend)
    # We infer the name from pyproject.toml or just use the dir name/hardcoded fallback
    # The original script used "ldaca-web-app-backend"
    workspace_packages.append(("ldaca-web-app-backend", PROJECT_ROOT))

    built_wheels = []
    for pkg_name, pkg_path in workspace_packages:
        build_local_wheel(pkg_path, wheel_dir, pkg_name)
        # We need to find the filename that was just built
        # For simplicity, we find generic wheel match for the package name
        # Package names in wheels are normalized (dashes -> underscores)
        normalized_name = pkg_name.replace("-", "_")
        try:
            wheel = find_latest_wheel(wheel_dir, normalized_name)
            built_wheels.append(wheel)
        except RuntimeError:
            # Fallback for when glob fails (e.g. name mismatch)
            print(
                f"   [WARNING] Could not find wheel for {pkg_name} using prefix {normalized_name}, trying glob *"
            )
            pass

    print("[INFO] Installing third-party dependencies")
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

    print("[INFO] Installing bundled workspace packages")
    for wheel_path in built_wheels:
        print(f"   Installing {wheel_path.name}")
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
        print("[INFO] Removed temporary lockfiles")

    download_nltk_data(runtime_python_dir / "nltk_data")

    print("[SUCCESS] Backend runtime created")
    print(f"   Runtime folder: {output_dir}")
    print(f"   Python entry:   {python_bin}")
    print(f"   Wheels staged:  {wheel_dir}")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        print(f"[ERROR] Command failed: {' '.join(exc.cmd)}", file=sys.stderr)
        sys.exit(exc.returncode)
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)
