"""Blocking and asynchronous server launcher contracts."""

import asyncio
import json
import os
import socket
from pathlib import Path
from typing import Any, cast

import pytest

from ldaca_wordflow.infrastructure import process_watchdog
from ldaca_wordflow.server_launcher import (
    ServerHandle,
    __version__,
    start_async_server,
)
from ldaca_wordflow.settings import Settings


@pytest.mark.anyio
async def test_background_servers_have_independent_handles(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started: list[object] = []

    class FakeServer:
        def __init__(self, config: object) -> None:
            self.config = config
            self.should_exit = False
            self.started = False
            self.release = asyncio.Event()
            started.append(self)

        async def serve(self, *, sockets) -> None:
            assert len(sockets) == 1
            assert sockets[0].get_inheritable() is False
            self.started = True
            await self.release.wait()

    monkeypatch.setattr("ldaca_wordflow.server_launcher.uvicorn.Server", FakeServer)
    settings = Settings(multi_user=False)
    first = await start_async_server(
        serve_frontend=False,
        port=8101,
        settings=settings,
    )
    second = await start_async_server(
        serve_frontend=False,
        port=8102,
        settings=settings,
    )

    assert isinstance(first, ServerHandle)
    assert isinstance(second, ServerHandle)
    assert first is not second
    assert first.server is not second.server
    assert first.server.config.port == 8101
    assert second.server.config.port == 8102
    cast(Any, first.server).release.set()
    cast(Any, second.server).release.set()
    await first.close()
    await second.close()


@pytest.mark.anyio
async def test_async_handle_cancels_a_server_that_exceeds_shutdown_bound(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class StalledServer:
        def __init__(self, config: object) -> None:
            self.config = config
            self.should_exit = False
            self.force_exit = False
            self.started = False

        async def serve(self, *, sockets) -> None:
            assert len(sockets) == 1
            self.started = True
            await asyncio.Event().wait()

    monkeypatch.setattr("ldaca_wordflow.server_launcher.uvicorn.Server", StalledServer)
    handle = await start_async_server(
        serve_frontend=False,
        port=8105,
        settings=Settings(multi_user=False),
    )

    with pytest.raises(TimeoutError):
        await handle.close(timeout=0.01)

    assert handle.server.force_exit is True
    assert handle.task.done()


@pytest.mark.anyio
async def test_dynamic_port_is_bound_before_final_settings_and_readiness(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeServer:
        def __init__(self, config: object) -> None:
            self.config = config
            self.should_exit = False
            self.started = False
            self.release = asyncio.Event()

        async def serve(self, *, sockets) -> None:
            assert sockets[0].getsockname()[1] == cast(Any, self.config).port
            self.started = True
            await self.release.wait()

    monkeypatch.setattr("ldaca_wordflow.server_launcher.uvicorn.Server", FakeServer)
    startup_file = tmp_path / "startup.json"
    handle = await start_async_server(
        serve_frontend=False,
        port=0,
        startup_file=startup_file,
        settings=Settings(multi_user=False),
    )
    assert isinstance(handle, ServerHandle)

    record = json.loads(startup_file.read_text(encoding="utf-8"))
    assert record["status"] == "ready"
    assert record["port"] == handle.server.config.port
    assert record["port"] > 0
    if os.name != "nt":
        assert startup_file.stat().st_mode & 0o777 == 0o600

    cast(Any, handle.server).release.set()
    await handle.close()


@pytest.mark.anyio
async def test_port_zero_requires_desktop_startup_contract() -> None:
    with pytest.raises(ValueError, match="startup file"):
        await start_async_server(
            serve_frontend=False,
            port=0,
            settings=Settings(multi_user=False),
        )


@pytest.mark.anyio
async def test_bind_failure_preserves_socket_error_and_publishes_failure(
    tmp_path: Path,
) -> None:
    """Desktop startup records bind failures without masking their cause."""

    occupied = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    occupied.bind(("127.0.0.1", 0))
    occupied.listen(1)
    port = int(occupied.getsockname()[1])
    startup_file = tmp_path / "startup.json"
    try:
        with pytest.raises(OSError) as captured:
            await start_async_server(
                serve_frontend=False,
                port=port,
                startup_file=startup_file,
                settings=Settings(multi_user=False),
            )
    finally:
        occupied.close()

    assert not isinstance(captured.value, NameError)
    assert json.loads(startup_file.read_text(encoding="utf-8")) == {
        "schema_version": 1,
        "status": "failed",
        "pid": os.getpid(),
        "code": "startup_failed",
        "version": __version__,
    }
    if os.name != "nt":
        assert startup_file.stat().st_mode & 0o777 == 0o600


@pytest.mark.anyio
async def test_post_bind_validation_failure_publishes_failure(
    tmp_path: Path,
) -> None:
    startup_file = tmp_path / "startup.json"

    with pytest.raises(ValueError, match="loopback"):
        await start_async_server(
            serve_frontend=False,
            host="",
            port=0,
            startup_file=startup_file,
            settings=Settings(multi_user=False),
        )

    assert json.loads(startup_file.read_text(encoding="utf-8"))["status"] == "failed"


@pytest.mark.anyio
async def test_async_start_propagates_failure_before_readiness(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FailingServer:
        def __init__(self, config: object) -> None:
            self.config = config
            self.should_exit = False
            self.started = False

        async def serve(self, *, sockets) -> None:
            raise RuntimeError("lifespan failed")

    monkeypatch.setattr("ldaca_wordflow.server_launcher.uvicorn.Server", FailingServer)
    with pytest.raises(RuntimeError, match="lifespan failed"):
        await start_async_server(
            serve_frontend=False,
            port=8103,
            settings=Settings(multi_user=False),
        )


@pytest.mark.anyio
async def test_explicit_reverse_proxy_root_path_is_forwarded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeServer:
        def __init__(self, config: object) -> None:
            self.config = config
            self.should_exit = False
            self.started = False
            self.release = asyncio.Event()

        async def serve(self, *, sockets) -> None:
            self.started = True
            await self.release.wait()

    monkeypatch.setattr("ldaca_wordflow.server_launcher.uvicorn.Server", FakeServer)
    handle = await start_async_server(
        serve_frontend=True,
        port=3000,
        root_path="/user/example/proxy/3000",
        settings=Settings(multi_user=False),
    )
    assert handle.server.config.root_path == "/user/example/proxy/3000"
    cast(Any, handle.server).release.set()
    await handle.close()


def test_parent_watchdog_rejects_malformed_desktop_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LDACA_PARENT_PID", "not-a-pid")
    with pytest.raises(ValueError, match="positive integer"):
        process_watchdog.start_parent_watchdog()

    monkeypatch.delenv("LDACA_PARENT_PID")
    with pytest.raises(ValueError, match="interval"):
        process_watchdog.start_parent_watchdog(interval_seconds=0)
