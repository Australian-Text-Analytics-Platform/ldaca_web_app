"""Canonical Data Portal read and retained import contracts."""

from __future__ import annotations

import time
from pathlib import Path

from fastapi.testclient import TestClient
from ldaca_wordflow.domain import DataPortalUserFileImportResult
from ldaca_wordflow.domain.background import Progress
from ldaca_wordflow.infrastructure.providers.oni import OniClient
from ldaca_wordflow.main import create_app
from ldaca_wordflow.services.data_portal import (
    DataPortalImportExecution,
    DataPortalService,
)
from ldaca_wordflow.services.user_file_import_execution_types import (
    UserFileImportKey,
)
from ldaca_wordflow.services.user_file_import_executor import (
    UserFileImportProcessExecutor,
)
from ldaca_wordflow.settings import Settings


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        data_root=tmp_path,
        multi_user=False,
        session_cookie_secure=False,
        cors_allowed_origins=("http://testserver",),
        trusted_hosts=("testserver",),
    )


def test_single_user_portal_search_uses_one_based_paging_and_backend_token(
    tmp_path: Path,
    monkeypatch,
) -> None:
    captured: dict[str, object] = {}

    async def fake_search(self, *, method, query, limit, offset):
        captured.update(
            token=self.token,
            method=method.value,
            query=query,
            limit=limit,
            offset=offset,
        )
        return (
            [
                {
                    "id": "arcp://name,example",
                    "crate_id": "arcp://name,example",
                    "title": "Example corpus",
                    "description": None,
                    "types": ["Dataset"],
                    "license": None,
                    "importable": True,
                    "access": [],
                    "collections": [],
                    "file_formats": ["text/plain"],
                }
            ],
            41,
        )

    monkeypatch.setattr(OniClient, "search", fake_search)
    with TestClient(
        create_app(_settings(tmp_path), serve_frontend=False),
        base_url="http://testserver",
    ) as client:
        csrf = client.get("/api/session").json()["csrf_token"]
        unsafe = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
        credentials = client.patch(
            "/api/provider-credentials",
            json={"data_portal_api_token": "portal-secret"},
            headers=unsafe,
        )
        assert credentials.status_code == 200, credentials.text
        supplied = client.post(
            "/api/data-portal/search",
            json={"api_token": "request-secret"},
            headers=unsafe,
        )
        assert supplied.status_code == 400
        assert supplied.json()["code"] == "invalid_input"
        response = client.post(
            "/api/data-portal/search",
            json={
                "method": "keyword",
                "query": "conversation",
                "page": 3,
                "page_size": 20,
            },
            headers=unsafe,
        )
        assert response.status_code == 200
        assert response.json()["page"] == 3
        assert response.json()["total"] == 41
        assert captured == {
            "token": "portal-secret",
            "method": "keyword",
            "query": "conversation",
            "limit": 20,
            "offset": 40,
        }


def test_multi_user_portal_reads_use_request_token_only(
    multi_user_test_client: TestClient,
    tmp_path: Path,
    monkeypatch,
) -> None:
    captured: list[str | None] = []

    async def fake_search(self, *, method, query, limit, offset):
        del method, query, limit, offset
        captured.append(self.token)
        return [], 0

    async def fake_featured(self, identifiers):
        del identifiers
        captured.append(self.token)
        return []

    monkeypatch.setattr(OniClient, "search", fake_search)
    monkeypatch.setattr(OniClient, "featured_collections", fake_featured)

    search = multi_user_test_client.post(
        "/api/data-portal/search",
        json={"api_token": "browser-portal-secret"},
    )
    featured = multi_user_test_client.post(
        "/api/data-portal/featured",
        json={"api_token": "browser-portal-secret"},
    )

    assert search.status_code == 200, search.text
    assert featured.status_code == 200, featured.text
    assert captured == ["browser-portal-secret", "browser-portal-secret"]
    assert multi_user_test_client.get("/api/data-portal/featured").status_code == 405
    assert all(
        b"browser-portal-secret" not in path.read_bytes()
        for path in tmp_path.rglob("*")
        if path.is_file()
    )


def test_portal_import_token_is_not_persisted_and_publish_is_atomic(
    tmp_path: Path,
    monkeypatch,
) -> None:
    async def fake_execute(
        self: DataPortalService,
        key: UserFileImportKey,
        execution: DataPortalImportExecution,
        executor: UserFileImportProcessExecutor,
        report_progress,
    ) -> DataPortalUserFileImportResult:
        del self, key, executor
        assert execution.input.api_token == "portal-secret"
        await report_progress(Progress(fraction=0.5, message="Importing"))
        staging = Path(execution.input.staging_dir)
        (staging / "corpus.parquet").write_bytes(b"parquet")
        (staging / "README.md").write_text("# Corpus\n")
        return DataPortalUserFileImportResult(
            destination_path="LDaCA/corpus",
            file_count=2,
            bytes_written=16,
        )

    monkeypatch.setattr(DataPortalService, "execute_import", fake_execute)
    with TestClient(
        create_app(_settings(tmp_path), serve_frontend=False),
        base_url="http://testserver",
    ) as client:
        csrf = client.get("/api/session").json()["csrf_token"]
        unsafe = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
        credentials = client.patch(
            "/api/provider-credentials",
            json={"data_portal_api_token": "portal-secret"},
            headers=unsafe,
        )
        assert credentials.status_code == 200, credentials.text
        accepted = client.post(
            "/api/data-portal/imports",
            json={
                "identifier": "arcp://name,example",
                "name": "Corpus",
            },
            headers=unsafe,
        )
        assert accepted.status_code == 202
        import_id = accepted.json()["id"]
        assert accepted.headers["location"] == (
            f"/api/user-file-imports/{import_id}"
        )
        deadline = time.monotonic() + 10
        while True:
            resource = client.get(accepted.headers["location"]).json()
            if resource["state"] in {"succeeded", "failed", "cancelled"}:
                break
            assert time.monotonic() < deadline
            time.sleep(0.02)
        assert resource["state"] == "succeeded", resource
        assert "portal-secret" not in str(resource)
        persisted = tmp_path / "users" / "root" / "imports" / f"{import_id}.json"
        assert b"portal-secret" not in persisted.read_bytes()

        content = client.get(
            "/api/user-files/content",
            params={"path": "LDaCA/corpus/corpus.parquet"},
        )
        assert content.status_code == 200
        assert content.content == b"parquet"


def test_multi_user_portal_import_token_is_execution_only(
    multi_user_test_client: TestClient,
    tmp_path: Path,
    monkeypatch,
) -> None:
    async def fake_execute(
        self: DataPortalService,
        key: UserFileImportKey,
        execution: DataPortalImportExecution,
        executor: UserFileImportProcessExecutor,
        report_progress,
    ) -> DataPortalUserFileImportResult:
        del self, key, executor, report_progress
        assert execution.input.api_token == "browser-import-secret"
        staging = Path(execution.input.staging_dir)
        (staging / "corpus.parquet").write_bytes(b"parquet")
        return DataPortalUserFileImportResult(
            destination_path="LDaCA/corpus",
            file_count=1,
            bytes_written=7,
        )

    monkeypatch.setattr(DataPortalService, "execute_import", fake_execute)
    accepted = multi_user_test_client.post(
        "/api/data-portal/imports",
        json={
            "identifier": "arcp://name,example",
            "name": "Corpus",
            "api_token": "browser-import-secret",
        },
    )
    assert accepted.status_code == 202, accepted.text
    deadline = time.monotonic() + 10
    while True:
        resource = multi_user_test_client.get(accepted.headers["location"]).json()
        if resource["state"] in {"succeeded", "failed", "cancelled"}:
            break
        assert time.monotonic() < deadline
        time.sleep(0.02)
    assert resource["state"] == "succeeded", resource
    assert all(
        b"browser-import-secret" not in path.read_bytes()
        for path in tmp_path.rglob("*")
        if path.is_file()
    )
