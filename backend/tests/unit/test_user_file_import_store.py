"""Atomic, resource-local User File Import persistence."""

import json
from datetime import UTC, datetime
from pathlib import Path

import anyio

from ldaca_wordflow.domain import (
    SampleUserFileImportRequest,
    SampleUserFileImportResult,
    UserFileImport,
)
from ldaca_wordflow.infrastructure.storage.user_file_import_store import (
    UserFileImportStore,
)


def _store(tmp_path: Path, *, max_record_bytes: int = 64 * 1024) -> UserFileImportStore:
    users = (tmp_path / "users").resolve()
    return UserFileImportStore(
        lambda user_id: users / user_id / "imports",
        all_users_root=users,
        max_record_bytes=max_record_bytes,
        limiter=anyio.CapacityLimiter(2),
    )


async def test_imports_are_independent_strict_user_owned_json_records(
    tmp_path: Path,
) -> None:
    store = _store(tmp_path)
    resource = UserFileImport.create(
        SampleUserFileImportRequest(collection_id="example"),
        timestamp=datetime.now(UTC),
    )

    await store.save("alice", resource)
    snapshot = await store.load_all()

    assert snapshot.records[0].user_id == "alice"
    assert snapshot.records[0].resource == resource
    record_path = tmp_path / "users" / "alice" / "imports" / f"{resource.id}.json"
    content = record_path.read_text(encoding="utf-8")
    envelope = json.loads(content)
    assert envelope["version"] == 1
    assert envelope["resource"]["id"] == str(resource.id)
    assert "alice" not in content
    assert "user_id" not in content
    assert "api_token" not in content


async def test_corrupt_import_record_is_isolated_from_healthy_history(
    tmp_path: Path,
) -> None:
    store = _store(tmp_path)
    resource = UserFileImport.create(
        SampleUserFileImportRequest(collection_id="example"),
        timestamp=datetime.now(UTC),
    )
    await store.save("alice", resource)
    corrupt = tmp_path / "users" / "bob" / "imports"
    corrupt.mkdir(parents=True)
    (corrupt / f"{resource.id}.json").write_text("not json", encoding="utf-8")

    snapshot = await store.load_all()

    assert [(item.user_id, item.resource) for item in snapshot.records] == [
        ("alice", resource)
    ]
    assert [
        (item.user_id, item.import_id) for item in snapshot.unavailable_records
    ] == [("bob", resource.id)]
    assert snapshot.corrupt_users == set()


async def test_unversioned_and_unknown_import_envelopes_are_unavailable(
    tmp_path: Path,
) -> None:
    store = _store(tmp_path)
    root = tmp_path / "users" / "alice" / "imports"
    root.mkdir(parents=True)
    unversioned_id = UserFileImport.create(
        SampleUserFileImportRequest(collection_id="unversioned"),
        timestamp=datetime.now(UTC),
    ).id
    unknown_id = UserFileImport.create(
        SampleUserFileImportRequest(collection_id="unknown"),
        timestamp=datetime.now(UTC),
    ).id
    (root / f"{unversioned_id}.json").write_text("{}", encoding="utf-8")
    (root / f"{unknown_id}.json").write_text(
        json.dumps({"version": 2, "resource": {}}),
        encoding="utf-8",
    )

    snapshot = await store.load_all()

    assert snapshot.records == []
    assert {item.import_id for item in snapshot.unavailable_records} == {
        unversioned_id,
        unknown_id,
    }


async def test_terminal_record_delete_is_durable_and_idempotent(tmp_path: Path) -> None:
    store = _store(tmp_path)
    resource = UserFileImport.create(
        SampleUserFileImportRequest(collection_id="example"),
        timestamp=datetime.now(UTC),
    )
    await store.save("alice", resource)

    await store.delete("alice", resource.id)
    await store.delete("alice", resource.id)

    assert (await store.load_all()).records == []


async def test_prepared_publication_journal_is_strict_and_durable(
    tmp_path: Path,
) -> None:
    store = _store(tmp_path)
    timestamp = datetime.now(UTC)
    running = UserFileImport.create(
        SampleUserFileImportRequest(collection_id="example"),
        timestamp=timestamp,
    ).start(timestamp)
    succeeded = running.succeed(
        timestamp,
        result=SampleUserFileImportResult(
            collection_id="example",
            destination_path="sample_data/example",
            file_count=1,
            bytes_written=10,
        ),
    )

    await store.prepare_publication("alice", succeeded)
    snapshot = await store.load_all()

    assert snapshot.prepared_publications[0].resource == succeeded
    journal = (
        tmp_path
        / "users"
        / "alice"
        / "imports"
        / f".prepared-{succeeded.id}.json"
    )
    assert json.loads(journal.read_text())["version"] == 1

    await store.clear_prepared_publication("alice", succeeded.id)
    assert (await store.load_all()).prepared_publications == []
