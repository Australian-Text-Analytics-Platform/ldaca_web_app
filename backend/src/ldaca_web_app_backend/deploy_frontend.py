"""Utilities to deploy the compiled frontend assets and configure nginx.

Primary entry point: ``deploy_frontend`` or running this file as a script.

Features
---------
1. If ``use_release=True`` (default) download the pre-built frontend bundle
   from the GitHub release URL and extract it.
2. If ``use_release=False`` build the frontend locally (requires Node/NPM)
   using ``npm ci && npm run build`` inside the frontend directory.
3. Generate an ``nginx.conf`` from ``configs/nginx.conf.template`` using
   ``envsubst`` (nginx + envsubst assumed installed on host) and reload nginx.

Environment variables used in template:
  FRONTEND_PORT  (default 3000 if not set)
  BACKEND_PORT   (default 8001 if not set)
  FRONTEND_DIR   (set automatically to extracted/build directory if not set)

Example CLI usage:
  uv run python -m ldaca_web_app_backend.deploy_frontend --use-release
  uv run python -m ldaca_web_app_backend.deploy_frontend --no-use-release --frontend-root ../../frontend

"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path
from typing import Dict
from urllib.request import urlopen

RELEASE_URL = (
    "https://github.com/Australian-Text-Analytics-Platform/ldaca_web_app/releases/download/"
    "frontend-latest/frontend-build.tar.gz"
)

# Relative to this file: configs/nginx.conf.template
BACKEND_ROOT = Path(__file__).resolve().parent
CONFIGS_DIR = BACKEND_ROOT.parent / "configs"
NGINX_TEMPLATE = CONFIGS_DIR / "nginx.conf.template"
DEFAULT_OUTPUT_CONF = Path("/etc/nginx/conf.d/ldaca_frontend.conf")


def _log(msg: str):  # simple logger
    print(f"[deploy_frontend] {msg}")


def download_release(url: str = RELEASE_URL, destination: Path | None = None) -> Path:
    """Download the release tar.gz to a destination directory and return extracted path.

    The tarball is expected to contain the built frontend assets (e.g. index.html, assets/...).
    """
    if destination is None:
        destination = Path.cwd() / "frontend_build"
    destination.mkdir(parents=True, exist_ok=True)

    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".tar.gz", prefix="frontend-build-")
    os.close(tmp_fd)
    tmp_path_p = Path(tmp_path)
    _log(f"Downloading release build to {tmp_path_p} ...")
    with urlopen(url) as resp, open(tmp_path_p, "wb") as f:  # nosec B310 (trusted URL provided by us)
        shutil.copyfileobj(resp, f)

    extract_dir = destination
    _log(f"Extracting tarball to {extract_dir} ...")
    with tarfile.open(tmp_path_p, "r:gz") as tf:
        tf.extractall(extract_dir)
    tmp_path_p.unlink(missing_ok=True)

    # If tarball created a nested directory with build assets pick first one
    potential_index = None
    for p in extract_dir.rglob("index.html"):
        potential_index = p
        break
    if not potential_index:
        raise RuntimeError("Downloaded release did not contain an index.html")
    _log(f"Release extracted. index.html at: {potential_index}")
    return extract_dir


def build_frontend(frontend_root: Path, build_dir: Path | None = None) -> Path:
    """Build the frontend locally (requires node & npm).

    Returns the directory containing the production build (assumes build/ output).
    """
    if build_dir is None:
        build_dir = frontend_root / "build"
    if not frontend_root.exists():
        raise FileNotFoundError(f"Frontend root not found: {frontend_root}")
    _log(f"Installing dependencies in {frontend_root} ...")
    subprocess.run(["npm", "ci"], cwd=frontend_root, check=True)
    _log("Running build ...")
    subprocess.run(["npm", "run", "build"], cwd=frontend_root, check=True)
    if not build_dir.exists():
        raise RuntimeError(f"Expected build output at {build_dir}")
    _log(f"Local build complete: {build_dir}")
    return build_dir


def configure_nginx(
    template_path: Path = NGINX_TEMPLATE,
    output_conf: Path = DEFAULT_OUTPUT_CONF,
    env: Dict[str, str] | None = None,
    reload: bool = True,
) -> Path:
    """Generate nginx.conf using envsubst and optionally reload nginx.

    Requires `envsubst` and `nginx` to be installed on the system.
    """
    if not template_path.exists():
        raise FileNotFoundError(f"nginx template not found: {template_path}")

    env = {**os.environ, **(env or {})}

    # Ensure required placeholders have values; provide defaults as described.
    env.setdefault("FRONTEND_PORT", os.environ.get("FRONTEND_PORT", "3000"))
    env.setdefault("BACKEND_PORT", os.environ.get("BACKEND_PORT", "8001"))
    if "FRONTEND_DIR" not in env:
        raise ValueError("FRONTEND_DIR must be set in env to configure nginx")

    output_conf.parent.mkdir(parents=True, exist_ok=True)

    # Run envsubst
    _log(f"Rendering nginx config to {output_conf} ...")
    # Because shell redirection is needed, run through shell with proper environment
    rendered = subprocess.run(
        f"envsubst < {template_path}",
        shell=True,
        check=True,
        capture_output=True,
        text=True,
        env=env,
    ).stdout

    output_conf.write_text(rendered)

    if reload:
        _log("Testing nginx configuration ...")
        subprocess.run(["nginx", "-t"], check=True)
        _log("Reloading nginx ...")
        subprocess.run(["nginx", "-s", "reload"], check=True)

    return output_conf


def deploy_frontend(
    use_release: bool = True,
    frontend_root: Path | None = None,
    destination: Path | None = None,
    nginx_conf_output: Path = DEFAULT_OUTPUT_CONF,
) -> Path:
    """High level helper to obtain frontend assets & configure nginx.

    Returns the path to the directory containing the served static files.
    """
    if use_release:
        build_dir = download_release(destination=destination)
    else:
        if frontend_root is None:
            # assume repo layout: backend sibling directory named 'frontend'
            frontend_root = BACKEND_ROOT.parent / "frontend"
        build_dir = build_frontend(frontend_root)

    # Configure nginx pointing root to build_dir
    configure_nginx(
        env={"FRONTEND_DIR": str(build_dir.resolve())}, output_conf=nginx_conf_output
    )
    _log("Deployment complete.")
    return build_dir


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Deploy frontend (download release or build locally) and configure nginx."
    )
    parser.add_argument(
        "--use-release",
        dest="use_release",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Download pre-built release instead of building locally (default: True)",
    )
    parser.add_argument(
        "--frontend-root",
        type=Path,
        default=None,
        help="Path to frontend source (only used when --no-use-release)",
    )
    parser.add_argument(
        "--destination",
        type=Path,
        default=None,
        help="Where to place downloaded release or custom extraction",
    )
    parser.add_argument(
        "--nginx-conf-output",
        type=Path,
        default=DEFAULT_OUTPUT_CONF,
        help=f"Output nginx conf path (default: {DEFAULT_OUTPUT_CONF})",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        deploy_frontend(
            use_release=args.use_release,
            frontend_root=args.frontend_root,
            destination=args.destination,
            nginx_conf_output=args.nginx_conf_output,
        )
        return 0
    except Exception as e:  # pragma: no cover - CLI fatal path
        _log(f"ERROR: {e}")
        return 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main(sys.argv[1:]))
