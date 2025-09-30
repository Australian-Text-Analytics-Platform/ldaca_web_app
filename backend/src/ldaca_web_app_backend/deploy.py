# In-thread async FastAPI dev server (non-blocking) - Port 8001
import asyncio
import os
import subprocess
from pathlib import Path

import uvicorn
from IPython.display import Javascript, Markdown, display

from .config import PACKAGE_ROOT, settings
from .main import app

# Add Colab detection
try:
    from google.colab import output

    ON_COLAB = True
except ImportError:
    ON_COLAB = False

import tarfile
import tempfile

import requests

_server: uvicorn.Server | None = None
_server_task: asyncio.Task | None = None


def start_backend(port=8001):
    global _server, _server_task
    if _server and getattr(_server, "started", False):
        print(f"Server already running at http://localhost:{port}")
        return _server
    config = uvicorn.Config(
        app,
        host="localhost",
        port=port,
        reload=False,  # in-loop reload unsupported; use reload_app()+restart_server
        log_level="info",
        # timeout_keep_alive=30,
        # lifespan="on",
    )
    _server = uvicorn.Server(config)
    loop = asyncio.get_running_loop()
    _server_task = loop.create_task(_server.serve())
    return _server_task


def start_frontend(
    port=3000, platform=None, download_release=False, frontend_dir=None, build_dir=None
):
    url = f"http://localhost:{port}"
    NGINX_DIR = Path("~/nginx").expanduser()
    NGINX_DIR.mkdir(parents=True, exist_ok=True)
    (NGINX_DIR / "logs").mkdir(parents=True, exist_ok=True)
    (NGINX_DIR / "tmp").mkdir(parents=True, exist_ok=True)
    (NGINX_DIR / "run").mkdir(parents=True, exist_ok=True)

    if download_release:
        DIST_DIR = tempfile.mkdtemp(prefix="ldaca_frontend_build_")
        os.makedirs(DIST_DIR, exist_ok=True)
        FRONTEND_RELEASE_URL = "https://github.com/Australian-Text-Analytics-Platform/ldaca_web_app/releases/download/frontend-latest/frontend-build.tar.gz"

        response = requests.get(FRONTEND_RELEASE_URL)
        response.raise_for_status()  # Raise error for bad status codes
        with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as temp_file:
            temp_file.write(response.content)
            temp_file_path = temp_file.name

        print(f"Extracting frontend to {DIST_DIR}")
        with tarfile.open(temp_file_path, "r:gz") as tar:
            tar.extractall(path=DIST_DIR)
    else:
        if frontend_dir is None and build_dir is None:
            raise ValueError(
                "frontend_dir or build_dir must be specified if download_release is False"
            )
        if frontend_dir is not None:
            DIST_DIR = Path(frontend_dir) / "build"
            DIST_DIR = DIST_DIR.absolute()
            subprocess.run(
                f"cd {frontend_dir} && npm install > /dev/null 2>&1 && npm run build > /dev/null 2>&1",
                check=True,
                shell=True,
            )
        if build_dir is not None:
            DIST_DIR = Path(build_dir).absolute()

    NGINX_CONF_TEMPLATE = PACKAGE_ROOT / "configs" / "nginx.conf.template"

    subprocess.run(
        f"FRONTEND_DIR={DIST_DIR} FRONTEND_PORT={port} BACKEND_PORT={settings.backend_port} envsubst '$FRONTEND_DIR $FRONTEND_PORT $BACKEND_PORT' < {NGINX_CONF_TEMPLATE} > {NGINX_DIR / 'nginx.conf'}",
        check=True,
        shell=True,
    )
    print(f"Using nginx config file: {NGINX_DIR / 'nginx.conf'}")
    proc = subprocess.Popen(
        f"nginx -p {NGINX_DIR} -c 'nginx.conf' -g 'daemon off;'", shell=True
    )

    if ON_COLAB:
        output.serve_kernel_port_as_window(port)
    else:
        base = os.environ["JUPYTERHUB_SERVICE_PREFIX"]
        if base and not base.endswith("/"):
            base += "/"

        url = f"{base}proxy/{3000}/"
        display(Javascript(f"window.open('{url}', '_blank');"))
        display(
            Markdown(
                f"Click the following link to open the web app:\n# [Open web app]({url})"
            )
        )
    return proc
