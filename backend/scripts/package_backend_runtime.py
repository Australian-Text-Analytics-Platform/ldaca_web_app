#!/usr/bin/env python3
"""Package the LDaCA backend into a relocatable runtime for Tauri."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tomllib
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
WORKSPACE_ROOT = PROJECT_ROOT.parent


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
    }


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


def get_project_name(package_path: Path) -> str:
    pyproject = package_path / "pyproject.toml"
    if not pyproject.exists():
        print(
            f"[WARNING] No pyproject.toml found at {package_path}; using directory name."
        )
        return package_path.name

    try:
        data = tomllib.loads(pyproject.read_text(encoding="utf-8"))
    except Exception as e:
        print(
            f"[WARNING] Failed to parse pyproject.toml at {package_path}: {e}; using directory name."
        )
        return package_path.name

    name = data.get("project", {}).get("name")
    if not name:
        print(f"[WARNING] No [project].name in {pyproject}; using directory name.")
        return package_path.name
    return str(name)


def get_workspace_packages(workspace_root: Path) -> list[tuple[str, Path]]:
    """Parse pyproject.toml to find workspace members."""
    pyproject = workspace_root / "pyproject.toml"
    if not pyproject.exists():
        print(f"[WARNING] No pyproject.toml found at {workspace_root}.")
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
        for path in workspace_root.glob(member_pattern):
            # Skip if it is the backend itself, as we handle it separately
            if path.resolve() == PROJECT_ROOT.resolve():
                continue
            if path.is_dir() and (path / "pyproject.toml").exists():
                packages.append((get_project_name(path), path))

    return packages


def find_runtime_python(runtime_python_dir: Path) -> Path:
    """Locate the Python executable in a venv across platforms."""
    candidates = [
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


def write_runtime_manifest(
    *,
    output_dir: Path,
    python_bin: Path,
    python_version: str,
    built_wheels: list[Path],
) -> None:
    """Write a small manifest for debugging shipped runtime contents."""
    try:
        git_sha = run(
            ["git", "rev-parse", "HEAD"], cwd=WORKSPACE_ROOT, capture_output=True
        ).stdout.strip()
    except Exception:
        git_sha = "unknown"

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "python_version": python_version,
        "python_executable": str(python_bin),
        "git_sha": git_sha,
        "wheels": [wheel.name for wheel in sorted(built_wheels)],
    }
    manifest_path = output_dir / "runtime-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"[INFO] Wrote runtime manifest to {manifest_path}")


def run_runtime_smoke_checks(
    *,
    python_bin: Path,
    import_modules: list[str],
    output_dir: Path,
) -> None:
    """Run lightweight checks to verify packaged runtime usability."""
    import_stmt = "; ".join(f"import {module}" for module in import_modules)
    run([
        str(python_bin),
        "-c",
        f"{import_stmt}; print('runtime import smoke check passed')",
    ])

    prefix_check = run(
        [
            str(python_bin),
            "-c",
            "import json,sys; print(json.dumps({'prefix': sys.prefix, 'base_prefix': sys.base_prefix}))",
        ],
        capture_output=True,
    )
    prefix_info = json.loads(prefix_check.stdout.strip())
    base_prefix = Path(prefix_info["base_prefix"]).resolve()
    if not base_prefix.is_relative_to(output_dir):
        raise RuntimeError(
            "Packaged runtime base_prefix is outside runtime directory: "
            f"{base_prefix} not under {output_dir}"
        )


def main() -> None:
    args = parse_args()
    ensure_uv_is_available()

    output_dir = Path(args.output).expanduser().resolve()
    dist_root = output_dir.parent
    runtime_name = output_dir.name
    managed_python_dir = output_dir / "managed-python"
    lockfile = dist_root / f"{runtime_name}-requirements.txt"
    sanitized_lockfile = dist_root / f"{runtime_name}-thirdparty.txt"
    wheel_dir = dist_root / "wheels"
    uv_packaging_env = create_uv_packaging_env(managed_python_dir)

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

    print("[INFO] Setting up Python runtime via uv venv...")
    run(
        ["uv", "python", "install", args.python_version],
        extra_env=uv_packaging_env,
    )

    runtime_python_dir = output_dir / "python"
    if runtime_python_dir.exists():
        shutil.rmtree(runtime_python_dir)

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

    python_bin = find_runtime_python(runtime_python_dir)
    assert_runtime_python_is_relocatable(python_bin, output_dir)

    # DYNAMIC PACKAGE DISCOVERY
    workspace_packages = get_workspace_packages(WORKSPACE_ROOT)

    # Also build the root package (backend)
    # We infer the name from pyproject.toml or just use the dir name/hardcoded fallback
    # The original script used "ldaca-web-app-backend"
    workspace_packages.append((get_project_name(PROJECT_ROOT), PROJECT_ROOT))

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
            raise RuntimeError(
                "Failed to discover a built wheel for package "
                f"{pkg_name} using prefix {normalized_name}. "
                "Please ensure package name and wheel filename normalization match."
            )

    print("[INFO] Installing third-party dependencies")
    run(
        [
            "uv",
            "pip",
            "install",
            "--python",
            str(python_bin),
            "--link-mode",
            "copy",
            "-r",
            str(sanitized_lockfile),
        ],
        cwd=PROJECT_ROOT,
        extra_env=uv_packaging_env,
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
                "--link-mode",
                "copy",
                "--no-deps",
                str(wheel_path),
            ],
            cwd=PROJECT_ROOT,
            extra_env=uv_packaging_env,
        )

    import_modules = ["ldaca_web_app_backend", "polars_text"]
    run_runtime_smoke_checks(
        python_bin=python_bin,
        import_modules=import_modules,
        output_dir=output_dir,
    )

    write_runtime_manifest(
        output_dir=output_dir,
        python_bin=python_bin,
        python_version=args.python_version,
        built_wheels=built_wheels,
    )

    if lockfile.exists():
        lockfile.unlink()
    if sanitized_lockfile.exists():
        sanitized_lockfile.unlink()
        print("[INFO] Removed temporary lockfiles")

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
