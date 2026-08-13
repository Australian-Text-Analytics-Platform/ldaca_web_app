"""Small shared fixtures for the canonical backend test suite."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from pathlib import Path

# Match the package bootstrap before importing Polars in the test process.
os.environ["POLARS_UNKNOWN_EXTENSION_TYPE_BEHAVIOR"] = "load_as_extension"

import polars as pl
import pytest
import anyio
from fastapi.testclient import TestClient

from ldaca_wordflow.domain.workspace import Node, Workspace
from ldaca_wordflow.main import create_app
from ldaca_wordflow.runtime import Runtime, runtime_context
from ldaca_wordflow.api.security import SESSION_COOKIE_NAME
from ldaca_wordflow.services import quota as quota_module
from ldaca_wordflow.settings import Settings
from ldaca_wordflow.workers.input_snapshots import create_worker_input_snapshot


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def finite_quota_test_filesystem(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Emulate allocation metrics only on hosts that intentionally lack them."""

    metadata = tmp_path.stat()
    if hasattr(os, "statvfs") and hasattr(metadata, "st_blocks"):
        return

    allocation_unit = 4096
    monkeypatch.setattr(
        quota_module,
        "_probe_allocation_unit",
        lambda _root: allocation_unit,
    )
    monkeypatch.setattr(
        quota_module,
        "_entry_allocated_bytes",
        lambda entry, unit: max(
            ((entry.st_size + unit - 1) // unit) * unit,
            unit,
        ),
    )


@pytest.fixture
def files_test_client(tmp_path: Path):
    """Run the real lifespan with an isolated single-user file root and CSRF."""

    app = create_app(
        Settings(
            data_root=tmp_path,
            multi_user=False,
            session_cookie_secure=False,
            cors_allowed_origins=("http://testserver",),
            trusted_hosts=("testserver",),
        ),
        serve_frontend=False,
    )
    with TestClient(app, base_url="http://testserver") as client:
        csrf = client.get("/api/session").json()["csrf_token"]
        client.headers.update(
            {
                "Origin": "http://testserver",
                "X-CSRF-Token": csrf,
            }
        )
        yield client


@pytest.fixture
def multi_user_test_client(
    tmp_path: Path,
    finite_quota_test_filesystem: None,
) -> Iterator[TestClient]:
    """Run an authenticated hosted session without an external OAuth round trip."""

    settings = Settings(
        data_root=tmp_path,
        multi_user=True,
        google_client_id="google-client",
        cors_allowed_origins=(),
        trusted_hosts=("wordflow.example",),
    )
    captured: dict[str, Runtime] = {}

    @asynccontextmanager
    async def capture_runtime(_settings: Settings) -> AsyncIterator[Runtime]:
        async with runtime_context(_settings) as runtime:
            captured["runtime"] = runtime
            yield runtime

    app = create_app(settings, capture_runtime, serve_frontend=False)
    with TestClient(app, base_url="https://wordflow.example") as client:
        runtime = captured["runtime"]

        async def issue_session():
            user = await runtime.session_service.upsert_oidc_user(
                issuer="https://accounts.google.com",
                subject="fixture-user",
                email="fixture@example.test",
                name="Fixture User",
                picture=None,
                email_verified=True,
            )
            return await runtime.session_service.issue(user)

        issued = anyio.run(issue_session)
        client.cookies.set(SESSION_COOKIE_NAME, issued.session_token)
        client.headers.update(
            {
                "Origin": "https://wordflow.example",
                "X-CSRF-Token": issued.csrf_token,
            }
        )
        assert client.get("/api/session").json()["authenticated"] is True
        yield client


@pytest.fixture
def worker_snapshot(tmp_path: Path):
    """Create one canonical task-input snapshot from in-memory test columns."""

    def create(*, node_id: str, columns: dict[str, list[object]]) -> Path:
        workspace = Workspace(name="Worker fixture", workspace_id="fixture")
        workspace.add_node(
            Node(
                data=pl.DataFrame(columns).lazy(),
                name="Source",
                id=node_id,
                document="document" if "document" in columns else None,
            )
        )
        return create_worker_input_snapshot(
            workspace_id=workspace.id,
            node_ids=[node_id],
            workspace=workspace,
            workspace_data_dir=tmp_path,
            snapshot_dir=tmp_path / f"snapshot-{node_id}",
            max_snapshot_bytes=1024 * 1024,
        )

    return create
