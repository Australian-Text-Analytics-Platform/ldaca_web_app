"""Atomic, resource-local User File Import persistence."""

from datetime import UTC, datetime
from pathlib import Path

import anyio

from ldaca_wordflow.domain import SampleUserFileImportRequest, UserFileImport
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
    assert "alice" not in content
    assert "user_id" not in content
    assert "api_token" not in content


async def test_corrupt_import_storage_is_isolated_to_its_user(tmp_path: Path) -> None:
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
    assert snapshot.corrupt_users == {"bob"}


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
