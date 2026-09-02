"""HTTP contract for current-principal quota and host storage failures."""

from __future__ import annotations

import sqlite3
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import partial
from pathlib import Path

import anyio
from fastapi.testclient import TestClient

from ldaca_wordflow.infrastructure.storage.layout import deployment_database_path
from ldaca_wordflow.main import create_app
from ldaca_wordflow.runtime import Runtime, runtime_context
from ldaca_wordflow.settings import Settings


def _settings(
    tmp_path: Path,
    *,
    multi_user: bool = False,
    min_free_disk_bytes: int = 0,
    max_user_file_tree_response_bytes: int = 8 * 1024 * 1024,
) -> Settings:
    return Settings(
        data_root=tmp_path,
        multi_user=multi_user,
        min_free_disk_bytes=min_free_disk_bytes,
        max_user_file_tree_response_bytes=max_user_file_tree_response_bytes,
        session_cookie_secure=multi_user,
        cors_allowed_origins=(
            ("https://wordflow.example",) if multi_user else ("http://testserver",)
        ),
        trusted_hosts=("wordflow.example",) if multi_user else ("testserver",),
        google_client_id="google-client" if multi_user else "",
    )


def _set_quota(settings: Settings, user_id: str, value: int | None) -> None:
    with sqlite3.connect(deployment_database_path(settings)) as connection:
        connection.execute(
            "UPDATE users SET storage_quota_bytes = ? WHERE id = ?",
            (value, user_id),
        )


def test_single_user_storage_resource_is_database_free_and_unlimited(
    tmp_path: Path,
) -> None:
    settings = _settings(tmp_path)
    app = create_app(settings, serve_frontend=False)
    with TestClient(app, base_url="http://testserver") as client:
        response = client.get("/api/storage")

    assert response.status_code == 200
    assert response.json() == {"policy": "unlimited"}
    assert "no-store" in response.headers["cache-control"]
    assert not deployment_database_path(settings).exists()


def test_hosted_storage_resource_is_fresh_strict_and_no_store(
    tmp_path: Path,
    finite_quota_test_filesystem: None,
) -> None:
    settings = _settings(tmp_path, multi_user=True)
    captured: dict[str, Runtime] = {}

    @asynccontextmanager
    async def capture_runtime(_settings: Settings) -> AsyncIterator[Runtime]:
        async with runtime_context(_settings) as runtime:
            captured["runtime"] = runtime
            yield runtime

    app = create_app(settings, capture_runtime, serve_frontend=False)
    with TestClient(app, base_url="https://wordflow.example") as client:
        runtime = captured["runtime"]
        user = anyio.run(
            partial(
                runtime.session_service.upsert_oidc_user,
                issuer="https://accounts.google.com",
                subject="storage-user",
                email="storage@example.test",
                name="Storage User",
                picture=None,
            )
        )
        issued = anyio.run(runtime.session_service.issue, user)
        client.cookies.set("wordflow_session", issued.session_token)

        _set_quota(settings, user.id, None)
        unlimited = client.get("/api/storage")
        assert unlimited.status_code == 200
        assert unlimited.json() == {"policy": "unlimited"}
        assert "no-store" in unlimited.headers["cache-control"]

        _set_quota(settings, user.id, 1_000_000)
        finite = client.get("/api/storage")
        assert finite.status_code == 200
        payload = finite.json()
        assert payload["policy"] == "quota"
        assert set(payload) == {
            "policy",
            "limit_bytes",
            "used_bytes",
            "reserved_bytes",
            "available_bytes",
        }
        assert payload["limit_bytes"] == 1_000_000
        assert payload["reserved_bytes"] == 0
        assert payload["available_bytes"] == max(
            0,
            payload["limit_bytes"] - payload["used_bytes"],
        )

        _set_quota(settings, user.id, 1)
        rejected = client.post(
            "/api/user-files/folders",
            json={"name": "blocked", "parent_path": ""},
            headers={
                "Origin": "https://wordflow.example",
                "X-CSRF-Token": issued.csrf_token,
            },
        )
        assert rejected.status_code == 507
        error = rejected.json()
        assert error["code"] == "storage_quota_exceeded"
        assert set(error["details"]) == {
            "limit_bytes",
            "used_bytes",
            "reserved_bytes",
            "requested_growth_bytes",
        }
        assert error["details"]["limit_bytes"] == 1
        assert error["details"]["reserved_bytes"] == 0
        assert error["details"]["requested_growth_bytes"] > 0


def test_physical_capacity_error_conceals_host_details(tmp_path: Path) -> None:
    settings = _settings(tmp_path, min_free_disk_bytes=10**30)
    app = create_app(settings, serve_frontend=False)
    with TestClient(app, base_url="http://testserver") as client:
        session = client.get("/api/session").json()
        rejected = client.post(
            "/api/workspaces",
            json={"name": "No capacity"},
            headers={
                "Origin": "http://testserver",
                "X-CSRF-Token": session["csrf_token"],
            },
        )

    assert rejected.status_code == 507
    error = rejected.json()
    assert error["code"] == "storage_capacity_exceeded"
    assert "details" not in error


def test_user_file_tree_is_one_complete_direct_collection(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    app = create_app(settings, serve_frontend=False)
    with TestClient(app, base_url="http://testserver") as client:
        session = client.get("/api/session").json()
        unsafe_headers = {
            "Origin": "http://testserver",
            "X-CSRF-Token": session["csrf_token"],
        }
        assert client.post(
            "/api/user-files/folders",
            json={"name": "parent", "parent_path": ""},
            headers=unsafe_headers,
        ).status_code == 201
        assert client.post(
            "/api/user-files/folders",
            json={"name": "empty", "parent_path": "parent"},
            headers=unsafe_headers,
        ).status_code == 201
        assert client.post(
            "/api/user-files/uploads?path=parent/data.csv",
            content=b"value\n1",
            headers={**unsafe_headers, "Content-Type": "application/octet-stream"},
        ).status_code == 201

        response = client.get("/api/user-files")

    assert response.status_code == 200
    assert [item["path"] for item in response.json()] == [
        "parent",
        "parent/empty",
        "parent/data.csv",
    ]


def test_user_file_tree_limit_is_an_atomic_typed_error(tmp_path: Path) -> None:
    settings = _settings(tmp_path, max_user_file_tree_response_bytes=2)
    app = create_app(settings, serve_frontend=False)
    with TestClient(app, base_url="http://testserver") as client:
        session = client.get("/api/session").json()
        created = client.post(
            "/api/user-files/folders",
            json={"name": "visible", "parent_path": ""},
            headers={
                "Origin": "http://testserver",
                "X-CSRF-Token": session["csrf_token"],
            },
        )
        assert created.status_code == 201

        response = client.get("/api/user-files")

    assert response.status_code == 413
    assert response.json()["code"] == "user_file_tree_too_large"
