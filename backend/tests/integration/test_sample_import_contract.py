"""Canonical retained sample User File Import contract."""

from __future__ import annotations

import hashlib
import time
from pathlib import Path
from typing import Any

import httpx
from fastapi.testclient import TestClient
from pytest import MonkeyPatch

from ldaca_wordflow.main import create_app
from ldaca_wordflow.services import sample_data as sample_data_module
from ldaca_wordflow.settings import Settings

_README = b"# Remote sample\n"
_CATALOGUE = {
    "schema_version": 1,
    "collections": [
        {
            "id": "ADO/twitter",
            "name": "ADO Twitter",
            "description": "Remote test collection",
            "language": "en",
            "bundled": True,
            "total_size_bytes": len(_README),
            "recommended_for": ["data-loader"],
            "files": [
                {
                    "path": "ADO/twitter/README.md",
                    "size": len(_README),
                    "sha256": hashlib.sha256(_README).hexdigest(),
                }
            ],
        },
        {
            "id": "SCL",
            "name": "SCL",
            "description": "Another remote collection",
            "language": "en",
            "bundled": False,
            "total_size_bytes": 0,
            "recommended_for": [],
            "files": [],
        },
    ],
}


def _install_remote_sample_transport(monkeypatch: MonkeyPatch) -> None:
    real_async_client = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/catalogue.json"):
            return httpx.Response(200, json=_CATALOGUE)
        if request.url.path.endswith("/ADO/twitter/README.md"):
            return httpx.Response(200, content=_README)
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)

    def client_factory(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        return real_async_client(*args, transport=transport, **kwargs)

    monkeypatch.setattr(sample_data_module.httpx, "AsyncClient", client_factory)


def test_sample_collection_is_atomically_installed_by_a_retained_import(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
) -> None:
    _install_remote_sample_transport(monkeypatch)
    settings = Settings(
        data_root=tmp_path / "data-root",
        multi_user=False,
        session_cookie_secure=False,
        cors_allowed_origins=("http://testserver",),
        trusted_hosts=("testserver",),
    )
    with TestClient(
        create_app(settings, serve_frontend=False),
        base_url="http://testserver",
    ) as client:
        csrf = client.get("/api/session").json()["csrf_token"]
        unsafe = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
        listed = client.get("/api/sample-collections")
        assert listed.status_code == 200
        collections = listed.json()["collections"]
        assert {item["id"] for item in collections} == {"ADO/twitter", "SCL"}
        assert all(item["installed"] is False for item in collections)
        assert all("bundled" not in item for item in collections)
        assert all(
            "sha256" not in file
            for collection in collections
            for file in collection["files"]
        )

        accepted = client.post(
            "/api/sample-collections/ADO%2Ftwitter/imports",
            headers=unsafe,
        )
        assert accepted.status_code == 202
        assert accepted.headers["location"] == (
            f"/api/user-file-imports/{accepted.json()['id']}"
        )
        deadline = time.monotonic() + 10
        while True:
            resource = client.get(accepted.headers["location"]).json()
            if resource["state"] in {"succeeded", "failed", "cancelled"}:
                break
            assert time.monotonic() < deadline
            time.sleep(0.02)
        assert resource["state"] == "succeeded", resource
        assert resource["request"] == {
            "kind": "sample",
            "collection_id": "ADO/twitter",
        }

        content = client.get(
            "/api/user-files/content",
            params={"path": "sample_data/ADO/twitter/README.md"},
        )
        assert content.status_code == 200
        assert content.content.startswith(b"#")
        relisted = client.get("/api/sample-collections")
        installed = {
            item["id"]: item["installed"]
            for item in relisted.json()["collections"]
        }
        assert installed == {"ADO/twitter": True, "SCL": False}

        duplicate = client.post(
            "/api/sample-collections/ADO%2Ftwitter/imports",
            headers=unsafe,
        )
        assert duplicate.status_code == 409
