# In-thread async FastAPI dev server (non-blocking) - Port 8001
import asyncio
import os
import shlex
import shutil
import signal
import subprocess
from importlib import import_module, resources
from pathlib import Path
from typing import Any

import uvicorn

from .main import app
from .settings import settings

# Add Colab detection
try:
    output: Any = import_module("google.colab.output")
    ON_COLAB = True
except ImportError:
    output = None
    ON_COLAB = False

# Optional IPython dependencies for Jupyter/Colab deployment
try:
    from IPython.display import Javascript, Markdown, display

    IPYTHON_AVAILABLE = True
except ImportError:
    IPYTHON_AVAILABLE = False
    # Define no-op placeholders if IPython is not available
    Javascript: Any = None
    Markdown: Any = None

    def display(x):
        """No-op placeholder when IPython is not available."""
        pass


_server: uvicorn.Server | None = None
_server_task: asyncio.Task | None = None
_nginx_proc: subprocess.Popen | None = None


def _clear_backend_state(_task: asyncio.Task | None = None) -> None:
    """Reset cached backend state after the server task finishes."""
    global _server, _server_task
    _server = None
    _server_task = None


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


def _validate_frontend_build(build_dir: str | os.PathLike[str]) -> Path:
    """Return a prebuilt frontend directory after a minimal sanity check."""
    resolved_build_dir = Path(build_dir).resolve()
    index_path = resolved_build_dir / "index.html"
    if not index_path.exists():
        raise FileNotFoundError(
            f"build_dir must contain a prebuilt index.html: {index_path}"
        )
    return resolved_build_dir


def _cleanup_nginx_runtime(nginx_dir: Path) -> None:
    """Stop any prior nginx process and clear stale runtime files."""
    global _nginx_proc

    if _nginx_proc is not None:
        try:
            if _nginx_proc.poll() is None:
                _nginx_proc.terminate()
                _nginx_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _nginx_proc.kill()
            _nginx_proc.wait(timeout=5)
        except OSError:
            pass
        _nginx_proc = None

    config_path = nginx_dir / "nginx.conf"
    if config_path.exists():
        subprocess.run(
            f"nginx -p {shlex.quote(str(nginx_dir))} -c nginx.conf -s quit",
            check=False,
            shell=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    pid_path = nginx_dir / "run" / "nginx.pid"
    if pid_path.exists():
        try:
            os.kill(int(pid_path.read_text(encoding="utf-8").strip()), signal.SIGTERM)
        except ValueError, OSError:
            pass
        pid_path.unlink(missing_ok=True)

    for runtime_dir in ("logs", "tmp", "run"):
        shutil.rmtree(nginx_dir / runtime_dir, ignore_errors=True)


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
    if _server_task is not None:
        if _server_task.done():
            _clear_backend_state()
        else:
            print(f"Server already running at http://localhost:{settings.backend_port}")
            return _server_task

    if _server and getattr(_server, "started", False):
        print(f"Server already running at http://localhost:{settings.backend_port}")
        return _server_task
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
    _server_task.add_done_callback(_clear_backend_state)
    return _server_task


def start_frontend(
    port: int = 3000,
    build_dir: str | os.PathLike[str] | None = None,
):
    """Start the frontend server with nginx.

    Note: This function is designed for Jupyter/Colab environments.
    To use IPython display features, install optional dependencies:
        pip install ldaca-web-app-backend[deploy]
    """
    global _nginx_proc

    if not IPYTHON_AVAILABLE and not ON_COLAB:
        print("Warning: IPython not available. Display features will be limited.")
        print(
            "To enable full Jupyter integration, install: pip install ldaca-web-app-backend[deploy]"
        )
    if build_dir is None:
        raise ValueError("build_dir must be provided explicitly")

    NGINX_DIR = Path("~/nginx").expanduser()
    _cleanup_nginx_runtime(NGINX_DIR)
    NGINX_DIR.mkdir(parents=True, exist_ok=True)
    (NGINX_DIR / "logs").mkdir(parents=True, exist_ok=True)
    (NGINX_DIR / "tmp").mkdir(parents=True, exist_ok=True)
    (NGINX_DIR / "run").mkdir(parents=True, exist_ok=True)
    DIST_DIR = _validate_frontend_build(build_dir)
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
    _nginx_proc = subprocess.Popen(
        f"nginx -p {shlex.quote(str(NGINX_DIR))} -c nginx.conf -g 'daemon off;'",
        shell=True,
    )

    if ON_COLAB:
        assert output is not None
        output.serve_kernel_port_as_window(port)
    else:
        base = os.environ.get("JUPYTERHUB_SERVICE_PREFIX", "")
        if base:
            if not base.endswith("/"):
                base += "/"
            url = f"{base}proxy/{port}/"
        else:
            url = f"http://localhost:{port}/"

        if IPYTHON_AVAILABLE:
            assert Javascript is not None
            assert Markdown is not None
            display(Javascript(f"window.open('{url}', '_blank');"))
            display(
                Markdown(
                    f"Click the following link to open the web app:\n# [Open web app]({url})"
                )
            )
        else:
            print(f"Open web app: {url}")
    return _nginx_proc
