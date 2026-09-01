"""Bounded, transactional workspace ZIP import service tests."""

from __future__ import annotations

import io
import json
import os
import stat
import struct
import unicodedata
import uuid
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

import anyio
import polars as pl
import pytest
from ldaca_wordflow.domain.workspace import (
    AnalysisExecutionScope,
    AnalysisArtifactRecord,
    AnalysisKind,
    AnalysisQuerySnapshotRecord,
    AnalysisRecord,
    ConcordanceAnalysisRequest,
    Failure,
    Node,
    Progress,
    Tab,
    TokenFrequencyAnalysisRequest,
    Workspace,
)
from ldaca_wordflow.infrastructure.storage.workspace_access import (
    read_workspace_owner,
    write_workspace_owner,
)
from ldaca_wordflow.infrastructure.storage.workspace_store import WorkspaceStore

from ldaca_wordflow.shared.errors import (
    InvalidWorkspaceArchiveError,
    ResourceTooLargeError,
    UploadTooLargeError,
)
from ldaca_wordflow.services.workspace_archives import (
    WorkspaceArchiveLimits,
    WorkspaceArchiveService,
    WorkspaceArchiveStorage,
    _create_workspace_export,
)
from ldaca_wordflow.infrastructure.storage.input_snapshots import (
    create_worker_input_snapshot,
    load_snapshot_node,
    rebase_worker_input_snapshot_sources,
)

from ._storage import unlimited_storage_admission
from ldaca_wordflow.services.response_snapshots import ResponseSnapshotService
from ldaca_wordflow.services.storage_admission import StorageReservation


class ByteSource:
    def __init__(self, content: bytes) -> None:
        self._content = content
        self._offset = 0

    async def read(self, size: int) -> bytes:
        chunk = self._content[self._offset : self._offset + size]
        self._offset += len(chunk)
        await anyio.sleep(0)
        return chunk


class BlockingSource:
    def __init__(self) -> None:
        self.blocked = anyio.Event()
        self._sent = False

    async def read(self, size: int) -> bytes:
        if not self._sent:
            self._sent = True
            return b"PK-partial"
        self.blocked.set()
        await anyio.sleep_forever()
        raise AssertionError("unreachable")


def test_export_rejects_single_node_before_crossing_hard_byte_limit(
    tmp_path: Path,
) -> None:
    """A single Parquet writer cannot overshoot the admitted export ceiling."""

    workspace = Workspace(name="bounded")
    workspace.add_node(
        Node(
            id=uuid.uuid4(),
            name="large",
            data=pl.DataFrame({"text": ["x" * 4096]}).lazy(),
        )
    )
    target = tmp_path / "response.zip"

    with pytest.raises(ResourceTooLargeError, match="Workspace export"):
        _create_workspace_export(workspace, tmp_path, target, 64)

    assert not target.exists()
    assert not list(tmp_path.glob(".workspace-export-stage-*"))


class FakeWorkspaceStorage:
    """Minimal injected storage contract with filesystem-backed discovery."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def workspace_staging_root(self) -> Path:
        path = self.root / ".staging"
        path.mkdir(parents=True, exist_ok=True)
        return path

    async def install_staged_archive(
        self,
        user_id: str,
        staging: Path,
        workspace_name: str,
        reservation: StorageReservation,
    ) -> dict[str, Any]:
        """Mirror the canonical UUID-directory final-install boundary."""

        workspace_id = str(uuid.uuid4())
        (staging / ".wordflow-safe-materialized-import").unlink()
        destination = self.root / workspace_id
        metadata_path = staging / "workspace.json"
        metadata = json.loads(metadata_path.read_text())
        workspace = metadata["workspace_metadata"]
        workspace["id"] = workspace_id
        workspace["name"] = workspace_name
        workspace["revision"] = 1
        workspace["created_at"] = "2026-01-01T00:00:00+00:00"
        workspace["modified_at"] = workspace["created_at"]
        metadata_path.write_text(json.dumps(metadata))
        write_workspace_owner(staging, user_id)
        await reservation.recheck_path(staging)
        os.replace(staging, destination)
        store = WorkspaceStore(
            max_nodes=10_000,
            max_snapshot_bytes=1024 * 1024 * 1024,
        )
        store.rebase_snapshot_sources(destination)
        loaded = store.load(destination).workspace
        for record in loaded.analyses.values():
            if record.query_snapshot is not None:
                rebase_worker_input_snapshot_sources(
                    destination / record.query_snapshot.relative_path,
                    workspace_id=uuid.UUID(workspace_id),
                )
        return {
            "id": workspace_id,
            "name": workspace_name,
            "description": "",
            "created_at": workspace["created_at"],
            "modified_at": workspace["modified_at"],
            "total_nodes": 0,
            "root_nodes": 0,
            "leaf_nodes": 0,
            "revision": 1,
        }


def _archive(
    entries: list[tuple[str | zipfile.ZipInfo, bytes]],
    *,
    compression: int = zipfile.ZIP_DEFLATED,
) -> bytes:
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=compression) as archive:
        for name, content in entries:
            archive.writestr(name, content)
    return stream.getvalue()


def _valid_archive(
    *,
    workspace_id: str | None = None,
    name: str = "Imported",
    tabs: list[dict[str, Any]] | None = None,
    analyses: list[dict[str, Any]] | None = None,
    data_schema_version: int = 1,
    node_id: str | None = None,
) -> bytes:
    resolved_node_id = node_id or str(uuid.uuid4())
    manifest = {
        "format": "wordflow-materialized-workspace",
        "data_schema_version": data_schema_version,
        "workspace": {
            "id": workspace_id or str(uuid.uuid4()),
            "name": name,
            "description": "",
            "created_at": None,
            "modified_at": None,
        },
        "nodes": [
            {
                "id": resolved_node_id,
                "name": "Values",
                "provenance": {"type": "source"},
                "document": None,
                "color": None,
                "tokenizer_model": None,
                "data_file": f"data/{resolved_node_id}.parquet",
            }
        ],
        "tabs": tabs or [],
        "analyses": analyses or [],
    }
    parquet = io.BytesIO()
    pl.DataFrame({"value": ["hello"]}).write_parquet(parquet)
    return _archive(
        [
            ("workspace/workspace.json", json.dumps(manifest).encode()),
            (f"workspace/data/{resolved_node_id}.parquet", parquet.getvalue()),
        ]
    )


def _set_encrypted_flag(content: bytes) -> bytes:
    modified = bytearray(content)
    for signature, flag_offset in ((b"PK\x03\x04", 6), (b"PK\x01\x02", 8)):
        position = 0
        while (position := modified.find(signature, position)) != -1:
            flags = struct.unpack_from("<H", modified, position + flag_offset)[0]
            struct.pack_into("<H", modified, position + flag_offset, flags | 1)
            position += 4
    return bytes(modified)


def _corrupt_first_member(content: bytes) -> bytes:
    modified = bytearray(content)
    local = modified.index(b"PK\x03\x04")
    filename_length, extra_length = struct.unpack_from("<HH", modified, local + 26)
    payload = local + 30 + filename_length + extra_length
    modified[payload] ^= 0x01
    return bytes(modified)


def _service(
    storage: FakeWorkspaceStorage,
    *,
    limits: WorkspaceArchiveLimits | None = None,
) -> WorkspaceArchiveService:
    limiter = anyio.CapacityLimiter(4)
    admission = unlimited_storage_admission(storage.root, limiter=limiter)
    return WorkspaceArchiveService(
        cast(WorkspaceArchiveStorage, storage),
        workspace_store=WorkspaceStore(
            max_nodes=10_000,
            max_snapshot_bytes=1024 * 1024 * 1024,
        ),
        response_snapshots=ResponseSnapshotService(
            storage.root / ".response-snapshots",
            admission,
            max_snapshot_bytes=1024 * 1024 * 1024,
            max_concurrent_snapshots=2,
            limiter=limiter,
        ),
        storage_admission=admission,
        max_export_bytes=1024 * 1024 * 1024,
        limits=limits or WorkspaceArchiveLimits(),
        limiter=limiter,
        upload_chunk_size=16,
    )


async def test_valid_archive_is_staged_then_atomically_installed(
    tmp_path: Path,
) -> None:
    storage = FakeWorkspaceStorage(tmp_path)
    workspace_id = str(uuid.uuid4())

    summary, omitted_tabs, omitted_analyses = await _service(storage).import_upload(
        "alice",
        "workspace.zip",
        ByteSource(_valid_archive(workspace_id=workspace_id)),
    )

    assert (omitted_tabs, omitted_analyses) == (0, 0)
    assert summary["id"] != workspace_id
    assert summary["name"] == "Imported"
    assert summary["revision"] == 1
    assert summary["created_at"] == summary["modified_at"]
    installed = tmp_path / cast(str, summary["id"])
    parquet_files = list((installed / "data").glob("*.parquet"))
    assert len(parquet_files) == 1
    assert pl.read_parquet(parquet_files[0]).to_dicts() == [{"value": "hello"}]
    assert read_workspace_owner(installed) == "alice"
    assert list((tmp_path / ".staging").iterdir()) == []


async def test_archive_round_trip_preserves_terminal_analysis_result_and_tab(
    tmp_path: Path,
) -> None:
    source = Workspace(name="Analysis archive", workspace_id=uuid.uuid4())
    node = source.add_node(
        Node(
            id=uuid.uuid4(),
            name="Corpus",
            data=pl.DataFrame({"text": ["hello"]}).lazy(),
            tokenizer_model="native:plain_words_en",
        )
    )
    timestamp = datetime.now(UTC)
    tab = Tab.create(
        kind=AnalysisKind.TOKEN_FREQUENCY,
        name="Frequency",
        timestamp=timestamp,
    )
    source.add_tab(tab)
    analysis = AnalysisRecord.create(
        TokenFrequencyAnalysisRequest(
            node_ids=[node.id],
            node_columns={node.id: "text"},
            node_tokenizer_models={node.id: "native:plain_words_en"},
        ),
        tab_id=tab.id,
        execution_scope=AnalysisExecutionScope.RUN_ALL,
        timestamp=timestamp,
    ).start(timestamp)
    artifact_relative = "artifacts/tokens.arrows"
    artifact = tmp_path / "analyses" / str(analysis.id) / artifact_relative
    artifact.parent.mkdir(parents=True)
    artifact.write_bytes(b"strict artifact fixture")
    analysis = analysis.succeed(
        timestamp,
        result_payload={
            "metadata": {"effective_token_limit": 100},
            "tables": {
                "version": 1,
                "nodes": [
                    {
                        "node_id": str(node.id),
                        "node_name": node.name,
                        "table": {
                            "table_id": "tokens",
                            "artifact": {
                                "name": "tokens",
                                "media_type": "application/vnd.apache.arrow.stream",
                            },
                        },
                    }
                ],
                "statistics": None,
            },
        },
        artifact_references=[
            AnalysisArtifactRecord(
                name="tokens",
                relative_path=artifact_relative,
                media_type="application/vnd.apache.arrow.stream",
            )
        ],
    )
    source.add_analysis(analysis)
    exported = tmp_path / "analysis.zip"
    _create_workspace_export(source, tmp_path, exported, 1024 * 1024)
    with zipfile.ZipFile(exported) as archive:
        manifest = json.loads(archive.read("workspace/workspace.json"))
    assert manifest["data_schema_version"] == 1
    assert len(manifest["analyses"]) == 1

    storage = FakeWorkspaceStorage(tmp_path / "installed")
    summary, omitted_tabs, omitted_analyses = await _service(storage).import_upload(
        "alice",
        "analysis.zip",
        ByteSource(exported.read_bytes()),
    )
    assert (omitted_tabs, omitted_analyses) == (0, 0)
    installed = storage.root / cast(str, summary["id"])
    loaded = WorkspaceStore(
        max_nodes=10_000,
        max_snapshot_bytes=1024 * 1024 * 1024,
    ).load(installed).workspace

    assert loaded.tabs[tab.id].analysis_ids == [analysis.id]
    assert loaded.nodes[node.id].tokenizer_model == "native:plain_words_en"
    restored = loaded.analyses[analysis.id]
    assert restored.request == analysis.request
    assert restored.result_payload == analysis.result_payload
    assert restored.artifact_references == analysis.artifact_references
    assert restored.state == analysis.state


async def test_archive_round_trip_preserves_query_snapshot(
    tmp_path: Path,
) -> None:
    source_root = tmp_path / "source"
    (source_root / "data").mkdir(parents=True)
    source = Workspace(name="Query archive", workspace_id=uuid.uuid4())
    node = source.add_node(
        Node(
            id=uuid.uuid4(),
            name="Corpus",
            data=pl.DataFrame({"text": ["one", "two"]}).lazy(),
        )
    )
    timestamp = datetime.now(UTC)
    tab = Tab.create(
        kind=AnalysisKind.CONCORDANCE,
        name="Concordance",
        timestamp=timestamp,
    )
    source.add_tab(tab)
    analysis = AnalysisRecord.create(
        ConcordanceAnalysisRequest(
            node_ids=[node.id],
            node_columns={node.id: "text"},
            search_word="one",
        ),
        tab_id=tab.id,
        execution_scope=AnalysisExecutionScope.PREVIEW,
        timestamp=timestamp,
    ).start(timestamp)
    query_relative = f"analyses/{analysis.id}/query-input"
    create_worker_input_snapshot(
        workspace_id=source.id,
        node_ids=[node.id],
        workspace=source,
        workspace_data_dir=source_root / "data",
        snapshot_dir=source_root / query_relative,
        max_snapshot_bytes=1024 * 1024,
    )
    analysis = analysis.succeed(
        timestamp,
        result_payload={"ready": True},
        query_snapshot=AnalysisQuerySnapshotRecord(relative_path=query_relative),
    )
    source.add_analysis(analysis)
    exported = tmp_path / "query-analysis.zip"
    _create_workspace_export(source, source_root, exported, 1024 * 1024)

    storage = FakeWorkspaceStorage(tmp_path / "installed-query")
    summary, omitted_tabs, omitted_analyses = await _service(storage).import_upload(
        "alice",
        "query-analysis.zip",
        ByteSource(exported.read_bytes()),
    )
    assert (omitted_tabs, omitted_analyses) == (0, 0)
    installed = storage.root / cast(str, summary["id"])
    loaded = WorkspaceStore(
        max_nodes=10_000,
        max_snapshot_bytes=1024 * 1024 * 1024,
    ).load(installed).workspace
    restored_record = loaded.analyses[analysis.id]
    assert restored_record.artifact_references == []
    restored_snapshot = installed / query_relative
    restored_node = load_snapshot_node(restored_snapshot, node.id)
    assert restored_node.data.collect().to_dicts() == [
        {"text": "one"},
        {"text": "two"},
    ]
    assert json.loads((restored_snapshot / "snapshot.json").read_text())[
        "workspace_id"
    ] == cast(str, summary["id"])


async def test_archive_rejects_unsupported_data_schema_version(tmp_path: Path) -> None:
    storage = FakeWorkspaceStorage(tmp_path)

    with pytest.raises(InvalidWorkspaceArchiveError):
        await _service(storage).import_upload(
            "alice",
            "workspace.zip",
            ByteSource(_valid_archive(data_schema_version=22)),
        )

    assert list((tmp_path / ".staging").iterdir()) == []


async def test_archive_rejects_legacy_format_22_manifest(tmp_path: Path) -> None:
    storage = FakeWorkspaceStorage(tmp_path)
    current = _valid_archive()
    with zipfile.ZipFile(io.BytesIO(current)) as source:
        entries = [(name, source.read(name)) for name in source.namelist()]
    rewritten: list[tuple[str | zipfile.ZipInfo, bytes]] = []
    for name, content in entries:
        if name == "workspace/workspace.json":
            manifest = json.loads(content)
            manifest["version"] = 22
            manifest.pop("data_schema_version")
            content = json.dumps(manifest).encode()
        rewritten.append((name, content))

    with pytest.raises(InvalidWorkspaceArchiveError):
        await _service(storage).import_upload(
            "alice",
            "workspace.zip",
            ByteSource(_archive(rewritten)),
        )

    assert list((tmp_path / ".staging").iterdir()) == []


async def test_archive_omits_incompatible_analysis_and_keeps_data(
    tmp_path: Path,
) -> None:
    storage = FakeWorkspaceStorage(tmp_path)
    node_id = uuid.uuid4()
    timestamp = datetime.now(UTC)
    tab = Tab.create(
        kind=AnalysisKind.CONCORDANCE,
        name="Concordance",
        timestamp=timestamp,
    )
    analysis = AnalysisRecord.create(
        ConcordanceAnalysisRequest(
            node_ids=[node_id],
            node_columns={node_id: "value"},
            search_word="hello",
        ),
        tab_id=tab.id,
        execution_scope=AnalysisExecutionScope.PREVIEW,
        timestamp=timestamp,
    ).start(timestamp).fail(
        timestamp,
        failure=Failure(code="test_failure", message="Test failure"),
        progress=Progress(fraction=0.5, message="Failed"),
    )
    tab.analysis_ids.append(analysis.id)
    tabs = [
        {
            "id": str(tab.id),
            "analysis_kind": tab.kind.value,
            "schema_version": 1,
            "payload": tab.model_dump(mode="json"),
        }
    ]
    analyses = [
        {
            "id": str(analysis.id),
            "tab_id": str(tab.id),
            "analysis_kind": AnalysisKind.CONCORDANCE.value,
            "schema_version": 2,
            "payload": analysis.model_dump(mode="json"),
            "query_inputs": [],
        }
    ]

    summary, omitted_tabs, omitted_analyses = await _service(storage).import_upload(
        "alice",
        "workspace.zip",
        ByteSource(
            _valid_archive(
                node_id=str(node_id),
                tabs=tabs,
                analyses=analyses,
            )
        ),
    )

    assert (omitted_tabs, omitted_analyses) == (0, 1)
    installed = storage.root / cast(str, summary["id"])
    loaded = WorkspaceStore(
        max_nodes=10_000,
        max_snapshot_bytes=1024 * 1024 * 1024,
    ).load(installed).workspace
    assert loaded.nodes[node_id].data.collect().to_dicts() == [{"value": "hello"}]
    assert loaded.tabs[tab.id].analysis_ids == []
    assert loaded.analyses == {}
    assert loaded.unavailable_analysis_ids == set()


async def test_archive_omits_incompatible_tab_without_decoding_payload(
    tmp_path: Path,
) -> None:
    storage = FakeWorkspaceStorage(tmp_path)
    tab_id = uuid.uuid4()
    analysis_id = uuid.uuid4()
    tabs = [
        {
            "id": str(tab_id),
            "analysis_kind": AnalysisKind.CONCORDANCE.value,
            "schema_version": 2,
            "payload": {"future": "tab payload"},
        }
    ]
    analyses = [
        {
            "id": str(analysis_id),
            "tab_id": str(tab_id),
            "analysis_kind": AnalysisKind.CONCORDANCE.value,
            "schema_version": 1,
            "payload": {"invalid": "but owned by the omitted Tab"},
            "query_inputs": [],
        }
    ]

    summary, omitted_tabs, omitted_analyses = await _service(storage).import_upload(
        "alice",
        "workspace.zip",
        ByteSource(_valid_archive(tabs=tabs, analyses=analyses)),
    )

    assert (omitted_tabs, omitted_analyses) == (1, 1)
    installed = storage.root / cast(str, summary["id"])
    loaded = WorkspaceStore(
        max_nodes=10_000,
        max_snapshot_bytes=1024 * 1024 * 1024,
    ).load(installed).workspace
    assert loaded.tabs == {}
    assert loaded.analyses == {}


async def test_archive_rejects_duplicate_root_analysis_tab_references(
    tmp_path: Path,
) -> None:
    storage = FakeWorkspaceStorage(tmp_path)
    timestamp = datetime.now(UTC)
    node_id = uuid.uuid4()
    first_tab = Tab.create(
        kind=AnalysisKind.CONCORDANCE,
        name="First",
        timestamp=timestamp,
    )
    second_tab = Tab.create(
        kind=AnalysisKind.CONCORDANCE,
        name="Second",
        timestamp=timestamp,
    )
    analysis = AnalysisRecord.create(
        ConcordanceAnalysisRequest(
            node_ids=[node_id],
            node_columns={node_id: "value"},
            search_word="hello",
        ),
        tab_id=first_tab.id,
        execution_scope=AnalysisExecutionScope.PREVIEW,
        timestamp=timestamp,
    ).start(timestamp).fail(
        timestamp,
        failure=Failure(code="test_failure", message="Test failure"),
        progress=Progress(fraction=0.5, message="Failed"),
    )
    first_tab.analysis_ids.append(analysis.id)
    second_tab.analysis_ids.append(analysis.id)
    tabs = [
        {
            "id": str(tab.id),
            "analysis_kind": tab.kind.value,
            "schema_version": 1,
            "payload": tab.model_dump(mode="json"),
        }
        for tab in (first_tab, second_tab)
    ]
    analyses = [
        {
            "id": str(analysis.id),
            "tab_id": str(first_tab.id),
            "analysis_kind": AnalysisKind.CONCORDANCE.value,
            "schema_version": 1,
            "payload": analysis.model_dump(mode="json"),
            "query_inputs": [],
        }
    ]

    with pytest.raises(InvalidWorkspaceArchiveError):
        await _service(storage).import_upload(
            "alice",
            "workspace.zip",
            ByteSource(
                _valid_archive(
                    tabs=tabs,
                    analyses=analyses,
                    node_id=str(node_id),
                )
            ),
        )

    assert list((tmp_path / ".staging").iterdir()) == []


async def test_cancelled_archive_upload_cleans_seekable_temp(tmp_path: Path) -> None:
    storage = FakeWorkspaceStorage(tmp_path)
    source = BlockingSource()

    async with anyio.create_task_group() as tasks:
        tasks.start_soon(
            _service(storage).import_upload,
            "alice",
            "workspace.zip",
            source,
        )
        await source.blocked.wait()
        tasks.cancel_scope.cancel()

    assert list((tmp_path / ".staging").iterdir()) == []


async def test_archive_upload_enforces_actual_compressed_byte_limit(
    tmp_path: Path,
) -> None:
    storage = FakeWorkspaceStorage(tmp_path)
    archive = _valid_archive()
    limits = WorkspaceArchiveLimits(max_archive_bytes=len(archive) - 1)

    with pytest.raises(UploadTooLargeError) as captured:
        await _service(storage, limits=limits).import_upload(
            "alice", "workspace.zip", ByteSource(archive)
        )

    assert captured.value.code == "upload_too_large"
    assert list((tmp_path / ".staging").iterdir()) == []


@pytest.mark.parametrize(
    "entry_name",
    [
        "../workspace.json",
        "/absolute/workspace.json",
        r"C:\\workspace\\workspace.json",
        r"\\\\server\\share\\workspace.json",
        "workspace\\workspace.json",
    ],
)
async def test_archive_rejects_traversal_and_platform_absolute_paths(
    tmp_path: Path,
    entry_name: str,
) -> None:
    storage = FakeWorkspaceStorage(tmp_path)
    archive = _archive([(entry_name, b"{}")])

    with pytest.raises(InvalidWorkspaceArchiveError):
        await _service(storage).import_upload(
            "alice", "workspace.zip", ByteSource(archive)
        )

    assert list((tmp_path / ".staging").iterdir()) == []


@pytest.mark.parametrize("kind", ["symlink", "special"])
async def test_archive_rejects_symlink_and_special_members(
    tmp_path: Path,
    kind: str,
) -> None:
    storage = FakeWorkspaceStorage(tmp_path)
    info = zipfile.ZipInfo("workspace/payload")
    info.create_system = 3
    file_kind = stat.S_IFLNK if kind == "symlink" else stat.S_IFIFO
    info.external_attr = (file_kind | 0o644) << 16
    archive = _archive(
        [
            (
                "workspace/workspace.json",
                json.dumps(
                    {"workspace_metadata": {"id": str(uuid.uuid4()), "name": "Bad"}}
                ).encode(),
            ),
            (info, b"target"),
        ]
    )

    with pytest.raises(InvalidWorkspaceArchiveError):
        await _service(storage).import_upload(
            "alice", "workspace.zip", ByteSource(archive)
        )


@pytest.mark.parametrize(
    "colliding_names",
    [
        ("workspace/Data.txt", "workspace/data.TXT"),
        (
            "workspace/" + unicodedata.normalize("NFC", "cafe\u0301") + ".txt",
            "workspace/" + unicodedata.normalize("NFD", "café") + ".txt",
        ),
    ],
)
async def test_archive_rejects_case_and_unicode_normalized_collisions(
    tmp_path: Path,
    colliding_names: tuple[str, str],
) -> None:
    storage = FakeWorkspaceStorage(tmp_path)
    archive = _archive(
        [
            (
                "workspace/workspace.json",
                json.dumps(
                    {"workspace_metadata": {"id": str(uuid.uuid4()), "name": "Bad"}}
                ).encode(),
            ),
            (colliding_names[0], b"one"),
            (colliding_names[1], b"two"),
        ]
    )

    with pytest.raises(InvalidWorkspaceArchiveError):
        await _service(storage).import_upload(
            "alice", "workspace.zip", ByteSource(archive)
        )


async def test_archive_rejects_encryption_and_bad_crc(tmp_path: Path) -> None:
    storage = FakeWorkspaceStorage(tmp_path)
    encrypted = _set_encrypted_flag(_valid_archive())
    corrupt = _corrupt_first_member(
        _archive(
            [
                (
                    "workspace/workspace.json",
                    json.dumps(
                        {
                            "workspace_metadata": {
                                "id": str(uuid.uuid4()),
                                "name": "Corrupt",
                            }
                        }
                    ).encode(),
                )
            ],
            compression=zipfile.ZIP_STORED,
        )
    )

    for content in (encrypted, corrupt):
        with pytest.raises(InvalidWorkspaceArchiveError):
            await _service(storage).import_upload(
                "alice", "workspace.zip", ByteSource(content)
            )


@pytest.mark.parametrize(
    ("limits", "archive"),
    [
        (
            WorkspaceArchiveLimits(max_members=1),
            _valid_archive(),
        ),
        (
            WorkspaceArchiveLimits(max_member_bytes=4),
            _valid_archive(),
        ),
        (
            WorkspaceArchiveLimits(max_expanded_bytes=8),
            _valid_archive(),
        ),
        (
            WorkspaceArchiveLimits(max_compression_ratio=2.0),
            _archive(
                [
                    (
                        "workspace.json",
                        json.dumps(
                            {
                                "workspace_metadata": {
                                    "id": str(uuid.uuid4()),
                                    "name": "Bomb",
                                }
                            }
                        ).encode(),
                    ),
                    ("bomb.txt", b"A" * 10_000),
                ]
            ),
        ),
    ],
)
async def test_archive_limits_reject_member_count_size_and_ratio(
    tmp_path: Path,
    limits: WorkspaceArchiveLimits,
    archive: bytes,
) -> None:
    storage = FakeWorkspaceStorage(tmp_path)

    with pytest.raises(InvalidWorkspaceArchiveError):
        await _service(storage, limits=limits).import_upload(
            "alice", "workspace.zip", ByteSource(archive)
        )


async def test_archive_rejects_deployment_access_sidecar(
    tmp_path: Path,
) -> None:
    storage = FakeWorkspaceStorage(tmp_path)
    stream = io.BytesIO(_valid_archive())
    with zipfile.ZipFile(stream, "a", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("workspace/access.json", '{"owner_id":"attacker"}')

    with pytest.raises(InvalidWorkspaceArchiveError):
        await _service(storage).import_upload(
            "alice", "workspace.zip", ByteSource(stream.getvalue())
        )

    assert list((tmp_path / ".staging").iterdir()) == []
