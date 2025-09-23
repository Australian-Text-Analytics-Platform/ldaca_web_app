# In-thread async FastAPI dev server (non-blocking) - Port 8001
import asyncio
import os
import subprocess

import uvicorn

from .config import PROJECT_ROOT, settings

# Import app directly from main (same directory)
from .main import app  # assumes `app` is FastAPI instance

# # Apply nest_asyncio to allow nested event loops
# nest_asyncio.apply()

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


def start_frontend(port=3000, platform=None, use_latest=False):
    url = f"http://localhost:{port}"
    DIST_DIR = tempfile.mkdtemp(prefix="ldaca_frontend_build_")
    os.makedirs(DIST_DIR, exist_ok=True)

    if use_latest:
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
        FRONTEND_ROOT = PROJECT_ROOT / ".." / "frontend"

        subprocess.run(
            f"cd {FRONTEND_ROOT} && BUILD_PATH={DIST_DIR} npm install && npm run build",
            check=True,
            shell=True,
        )

    NGINX_CONF_TEMPLATE = PROJECT_ROOT / "configs" / "nginx.conf.template"
    NGINX_OUTPUT_CONF = tempfile.NamedTemporaryFile(suffix=".conf", delete=False).name

    subprocess.run(
        f"FRONTEND_DIR={DIST_DIR} FRONTEND_PORT={port} BACKEND_PORT={settings.backend_port} envsubst '$FRONTEND_DIR $FRONTEND_PORT $BACKEND_PORT' < {NGINX_CONF_TEMPLATE} > {NGINX_OUTPUT_CONF}",
        check=True,
        shell=True,
    )
    print(f"Using nginx config file: {NGINX_OUTPUT_CONF}")
    subprocess.run(f"nginx -s reload -c {NGINX_OUTPUT_CONF}", check=False, shell=True)

    if ON_COLAB:
        output.serve_kernel_port_as_window(port)
    else:
        import IPython.display as display
        from IPython.display import Javascript, Markdown

        base = os.environ["JUPYTERHUB_SERVICE_PREFIX"]
        if base and not base.endswith("/"):
            base += "/"

        url = f"{base}proxy/{3000}/"
        display(Markdown(f"If popup was blocked, click: [Open web app]({url})"))
