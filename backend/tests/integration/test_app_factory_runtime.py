"""Application-factory and lifespan ownership contract.

Used by:
- the backend architecture, which needs proof that constructing or
  exporting an app does not allocate runtime resources and that independent app
  instances do not share lifespan state.

Flow:
- build small apps with caller-owned immutable settings and instrumented runtime
  context managers,
- enter each lifespan through ``TestClient``, and
- assert request state, health, error, and teardown behavior at the ASGI boundary.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated, Any, cast

import anyio
import pytest
from fastapi import APIRouter, Depends, Request
from fastapi.testclient import TestClient
from pydantic import ValidationError

from ldaca_wordflow.runtime import RuntimeReadiness, _RuntimeTaskGroupOwner, get_runtime
from ldaca_wordflow.shared.errors import InternalServiceError

RuntimeProbeDep = Annotated[Any, Depends(get_runtime)]


@dataclass(frozen=True, slots=True)
class _FakeRuntime:
    """Tiny runtime value used to prove lifespan state is app-local."""

    name: str
    readiness: RuntimeReadiness = field(default_factory=RuntimeReadiness)


class _FakeCancelScope:
    def __init__(self, events: list[str]) -> None:
        self._events = events

    def cancel(self) -> None:
        self._events.append("task-group-cancel")


class _FakeTaskGroup:
    def __init__(self, events: list[str]) -> None:
        self.cancel_scope = _FakeCancelScope(events)
        self._events = events

    async def __aexit__(self, *_args: object) -> None:
        self._events.append("task-group-exit")


@pytest.mark.anyio
async def test_runtime_task_group_users_unwind_before_the_group_joins() -> None:
    """Shutdown closes admission and execution before joining the task group."""

    events: list[str] = []
    readiness = RuntimeReadiness()
    deadlines: list[float] = []
    owner = _RuntimeTaskGroupOwner(
        cast(Any, _FakeTaskGroup(events)),
        readiness,
        1,
    )

    def stop_admission() -> None:
        events.append(f"admission-{readiness.status}")

    async def close_analysis(deadline: float) -> None:
        assert deadline >= anyio.current_time()
        deadlines.append(deadline)
        events.append("analysis-close")

    async def close_imports(deadline: float) -> None:
        assert deadline >= anyio.current_time()
        deadlines.append(deadline)
        events.append("imports-close")

    async def close_maintenance() -> None:
        events.append("maintenance-close")

    owner.register_admission_stopper(stop_admission)
    owner.register_execution_shutdown(close_analysis)
    owner.register_execution_shutdown(close_imports)
    owner.register_maintenance_shutdown(close_maintenance)

    await owner.close()
    await owner.close()

    assert events[:2] == ["admission-stopping", "maintenance-close"]
    assert set(events[2:4]) == {"analysis-close", "imports-close"}
    assert events[4:] == ["task-group-cancel", "task-group-exit"]
    assert len(set(deadlines)) == 1


@pytest.mark.anyio
async def test_runtime_shutdown_cancels_execution_at_the_shared_deadline() -> None:
    """One stuck execution owner cannot extend the infrastructure deadline."""

    events: list[str] = []
    owner = _RuntimeTaskGroupOwner(
        cast(Any, _FakeTaskGroup(events)),
        RuntimeReadiness(),
        0.01,
    )

    async def stuck(_deadline: float) -> None:
        await anyio.sleep_forever()

    owner.register_execution_shutdown(stuck)
    with anyio.fail_after(0.5):
        await owner.close()

    assert events == ["task-group-cancel", "task-group-exit"]


def test_settings_are_loaded_explicitly_and_are_immutable(tmp_path: Path) -> None:
    """Bootstrap settings cannot be reloaded or mutated after validation."""

    from ldaca_wordflow.settings import Settings, load_settings

    settings = load_settings(data_root=tmp_path, multi_user=False)

    assert isinstance(settings, Settings)
    assert settings.get_data_root() == tmp_path
    with pytest.raises(ValidationError):
        settings.data_root = tmp_path / "other"


def test_runtime_factory_is_deferred_until_lifespan_and_unwinds(tmp_path: Path) -> None:
    """OpenAPI/app construction is side-effect free; lifespan owns resources."""

    from ldaca_wordflow.main import RuntimeContextFactory, create_app
    from ldaca_wordflow.settings import load_settings

    events: list[str] = []

    def runtime_context_factory(_settings):
        events.append("factory")

        @asynccontextmanager
        async def context() -> AsyncIterator[_FakeRuntime]:
            events.append("startup")
            try:
                yield _FakeRuntime("deferred")
            finally:
                events.append("shutdown")

        return context()

    app = create_app(
        load_settings(data_root=tmp_path, multi_user=False),
        cast(RuntimeContextFactory, runtime_context_factory),
        serve_frontend=False,
    )
    probe = APIRouter()

    @probe.get("/__runtime-probe", include_in_schema=False)
    async def runtime_probe(runtime: RuntimeProbeDep) -> dict[str, str]:
        return {"name": runtime.name}

    app.include_router(probe)

    assert events == []
    assert app.openapi()["info"]["title"] == "LDaCA Wordflow API"
    assert events == []

    with TestClient(app, base_url="http://localhost") as client:
        assert events == ["factory", "startup"]
        assert client.get("/__runtime-probe").json() == {"name": "deferred"}

    assert events == ["factory", "startup", "shutdown"]


def test_two_app_instances_can_share_one_data_root(tmp_path: Path) -> None:
    """Independent backend processes may use the same Data Root."""

    from ldaca_wordflow.main import create_app
    from ldaca_wordflow.settings import load_settings

    settings = load_settings(data_root=tmp_path, multi_user=False)
    app_a = create_app(settings, serve_frontend=False)
    app_b = create_app(settings, serve_frontend=False)

    with (
        TestClient(app_a, base_url="http://localhost") as client_a,
        TestClient(app_b, base_url="http://localhost") as client_b,
    ):
        assert client_a.get("/health/ready").status_code == 200
        assert client_b.get("/health/ready").status_code == 200


def test_data_root_switch_replaces_the_production_runtime_in_one_process(
    tmp_path: Path,
) -> None:
    """An HTTP transition preserves the process while replacing all resources."""

    from ldaca_wordflow.data_root_config import DataRootConfigStore, DataRootPaths
    from ldaca_wordflow.main import create_app
    from ldaca_wordflow.settings import Settings

    original = (tmp_path / "original").resolve()
    candidate = (tmp_path / "candidate").resolve()
    store = DataRootConfigStore(
        DataRootPaths(
            config_file=tmp_path / "config" / "settings.json",
            suggested_data_root=tmp_path / "suggested",
        )
    )
    store.write(original)
    app = create_app(
        Settings(),
        serve_frontend=False,
        data_root_config_store=store,
    )

    with TestClient(app, base_url="http://localhost") as client:
        initial = client.get("/api/data-root").json()
        response = client.put(
            "/api/data-root",
            headers={
                "Origin": "http://localhost",
                "X-Data-Root-Token": initial["change_token"],
            },
            json={"data_root": str(candidate)},
        )

        assert response.status_code == 200, response.text
        assert response.json()["state"] == "ready"
        assert response.json()["data_root"] == str(candidate)
        assert response.json()["runtime_generation"] == 2
        assert client.get("/health/live").status_code == 200
        assert client.get("/health/ready").status_code == 200
        assert store.read() == candidate


def test_two_app_instances_keep_settings_runtime_and_overrides_isolated(
    tmp_path: Path,
) -> None:
    """App-local lifespan state prevents cross-instance test/runtime leakage."""

    from ldaca_wordflow.main import RuntimeContextFactory, create_app
    from ldaca_wordflow.settings import load_settings

    def make_runtime(name: str):
        def factory(_settings):
            @asynccontextmanager
            async def context() -> AsyncIterator[_FakeRuntime]:
                yield _FakeRuntime(name)

            return context()

        return factory

    app_a = create_app(
        load_settings(data_root=tmp_path / "a", multi_user=False),
        cast(RuntimeContextFactory, make_runtime("a")),
        serve_frontend=False,
    )
    app_b = create_app(
        load_settings(data_root=tmp_path / "b", multi_user=False),
        cast(RuntimeContextFactory, make_runtime("b")),
        serve_frontend=False,
    )
    probe = APIRouter()

    @probe.get("/__runtime-name", include_in_schema=False)
    async def runtime_name(runtime: RuntimeProbeDep) -> dict[str, str]:
        return {"name": runtime.name}

    app_a.include_router(probe)
    app_b.include_router(probe)

    app_a.dependency_overrides[get_runtime] = lambda: _FakeRuntime("override-a")
    with (
        TestClient(app_a, base_url="http://localhost") as client_a,
        TestClient(app_b, base_url="http://localhost") as client_b,
    ):
        assert client_a.get("/__runtime-name").json() == {"name": "override-a"}
        assert client_b.get("/__runtime-name").json() == {"name": "b"}


def test_liveness_and_readiness_are_distinct_and_legacy_health_is_absent(
    tmp_path: Path,
) -> None:
    """The control plane stays live independently of the complete Runtime."""

    from ldaca_wordflow.main import RuntimeContextFactory, create_app
    from ldaca_wordflow.settings import load_settings

    runtime = _FakeRuntime("health")

    @asynccontextmanager
    async def runtime_context(_settings) -> AsyncIterator[_FakeRuntime]:
        yield runtime

    app = create_app(
        load_settings(data_root=tmp_path, multi_user=False),
        cast(RuntimeContextFactory, runtime_context),
        serve_frontend=False,
    )

    with TestClient(app, base_url="http://localhost") as client:
        live = client.get("/health/live")
        ready = client.get("/health/ready")

        assert live.status_code == 200
        assert live.json() == {"status": "live", "version": "0.7.6"}
        assert ready.status_code == 200
        assert ready.json() == {"status": "ready", "version": "0.7.6"}
        assert client.get("/health").status_code == 404
        assert client.get("/status").status_code == 404
        assert client.get("/api").status_code == 404


def test_framework_api_errors_use_the_canonical_envelope(tmp_path: Path) -> None:
    """Router-level 404/405 responses keep request identity and stable codes."""

    from ldaca_wordflow.main import create_app
    from ldaca_wordflow.settings import load_settings

    app = create_app(
        load_settings(data_root=tmp_path, multi_user=False),
        serve_frontend=False,
    )
    with TestClient(app, base_url="http://localhost") as client:
        missing = client.get(
            "/api/not-real",
            headers={"X-Request-ID": "missing-route"},
        )

    assert missing.status_code == 404
    assert missing.headers["cache-control"] == "private, no-store"
    assert "cookie" in missing.headers["vary"].casefold()
    assert missing.json() == {
        "code": "not_found",
        "message": "Resource not found",
        "request_id": "missing-route",
    }


def test_request_id_and_sanitized_validation_error_contract(tmp_path: Path) -> None:
    """Every API error carries a bounded request ID without echoing input."""

    from ldaca_wordflow.main import RuntimeContextFactory, create_app
    from ldaca_wordflow.settings import load_settings

    @asynccontextmanager
    async def runtime_context(_settings) -> AsyncIterator[_FakeRuntime]:
        yield _FakeRuntime("errors")

    app = create_app(
        load_settings(data_root=tmp_path, multi_user=False),
        cast(RuntimeContextFactory, runtime_context),
        serve_frontend=False,
    )
    router = APIRouter()

    @router.get("/__validation-probe", include_in_schema=False)
    async def validation_probe(secret: int) -> dict[str, int]:
        return {"secret": secret}

    app.include_router(router)

    with TestClient(app, base_url="http://localhost") as client:
        response = client.get(
            "/__validation-probe",
            params={"secret": "provider-key-must-not-echo"},
            headers={"X-Request-ID": "client-request-42"},
        )

    assert response.status_code == 422
    assert response.headers["X-Request-ID"] == "client-request-42"
    assert response.json() == {
        "code": "request_validation_failed",
        "message": "Request validation failed",
        "details": [
            {
                "location": ["query", "secret"],
                "type": "int_parsing",
                "message": "Input should be a valid integer, unable to parse string as an integer",
            }
        ],
        "request_id": "client-request-42",
    }
    assert "provider-key-must-not-echo" not in response.text


def test_annotation_provider_errors_log_safe_request_context(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import ldaca_wordflow.main as main_module
    from ldaca_wordflow.settings import load_settings
    from ldaca_wordflow.shared.errors import AnnotationProviderError

    log_calls: list[tuple[str, tuple[object, ...]]] = []

    def capture_log(message: str, *args: object, **_kwargs: object) -> None:
        log_calls.append((message, args))

    monkeypatch.setattr(main_module.logger, "error", capture_log)
    app = main_module.create_app(
        load_settings(data_root=tmp_path, multi_user=False),
        serve_frontend=False,
    )
    router = APIRouter()

    @router.get("/api/__annotation-provider-probe", include_in_schema=False)
    async def annotation_provider_probe() -> None:
        raise AnnotationProviderError(
            "annotation_provider_request_rejected",
            "Annotation provider rejected the request.",
            provider="anthropic",
            model="claude-sonnet-5",
        )

    app.include_router(router)

    with TestClient(
        app,
        base_url="http://localhost",
        raise_server_exceptions=False,
    ) as client:
        response = client.get(
            "/api/__annotation-provider-probe",
            headers={"X-Request-ID": "annotation-provider-probe"},
        )

    assert response.status_code == 502
    assert response.json() == {
        "code": "annotation_provider_request_rejected",
        "message": (
            "AnnotationProviderError: Annotation provider rejected the request."
        ),
        "request_id": "annotation-provider-probe",
    }
    assert (
        "Annotation provider failure provider=%s model=%s code=%s request_id=%s",
        (
            "anthropic",
            "claude-sonnet-5",
            "annotation_provider_request_rejected",
            "annotation-provider-probe",
        ),
    ) in log_calls


def test_unexpected_api_errors_cross_the_complete_http_boundary(tmp_path: Path) -> None:
    """Unhandled failures retain diagnostics across the browser HTTP boundary."""

    from ldaca_wordflow.main import create_app
    from ldaca_wordflow.settings import load_settings

    app = create_app(
        load_settings(
            data_root=tmp_path,
            multi_user=False,
            cors_allowed_origins=("http://frontend.test",),
        ),
        serve_frontend=False,
    )
    router = APIRouter()

    @router.get("/api/__unexpected-probe", include_in_schema=False)
    async def unexpected_probe() -> None:
        raise RuntimeError("private backend details")

    @router.get("/api/__chained-probe", include_in_schema=False)
    async def chained_probe() -> None:
        try:
            raise OSError("disk full")
        except OSError as exc:
            raise InternalServiceError("Workspace save failed") from exc

    app.include_router(router)

    with TestClient(
        app,
        base_url="http://localhost",
        raise_server_exceptions=False,
    ) as client:
        response = client.get(
            "/api/__unexpected-probe",
            headers={
                "Origin": "http://frontend.test",
                "X-Request-ID": "unexpected-probe",
            },
        )
        chained = client.get(
            "/api/__chained-probe",
            headers={"X-Request-ID": "chained-probe"},
        )

    assert response.status_code == 500
    assert response.headers["access-control-allow-origin"] == "http://frontend.test"
    assert response.headers["cache-control"] == "private, no-store"
    assert response.json() == {
        "code": "internal_server_error",
        "message": "RuntimeError: private backend details",
        "request_id": "unexpected-probe",
    }
    assert "Traceback" not in response.text
    assert __file__ not in response.text
    assert chained.status_code == 500
    assert chained.json() == {
        "code": "internal_service_error",
        "message": "OSError: disk full",
        "request_id": "chained-probe",
    }


def test_request_body_limit_counts_actual_bytes(tmp_path: Path) -> None:
    """A false Content-Length cannot bypass the process-wide body boundary."""

    from ldaca_wordflow.main import RuntimeContextFactory, create_app
    from ldaca_wordflow.settings import load_settings

    @asynccontextmanager
    async def runtime_context(_settings) -> AsyncIterator[_FakeRuntime]:
        yield _FakeRuntime("body-limit")

    app = create_app(
        load_settings(
            data_root=tmp_path,
            multi_user=False,
            max_default_request_body_bytes=4,
        ),
        cast(RuntimeContextFactory, runtime_context),
        serve_frontend=False,
    )
    router = APIRouter()

    @router.post("/__body-probe", include_in_schema=False)
    async def body_probe(request: Request) -> dict[str, int]:
        return {"size": len(await request.body())}

    app.include_router(router)

    with TestClient(app, base_url="http://localhost") as client:
        response = client.post(
            "/__body-probe",
            content=b"12345",
            headers={
                "Content-Length": "1",
                "X-Request-ID": "body-too-large",
            },
        )

    assert response.status_code == 413
    assert response.json() == {
        "code": "request_body_too_large",
        "message": "Request body exceeds the configured limit",
        "request_id": "body-too-large",
    }
