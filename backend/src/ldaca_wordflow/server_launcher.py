"""Race-free Uvicorn launchers for hosted, notebook, and desktop profiles.

The launcher binds the listening socket before constructing immutable settings
or the FastAPI application. Desktop callers may therefore request port zero
without probing and releasing a candidate port. A private startup record is
published only after Uvicorn has completed ASGI lifespan startup.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
from dataclasses import dataclass
from pathlib import Path

import uvicorn

from .main import __version__, create_app
from .infrastructure.storage.durable_fs import atomic_output_path
from .settings import Settings, load_settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ServerHandle:
    """Caller-owned asynchronous Uvicorn server and completion task."""

    server: uvicorn.Server
    task: asyncio.Task[None]
    settings: Settings

    async def close(self, timeout: float = 10.0) -> None:
        """Request graceful shutdown and await the owned task with a bound."""

        self.server.should_exit = True
        try:
            await asyncio.wait_for(asyncio.shield(self.task), timeout=timeout)
        except TimeoutError:
            self.server.force_exit = True
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
            raise

    async def wait(self) -> None:
        """Wait until the server exits or fails."""

        await self.task


def _bind_socket(host: str, port: int, backlog: int) -> socket.socket:
    """Bind and retain the one socket Uvicorn will serve.

    Called before application construction so the
    immutable settings contain the kernel-selected port. This helper owns only
    socket setup and cleanup; the caller owns startup-record publication because
    it has the desktop control-file context.
    """

    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    listener = socket.socket(family, socket.SOCK_STREAM)
    try:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind((host, port))
        listener.listen(backlog)
        return listener
    except BaseException:
        listener.close()
        raise


def _publish_startup_failure(path: Path) -> None:
    """Publish the stable desktop failure record before re-raising startup.

    Used by both pre-Uvicorn failures and lifespan failures so the desktop
    supervisor observes one control-file contract regardless of which startup
    phase failed.
    """

    _write_startup_record(
        path,
        {
            "schema_version": 1,
            "status": "failed",
            "pid": os.getpid(),
            "code": "startup_failed",
            "version": __version__,
        },
    )


def _write_startup_record(path: Path, payload: dict[str, object]) -> None:
    """Atomically publish one mode-0600 desktop control record."""

    with atomic_output_path(path) as temporary:
        temporary.chmod(0o600)
        with temporary.open("w", encoding="utf-8") as output:
            json.dump(payload, output, separators=(",", ":"))
            output.write("\n")


async def _serve_bound(
    server: uvicorn.Server,
    listener: socket.socket,
    *,
    settings: Settings,
    startup_file: Path | None,
    liveness: asyncio.Future[None],
) -> None:
    """Run Uvicorn and publish liveness only after lifespan succeeds."""

    serve_task = asyncio.create_task(server.serve(sockets=[listener]))
    try:
        while not server.started:
            if serve_task.done():
                await serve_task
                raise RuntimeError("Uvicorn stopped before reporting liveness")
            await asyncio.sleep(0.01)

        if startup_file is not None:
            _write_startup_record(
                startup_file,
                {
                    "schema_version": 1,
                    "status": "live",
                    "pid": os.getpid(),
                    "host": settings.server_host,
                    "port": settings.backend_port,
                    "version": __version__,
                },
            )
        if not liveness.done():
            liveness.set_result(None)
        await serve_task
    except BaseException as exc:
        if startup_file is not None and not server.started:
            _publish_startup_failure(startup_file)
        if not liveness.done():
            liveness.set_exception(exc)
        if not serve_task.done():
            serve_task.cancel()
        await asyncio.gather(serve_task, return_exceptions=True)
        raise
    finally:
        listener.close()


def _prepare_server(
    *,
    serve_frontend: bool,
    port: int | None = None,
    host: str | None = None,
    root_path: str | None = None,
    settings: Settings | None = None,
    startup_file: str | Path | None = None,
) -> tuple[uvicorn.Server, socket.socket, Settings, Path | None]:
    """Bind a socket and construct one server from final immutable settings.

    Port zero is accepted only for a backend-only desktop launch with a startup
    file. Normal hosted and frontend-serving modes require an explicit stable
    port because their externally visible URL must be known before startup.
    """

    configured = settings or load_settings()
    requested_port = port if port is not None else configured.backend_port
    selected_host = configured.server_host if host is None else host
    startup_path = Path(startup_file) if startup_file is not None else None
    if startup_path is not None and startup_path.exists():
        raise ValueError("Startup file must not already exist")
    if requested_port == 0 and (serve_frontend or startup_path is None):
        raise ValueError("Port zero requires a backend-only launch with a startup file")
    if requested_port < 0 or requested_port > 65535:
        raise ValueError("Port must be between 0 and 65535")

    try:
        listener = _bind_socket(selected_host, requested_port, backlog=2048)
    except BaseException:
        if startup_path is not None:
            _publish_startup_failure(startup_path)
        raise
    actual_port = int(listener.getsockname()[1])
    try:
        current = Settings.model_validate(
            {
                **configured.model_dump(),
                "backend_port": actual_port,
                "server_host": selected_host,
            }
        )
        config = uvicorn.Config(
            create_app(current, serve_frontend=serve_frontend),
            host=current.server_host,
            port=current.backend_port,
            root_path=root_path or "",
            reload=False,
            log_level="info",
        )
        server = uvicorn.Server(config)
        return server, listener, current, startup_path
    except BaseException:
        listener.close()
        if startup_path is not None:
            _publish_startup_failure(startup_path)
        raise


async def start_async_server(
    *,
    serve_frontend: bool = True,
    port: int | None = None,
    host: str | None = None,
    root_path: str | None = None,
    settings: Settings | None = None,
    startup_file: str | Path | None = None,
) -> ServerHandle:
    """Start one server and return after its live HTTP control plane starts."""

    server, listener, current, startup_path = _prepare_server(
        serve_frontend=serve_frontend,
        port=port,
        host=host,
        root_path=root_path,
        settings=settings,
        startup_file=startup_file,
    )
    liveness = asyncio.get_running_loop().create_future()
    task = asyncio.create_task(
        _serve_bound(
            server,
            listener,
            settings=current,
            startup_file=startup_path,
            liveness=liveness,
        )
    )
    try:
        await asyncio.shield(liveness)
    except BaseException:
        await asyncio.gather(task, return_exceptions=True)
        raise
    return ServerHandle(server=server, task=task, settings=current)


def run_server(
    *,
    serve_frontend: bool = True,
    port: int | None = None,
    host: str | None = None,
    root_path: str | None = None,
    settings: Settings | None = None,
    startup_file: str | Path | None = None,
) -> None:
    """Run one server until process shutdown using the blocking CLI contract."""

    async def serve() -> None:
        handle = await start_async_server(
            serve_frontend=serve_frontend,
            port=port,
            host=host,
            root_path=root_path,
            settings=settings,
            startup_file=startup_file,
        )
        await handle.wait()

    asyncio.run(serve())


__all__ = ["ServerHandle", "run_server", "start_async_server"]
