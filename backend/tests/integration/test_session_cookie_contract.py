"""Acceptance tests for hosted cookies and desktop CSRF enforcement."""

from __future__ import annotations

import sqlite3
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import anyio
import pytest
from fastapi.testclient import TestClient

from ldaca_wordflow.main import create_app
from ldaca_wordflow.infrastructure.storage.layout import deployment_database_path
from ldaca_wordflow.models.session import SessionUser
from ldaca_wordflow.runtime import Runtime, runtime_context
from ldaca_wordflow.settings import Settings

DEV_FRONTEND_ORIGINS = (
    "http://localhost:3000",
    "http://127.0.0.1:3000",
)


def _settings(tmp_path: Path, *, multi_user: bool) -> Settings:
    return Settings(
        data_root=tmp_path,
        multi_user=multi_user,
        session_cookie_secure=multi_user,
        cors_allowed_origins=(
            ("https://wordflow.example",)
            if multi_user
            else ("http://testserver", "tauri://localhost")
        ),
        trusted_hosts=("wordflow.example",) if multi_user else ("testserver",),
        google_client_id="google-client" if multi_user else "",
    )


def test_desktop_session_requires_process_csrf_for_unsafe_loopback(
    tmp_path: Path,
) -> None:
    app = create_app(_settings(tmp_path, multi_user=False), serve_frontend=False)
    database_path = deployment_database_path(_settings(tmp_path, multi_user=False))
    with TestClient(app, base_url="http://testserver") as client:
        session = client.get("/api/session")
        assert session.status_code == 200
        payload = session.json()
        assert payload["mode"] == "single_user"
        assert payload["authenticated"] is True
        assert payload["user"] == {
            "id": "root",
            "email": "root@localhost",
            "name": "Root User",
            "picture": None,
        }
        assert session.headers["cache-control"] == "private, no-store"

        no_origin = client.post("/api/workspaces/", json={"name": "Workspace"})
        assert no_origin.status_code == 403
        assert no_origin.json()["code"] == "origin_not_allowed"

        no_csrf = client.post(
            "/api/workspaces/",
            json={"name": "Workspace"},
            headers={"Origin": "http://testserver"},
        )
        assert no_csrf.status_code == 403
        assert no_csrf.json()["code"] == "csrf_failed"

        malformed_origin = client.post(
            "/api/workspaces/",
            json={"name": "Workspace"},
            headers={
                "Origin": "http://testserver/path",
                "X-CSRF-Token": payload["csrf_token"],
            },
        )
        assert malformed_origin.status_code == 403
        assert malformed_origin.json()["code"] == "origin_not_allowed"

        accepted = client.post(
            "/api/workspaces/",
            json={"name": "Workspace"},
            headers={
                "Origin": "http://testserver",
                "X-CSRF-Token": payload["csrf_token"],
            },
        )
        assert accepted.status_code == 201

    assert not database_path.exists()
    assert (tmp_path / "users" / "root" / "files").is_dir()
    assert (tmp_path / "users" / "root" / "imports").is_dir()


def test_root_path_cannot_bypass_csrf_and_locations_keep_prefix(
    tmp_path: Path,
) -> None:
    """ASGI mount prefixes remain inside the same security/link contract."""

    app = create_app(_settings(tmp_path, multi_user=False), serve_frontend=False)
    with TestClient(
        app,
        base_url="http://testserver",
        root_path="/prefix",
    ) as client:
        session = client.get("/prefix/api/session").json()
        rejected = client.post(
            "/prefix/api/workspaces",
            json={"name": "Bypass"},
        )
        assert rejected.status_code == 403
        assert rejected.json()["code"] == "origin_not_allowed"

        accepted = client.post(
            "/prefix/api/workspaces",
            json={"name": "Prefixed"},
            headers={
                "Origin": "http://testserver",
                "X-CSRF-Token": session["csrf_token"],
            },
        )
        assert accepted.status_code == 201
        assert accepted.headers["location"].startswith("/prefix/api/workspaces/")


def test_single_user_ignores_legacy_database_and_preserves_data(
    tmp_path: Path,
) -> None:
    settings = _settings(tmp_path, multi_user=False)
    database_path = deployment_database_path(settings)
    database_path.write_bytes(b"unsupported legacy database")
    user_file = tmp_path / "users" / "root" / "files" / "keep.txt"
    user_file.parent.mkdir(parents=True)
    user_file.write_text("user data", encoding="utf-8")
    workspace_file = tmp_path / "workspaces" / "keep.bin"
    workspace_file.parent.mkdir(parents=True)
    workspace_file.write_bytes(b"workspace data")

    app = create_app(settings, serve_frontend=False)
    with TestClient(app, base_url="http://testserver") as client:
        assert client.get("/health/ready").status_code == 200
        assert client.get("/api/session").json()["user"]["name"] == "Root User"
        assert client.get("/api/storage").json() == {"policy": "unlimited"}

    assert database_path.read_bytes() == b"unsupported legacy database"
    assert user_file.read_text(encoding="utf-8") == "user data"
    assert workspace_file.read_bytes() == b"workspace data"


def test_multi_user_still_rejects_an_unsupported_database(tmp_path: Path) -> None:
    settings = _settings(tmp_path, multi_user=True)
    database = sqlite3.connect(deployment_database_path(settings))
    database.execute("PRAGMA user_version = 6")
    database.close()

    app = create_app(settings, serve_frontend=False)
    with TestClient(app, base_url="https://wordflow.example") as client:
        resource = client.get("/api/data-root")
        assert resource.status_code == 200
        assert resource.json()["state"] == "configuration_error"
        assert resource.json()["error"]["message"] == (
            "RuntimeError: Unsupported database schema version"
        )
        assert client.get("/health/ready").status_code == 503


@pytest.mark.parametrize("frontend_origin", DEV_FRONTEND_ORIGINS)
def test_explicit_dev_origin_and_workspace_preflight_are_allowed(
    tmp_path: Path,
    frontend_origin: str,
) -> None:
    """The separately served development frontend uses exact CORS configuration."""

    settings = Settings(
        data_root=tmp_path,
        multi_user=False,
        cors_allowed_origins=DEV_FRONTEND_ORIGINS,
    )
    app = create_app(settings, serve_frontend=False)
    with TestClient(app, base_url="http://localhost:8001") as client:
        session = client.get("/api/session", headers={"Origin": frontend_origin})
        assert session.status_code == 200
        assert session.headers["access-control-allow-origin"] == frontend_origin
        csrf = session.json()["csrf_token"]
        created = client.post(
            "/api/workspaces",
            json={"name": "Split development"},
            headers={
                "Origin": frontend_origin,
                "X-CSRF-Token": csrf,
            },
        )
        assert created.status_code == 201
        assert created.headers["access-control-allow-origin"] == frontend_origin

        preflight = client.options(
            f"/api/workspaces/{created.json()['id']}",
            headers={
                "Origin": frontend_origin,
                "Access-Control-Request-Method": "PATCH",
                "Access-Control-Request-Headers": "content-type,x-csrf-token",
            },
        )
        assert preflight.status_code == 200
        assert preflight.headers["access-control-allow-origin"] == frontend_origin
        allowed_headers = preflight.headers["access-control-allow-headers"].lower()
        assert "x-csrf-token" in allowed_headers
        assert "if-match" not in allowed_headers


def test_unlisted_dev_origin_is_rejected(tmp_path: Path) -> None:
    settings = Settings(
        data_root=tmp_path,
        multi_user=False,
        cors_allowed_origins=DEV_FRONTEND_ORIGINS,
    )
    app = create_app(settings, serve_frontend=False)
    with TestClient(app, base_url="http://localhost:8001") as client:
        session = client.get(
            "/api/session",
            headers={"Origin": "http://localhost:3001"},
        )
        assert session.status_code == 200
        assert "access-control-allow-origin" not in session.headers

        preflight = client.options(
            "/api/workspaces/example",
            headers={
                "Origin": "http://localhost:3001",
                "Access-Control-Request-Method": "PATCH",
                "Access-Control-Request-Headers": "content-type,x-csrf-token",
            },
        )
        assert preflight.status_code == 400
        assert "access-control-allow-origin" not in preflight.headers


def test_bundled_same_origin_requires_no_cors_entry(tmp_path: Path) -> None:
    settings = Settings(data_root=tmp_path, multi_user=False, cors_allowed_origins=())
    app = create_app(settings, serve_frontend=False)
    with TestClient(app, base_url="http://localhost:8001") as client:
        csrf = client.get("/api/session").json()["csrf_token"]
        created = client.post(
            "/api/workspaces",
            json={"name": "Same origin"},
            headers={
                "Origin": "http://localhost:8001",
                "X-CSRF-Token": csrf,
            },
        )
        assert created.status_code == 201


def test_dns_rebinding_host_cannot_obtain_single_user_capabilities(
    tmp_path: Path,
) -> None:
    """An arbitrary hostname resolving to loopback is not a trusted app origin."""

    app = create_app(
        Settings(data_root=tmp_path, multi_user=False), serve_frontend=False
    )
    with TestClient(app, base_url="http://evil.example") as client:
        session = client.get("/api/session")

    assert session.status_code == 400
    assert session.json()["code"] == "host_not_allowed"


def test_hosted_callback_issues_hashed_multi_session_cookie_and_exact_logout(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
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
        assert not (settings.get_users_root_folder() / "root").exists()
        user = SessionUser(
            id="user-a",
            email="person@example.test",
            name="Person",
        )

        async def fake_verify(_credential: str) -> SessionUser:
            return await runtime.session_service.upsert_oidc_user(
                issuer="https://accounts.google.com",
                subject="subject-a",
                email=user.email,
                name=user.name,
                picture=None,
            )

        monkeypatch.setattr(runtime.oauth_service, "verify_google", fake_verify)
        client.cookies.set("g_csrf_token", "provider-csrf")
        callback = client.post(
            "/api/auth/google/callback",
            data={
                "credential": "credential",
                "g_csrf_token": "provider-csrf",
                "return_to": "/workspace",
            },
            follow_redirects=False,
        )
        assert callback.status_code == 303
        assert callback.headers["location"] == "/workspace"
        cookie_header = callback.headers["set-cookie"]
        assert "wordflow_session=" in cookie_header
        assert "HttpOnly" in cookie_header
        assert "Secure" in cookie_header
        assert "SameSite=lax" in cookie_header
        assert "Path=/" in cookie_header
        assert "Max-Age=" in cookie_header
        assert "Domain=" not in cookie_header

        session = client.get("/api/session")
        assert session.status_code == 200
        session_payload = session.json()
        assert session_payload["authenticated"] is True
        issued_user = SessionUser.model_validate(session_payload["user"])
        csrf_token = session_payload["csrf_token"]

        second = anyio.run(runtime.session_service.issue, issued_user)
        assert second.session_token != client.cookies.get("wordflow_session")

        logout = client.delete(
            "/api/session",
            headers={
                "Origin": "https://wordflow.example",
                "X-CSRF-Token": csrf_token,
            },
        )
        assert logout.status_code == 204
        assert logout.content == b""
        assert (
            anyio.run(
                runtime.session_service.current_principal,
                second.session_token,
            )
            is not None
        )

    database = sqlite3.connect(deployment_database_path(settings))
    row = database.execute(
        "SELECT token_hash, csrf_hash FROM user_sessions LIMIT 1"
    ).fetchone()
    quota = database.execute(
        "SELECT storage_quota_bytes FROM users WHERE email = ?",
        (user.email,),
    ).fetchone()
    database.close()
    assert row is not None
    assert quota == (30 * 1024**3,)
    assert second.session_token not in row
    assert second.csrf_token not in row


@pytest.mark.parametrize(
    "return_to",
    [
        "https://attacker.test/",
        "//attacker.test/",
        "/\\attacker.test/",
        "/../outside",
        "/%252e%252e/outside",
    ],
)
def test_google_callback_rejects_unsafe_redirect_before_issuing_session(
    tmp_path: Path,
    return_to: str,
    finite_quota_test_filesystem: None,
) -> None:
    settings = _settings(tmp_path, multi_user=True)
    app = create_app(settings, serve_frontend=False)
    with TestClient(app, base_url="https://wordflow.example") as client:
        client.cookies.set("g_csrf_token", "provider-csrf")
        response = client.post(
            "/api/auth/google/callback",
            data={
                "credential": "unused",
                "g_csrf_token": "provider-csrf",
                "return_to": return_to,
            },
            follow_redirects=False,
        )
        assert response.status_code == 400
        assert "wordflow_session=" not in response.headers.get("set-cookie", "")
