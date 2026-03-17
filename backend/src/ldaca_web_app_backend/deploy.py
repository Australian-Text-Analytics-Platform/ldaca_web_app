# In-thread async FastAPI dev server (non-blocking) - Port 8001
import asyncio
import os
import shlex
import shutil
import subprocess
from importlib import resources
from pathlib import Path

import uvicorn

from .main import app
from .settings import settings

# Add Colab detection
try:
    from google.colab import output

    ON_COLAB = True
except ImportError:
    ON_COLAB = False

# Optional IPython dependencies for Jupyter/Colab deployment
try:
    from IPython.display import Javascript, Markdown, display

    IPYTHON_AVAILABLE = True
except ImportError:
    IPYTHON_AVAILABLE = False
    # Define no-op placeholders if IPython is not available
    Javascript = None
    Markdown = None

    def display(x):
        """No-op placeholder when IPython is not available."""
        pass


_server: uvicorn.Server | None = None
_server_task: asyncio.Task | None = None


def _resolve_nginx_mime_types_path() -> Path:
    """Return the best available nginx mime.types path for the local install."""
    candidate_paths = [
        Path("/opt/homebrew/etc/nginx/mime.types"),
        Path("/usr/local/etc/nginx/mime.types"),
        Path("/etc/nginx/mime.types"),
    ]
    for candidate_path in candidate_paths:
        if candidate_path.exists():
            return candidate_path

    nginx_binary = shutil.which("nginx")
    if nginx_binary is not None:
        nginx_prefix = Path(nginx_binary).resolve().parents[2]
        inferred_path = nginx_prefix / "etc" / "nginx" / "mime.types"
        if inferred_path.exists():
            return inferred_path

    raise FileNotFoundError("Unable to locate nginx mime.types")


def _build_frontend(
    frontend_dir: str | os.PathLike[str],
    build_dir: str | os.PathLike[str],
) -> Path:
    """Install dependencies and build the frontend, returning the build path."""
    resolved_frontend_dir = Path(frontend_dir).resolve()
    resolved_build_dir = Path(build_dir).resolve()
    resolved_build_dir.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        "cd {frontend_dir} && npm install > /dev/null 2>&1 && "
        "npm run build -- --outDir {build_dir} > /dev/null 2>&1".format(
            frontend_dir=shlex.quote(str(resolved_frontend_dir)),
            build_dir=shlex.quote(str(resolved_build_dir)),
        ),
        check=True,
        shell=True,
    )
    return resolved_build_dir


def start_backend(port: int = 8001):
    """Start backend FastAPI server in current event loop as background task.

    Used by:
    - notebook/Colab deployment workflows

    Why:
    - Allows non-blocking backend startup for interactive environments.

    Refactor note:
    - Stores process-wide mutable globals (`_server`, `_server_task`); consider
        encapsulating state in a small service object for multi-session safety.
    """
    global _server, _server_task
    if _server and getattr(_server, "started", False):
        print(f"Server already running at http://localhost:{settings.backend_port}")
        return _server
    settings.backend_port = port
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
    port: int = 3000,
    frontend_dir: str | os.PathLike[str] | None = None,
    build_dir: str | os.PathLike[str] | None = None,
):
    """Start the frontend server with nginx.

    Note: This function is designed for Jupyter/Colab environments.
    To use IPython display features, install optional dependencies:
        pip install ldaca-web-app-backend[deploy]
    """
    # Used by: notebook/Colab launch flows that pair frontend proxy with backend.
    # Why: provides one helper to build/fetch frontend assets and expose them.
    # Refactor note: function is long and mixes download/build/nginx/proxy logic;
    # split into smaller helpers for readability and testing.
    if not IPYTHON_AVAILABLE and not ON_COLAB:
        print("Warning: IPython not available. Display features will be limited.")
        print(
            "To enable full Jupyter integration, install: pip install ldaca-web-app-backend[deploy]"
        )
    if frontend_dir is None:
        raise ValueError("frontend_dir must be provided explicitly")
    if build_dir is None:
        raise ValueError("build_dir must be provided explicitly")

    NGINX_DIR = Path("~/nginx").expanduser()
    NGINX_DIR.mkdir(parents=True, exist_ok=True)
    (NGINX_DIR / "logs").mkdir(parents=True, exist_ok=True)
    (NGINX_DIR / "tmp").mkdir(parents=True, exist_ok=True)
    (NGINX_DIR / "run").mkdir(parents=True, exist_ok=True)
    DIST_DIR = _build_frontend(frontend_dir, build_dir)
    mime_types_path = _resolve_nginx_mime_types_path()

    nginx_template = resources.files("ldaca_web_app_backend.resources").joinpath(
        "configs/nginx.conf.template"
    )
    with resources.as_file(nginx_template) as nginx_conf_template:
        subprocess.run(
            "FRONTEND_DIR={frontend_dir} FRONTEND_PORT={frontend_port} "
            "BACKEND_PORT={backend_port} MIME_TYPES_PATH={mime_types_path} "
            "envsubst '$FRONTEND_DIR $FRONTEND_PORT $BACKEND_PORT "
            "$MIME_TYPES_PATH' < {template_path} > {config_path}".format(
                frontend_dir=shlex.quote(str(DIST_DIR)),
                frontend_port=port,
                backend_port=settings.backend_port,
                mime_types_path=shlex.quote(str(mime_types_path)),
                template_path=shlex.quote(str(nginx_conf_template)),
                config_path=shlex.quote(str(NGINX_DIR / "nginx.conf")),
            ),
            check=True,
            shell=True,
        )
    print(f"Using nginx config file: {NGINX_DIR / 'nginx.conf'}")
    proc = subprocess.Popen(
        f"nginx -p {shlex.quote(str(NGINX_DIR))} -c nginx.conf -g 'daemon off;'",
        shell=True,
    )

    if ON_COLAB:
        output.serve_kernel_port_as_window(port)
    else:
        base = os.environ.get("JUPYTERHUB_SERVICE_PREFIX", "")
        if base:
            if not base.endswith("/"):
                base += "/"
            url = f"{base}proxy/{port}/"
        else:
            url = f"http://localhost:{port}/"

        display(Javascript(f"window.open('{url}', '_blank');"))
        display(
            Markdown(
                f"Click the following link to open the web app:\n# [Open web app]({url})"
            )
        )
    return proc
