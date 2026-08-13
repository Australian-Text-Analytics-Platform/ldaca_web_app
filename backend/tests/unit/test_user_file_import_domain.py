"""Strict User File Import lifecycle invariants."""

from datetime import UTC, datetime, timedelta

import pytest
from pydantic import TypeAdapter, ValidationError

from ldaca_wordflow.domain import (
    DataPortalUserFileImportRequest,
    SampleUserFileImportRequest,
    SampleUserFileImportResult,
    UserFileImport,
    UserFileImportRequest,
)
from ldaca_wordflow.domain.background import BackgroundState, Failure, Progress


def test_import_request_union_is_secret_free_strict_and_discriminated() -> None:
    request = TypeAdapter(UserFileImportRequest).validate_python(
        {"kind": "data_portal", "identifier": "arcp://name,example", "name": None}
    )

    assert isinstance(request, DataPortalUserFileImportRequest)
    with pytest.raises(ValidationError):
        TypeAdapter(UserFileImportRequest).validate_python(
            {
                "kind": "data_portal",
                "identifier": "arcp://name,example",
                "name": None,
                "api_token": "secret",
            }
        )


def test_import_lifecycle_has_one_exact_public_and_persisted_shape() -> None:
    created_at = datetime.now(UTC)
    record = UserFileImport.create(
        SampleUserFileImportRequest(collection_id="example"),
        timestamp=created_at,
    )

    assert set(record.model_dump()) == {
        "id",
        "request",
        "state",
        "progress",
        "cancellation_requested_at",
        "error",
        "result",
        "created_at",
        "started_at",
        "finished_at",
        "revision",
    }
    running = record.start(created_at + timedelta(seconds=1))
    succeeded = running.succeed(
        created_at + timedelta(seconds=2),
        result=SampleUserFileImportResult(
            collection_id="example",
            destination_path="sample_data/example",
            file_count=1,
            bytes_written=10,
        ),
    )
    assert succeeded.state is BackgroundState.SUCCEEDED
    assert succeeded.progress == Progress(fraction=1.0, message="Complete")
    assert succeeded.revision == 3


def test_import_lifecycle_rejects_mismatched_result_and_terminal_fields() -> None:
    created_at = datetime.now(UTC)
    queued = UserFileImport.create(
        SampleUserFileImportRequest(collection_id="example"),
        timestamp=created_at,
    )
    payload = queued.model_dump(mode="json")
    payload.update(
        state="succeeded",
        started_at=created_at.isoformat(),
        finished_at=created_at.isoformat(),
        progress={"fraction": 1.0, "message": "Complete"},
        result={
            "kind": "data_portal",
            "destination_path": "LDaCA/example",
            "file_count": 1,
            "bytes_written": 10,
        },
    )
    with pytest.raises(ValidationError, match="kinds must match"):
        UserFileImport.model_validate(payload)

    payload["result"] = None
    with pytest.raises(ValidationError, match="successful imports"):
        UserFileImport.model_validate(payload)


def test_queued_and_running_cancellation_semantics_are_distinct() -> None:
    created_at = datetime.now(UTC)
    queued = UserFileImport.create(
        SampleUserFileImportRequest(collection_id="example"),
        timestamp=created_at,
    )
    cancelled_at = created_at + timedelta(seconds=1)

    cancelled = queued.cancel_queued(cancelled_at)
    running = queued.start(cancelled_at)
    requested = running.request_running_cancellation(
        cancelled_at + timedelta(seconds=1)
    )
    confirmed = requested.confirm_cancelled(
        cancelled_at + timedelta(seconds=2),
        progress=Progress(fraction=0.5, message="Stopping"),
    )

    assert cancelled.started_at is None
    assert cancelled.state is BackgroundState.CANCELLED
    assert requested.state is BackgroundState.RUNNING
    assert requested.finished_at is None
    assert confirmed.state is BackgroundState.CANCELLED


def test_failed_import_has_the_shared_safe_failure() -> None:
    created_at = datetime.now(UTC)
    queued = UserFileImport.create(
        SampleUserFileImportRequest(collection_id="example"),
        timestamp=created_at,
    )
    failed = queued.fail(
        created_at,
        failure=Failure(
            code="user_file_import_interrupted",
            message="User File import was interrupted",
        ),
        progress=queued.progress,
    )

    assert failed.state is BackgroundState.FAILED
    assert failed.started_at is None
