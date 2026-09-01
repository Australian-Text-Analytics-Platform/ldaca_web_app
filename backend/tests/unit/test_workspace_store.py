"""Strict workspace aggregate and snapshot persistence invariants."""

from __future__ import annotations

import json
import os
import shutil
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import polars as pl
import pytest
from polars_source_utils import list_source_paths

from ldaca_wordflow.domain.workspace import (
    AnalysisExecutionScope,
    AnalysisRecord,
    AnalysisKind,
    ConcordanceAnalysisRequest,
    ConcordanceRunAllAnalysisRequest,
    DerivationInput,
    DerivationProvenance,
    Node,
    Tab,
    Workspace,
    node_reference,
)
from ldaca_wordflow.domain.workspace.provenance import CloneDerivation
from ldaca_wordflow.infrastructure.storage.workspace_store import (
    WorkspaceCapacityError,
    WorkspaceSchemaVersionError,
    WorkspaceSnapshotInvalidError,
    WorkspaceStore,
)
from ldaca_wordflow.infrastructure.storage import workspace_store as store_module


def _store() -> WorkspaceStore:
    return WorkspaceStore(max_nodes=20, max_snapshot_bytes=8 * 1024 * 1024)


def _node(name: str, *, parents: list[Node] | None = None) -> Node:
    resolved_parents = parents or []
    return Node(
        id=uuid.uuid4(),
        name=name,
        data=pl.DataFrame({"text": [name]}).lazy(),
        parents=resolved_parents,
        provenance=(
            DerivationProvenance(
                operation=CloneDerivation(),
                inputs=[
                    DerivationInput(
                        role="source",
                        value=node_reference(resolved_parents[0].id),
                    )
                ],
            )
            if resolved_parents
            else None
        ),
    )


def _committed_graph(path: Path) -> tuple[WorkspaceStore, Workspace, Node, Node]:
    store = _store()
    workspace = Workspace(name="strict")
    parent = workspace.add_node(_node("parent"))
    child = workspace.add_node(_node("child", parents=[parent]))
    store.commit(path, workspace, expected_revision=None)
    return store, workspace, parent, child


def _rewrite_workspace_snapshot(path: Path, mutate) -> None:
    snapshot_path = path / "workspace.json"
    payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
    mutate(payload)
    snapshot_path.write_text(json.dumps(payload), encoding="utf-8")


def _clone_provenance(node_id: uuid.UUID) -> dict[str, object]:
    return {
        "type": "derivation",
        "operation": {"kind": "clone"},
        "inputs": [
            {
                "role": "source",
                "value": {"type": "node", "node_id": str(node_id)},
            }
        ],
    }


def test_load_resolves_forward_references_and_preserves_persisted_order(
    tmp_path: Path,
) -> None:
    store = _store()
    path = tmp_path / "workspace"
    workspace = Workspace(name="forward")
    parent = workspace.add_node(_node("parent"))
    child = workspace.add_node(_node("child", parents=[parent]))
    workspace.reorder_nodes([child.id, parent.id])
    store.commit(path, workspace, expected_revision=None)

    loaded = store.load(path).workspace

    assert list(loaded.nodes) == [child.id, parent.id]
    assert loaded.nodes[child.id].parents == [loaded.nodes[parent.id]]


def test_native_round_trip_preserves_tokenizer_and_rejects_previous_schema(
    tmp_path: Path,
) -> None:
    path = tmp_path / "workspace"
    store = _store()
    workspace = Workspace(name="tokenizer")
    node = _node("source")
    node.tokenizer_model = "lindera:jieba"
    workspace.add_node(node)
    store.commit(path, workspace, expected_revision=None)

    loaded = store.load(path).workspace
    assert loaded.nodes[node.id].tokenizer_model == "lindera:jieba"

    _rewrite_workspace_snapshot(
        path,
        lambda payload: payload["workspace_metadata"].update({"version": 22}),
    )
    with pytest.raises(WorkspaceSchemaVersionError) as exc_info:
        store.load(path)
    assert exc_info.value.stored_version == 22
    assert exc_info.value.supported_version == 23


@pytest.mark.parametrize("invalid_graph", ["missing", "self", "cycle", "duplicate"])
def test_load_rejects_invalid_parent_graph(tmp_path: Path, invalid_graph: str) -> None:
    path = tmp_path / "workspace"
    store, _workspace, parent, child = _committed_graph(path)

    def mutate(payload: dict) -> None:
        nodes = payload["nodes"]
        by_id = {entry["node_metadata"]["id"]: entry for entry in nodes}
        if invalid_graph == "missing":
            by_id[str(child.id)]["node_metadata"]["provenance"] = _clone_provenance(
                uuid.uuid4()
            )
        elif invalid_graph == "self":
            by_id[str(child.id)]["node_metadata"]["provenance"] = _clone_provenance(
                child.id
            )
        elif invalid_graph == "cycle":
            by_id[str(parent.id)]["node_metadata"]["provenance"] = _clone_provenance(
                child.id
            )
        else:
            nodes.append(dict(nodes[0]))

    _rewrite_workspace_snapshot(path, mutate)

    with pytest.raises(WorkspaceSnapshotInvalidError):
        store.load(path)


def test_workspace_rejects_duplicate_registration(tmp_path: Path) -> None:
    workspace = Workspace(name="strict")
    node = workspace.add_node(_node("one"))

    with pytest.raises(ValueError, match="already contains"):
        workspace.add_node(node)


def test_workspace_rejects_cross_workspace_registration(tmp_path: Path) -> None:
    first = Workspace(name="first")
    second = Workspace(name="second")
    node = first.add_node(_node("owned"))

    with pytest.raises(ValueError, match="another workspace"):
        second.add_node(node)

    assert node.workspace is first
    assert node.id in first.nodes
    assert node.id not in second.nodes


def test_children_index_tracks_registration_and_removal_rewiring() -> None:
    workspace = Workspace(name="indexed")
    grandparent = workspace.add_node(_node("grandparent"))
    parent = workspace.add_node(_node("parent", parents=[grandparent]))
    child = workspace.add_node(_node("child", parents=[parent]))

    assert grandparent.children == [parent]
    assert parent.children == [child]
    assert workspace.remove_node(parent.id)

    assert grandparent.children == [child]
    assert child.parents == [grandparent]
    assert parent.workspace is None
    assert parent.parents == []


@pytest.mark.parametrize(
    "invalid_order",
    [
        lambda first, second: [first],
        lambda first, second: [first, first],
        lambda first, second: [first, str(uuid.uuid4())],
    ],
)
def test_reorder_requires_an_exact_duplicate_free_permutation(invalid_order) -> None:
    workspace = Workspace(name="ordered")
    first = workspace.add_node(_node("first"))
    second = workspace.add_node(_node("second"))

    with pytest.raises(ValueError, match="exact duplicate-free permutation"):
        workspace.reorder_nodes(invalid_order(first.id, second.id))

    assert list(workspace.nodes) == [first.id, second.id]


def test_smart_placement_rejects_an_unregistered_node() -> None:
    workspace = Workspace(name="strict")
    foreign = _node("foreign")

    with pytest.raises(ValueError, match="must belong"):
        workspace.place_node_after_parent(foreign)


def test_commit_reports_capacity_separately_from_invalid_snapshots(
    tmp_path: Path,
) -> None:
    workspace = Workspace(name="bounded")
    workspace.add_node(_node("large"))
    store = WorkspaceStore(max_nodes=1, max_snapshot_bytes=1)

    with pytest.raises(WorkspaceCapacityError):
        store.commit(tmp_path / "workspace", workspace, expected_revision=None)


def test_failed_metadata_publication_preserves_previous_generation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = tmp_path / "workspace"
    store, workspace, parent, _child = _committed_graph(path)
    committed = (path / "workspace.json").read_bytes()
    plans_before = set((path / "data").glob("*.plbin"))
    parent.data = pl.DataFrame({"text": ["changed"]}).lazy()

    def fail_metadata(*_args, **_kwargs):
        raise OSError("simulated metadata failure")

    monkeypatch.setattr(store_module, "atomic_write_json", fail_metadata)
    with pytest.raises(Exception, match="could not be serialized"):
        store.commit(path, workspace, expected_revision=1)

    assert (path / "workspace.json").read_bytes() == committed
    assert set((path / "data").glob("*.plbin")) == plans_before


def test_tab_generations_follow_the_workspace_commit_point(tmp_path: Path) -> None:
    path = tmp_path / "workspace"
    store = _store()
    workspace = Workspace(name="tabs")
    created_at = datetime.now(UTC)
    tab = workspace.add_tab(
        Tab.create(
            kind=AnalysisKind.CONCORDANCE,
            name="First",
            timestamp=created_at,
        )
    )

    first = store.commit(path, workspace, expected_revision=None)
    first_payload = json.loads((path / "workspace.json").read_text(encoding="utf-8"))
    first_record = path / first_payload["tabs"][0]["record_path"]

    tab.name = "Second"
    tab.modified_at = created_at + timedelta(seconds=1)
    tab.revision += 1
    second = store.commit(path, workspace, expected_revision=first.revision)
    second_payload = json.loads((path / "workspace.json").read_text(encoding="utf-8"))
    second_record = path / second_payload["tabs"][0]["record_path"]

    assert first_payload["workspace_metadata"]["version"] == 23
    assert first_record != second_record
    assert not first_record.exists()
    assert second_record.exists()
    assert list(second_record.parent.iterdir()) == [second_record]
    assert store.load(path).workspace.tabs[tab.id] == tab
    assert second.revision == 2


def test_failed_tab_metadata_publication_keeps_the_committed_generation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = tmp_path / "workspace"
    store = _store()
    workspace = Workspace(name="tabs")
    tab = workspace.add_tab(
        Tab.create(
            kind=AnalysisKind.QUOTATION,
            name="Committed",
            timestamp=datetime.now(UTC),
        )
    )
    store.commit(path, workspace, expected_revision=None)
    committed = (path / "workspace.json").read_bytes()
    records_before = set((path / "tabs" / str(tab.id)).glob("*.json"))
    real_atomic_write = store_module.atomic_write_json

    def fail_workspace_metadata(target, data, **kwargs):
        if Path(target).name == "workspace.json":
            raise OSError("simulated metadata failure")
        return real_atomic_write(target, data, **kwargs)

    tab.name = "Uncommitted"
    tab.revision += 1
    monkeypatch.setattr(store_module, "atomic_write_json", fail_workspace_metadata)

    with pytest.raises(Exception, match="could not be serialized"):
        store.commit(path, workspace, expected_revision=1)

    assert (path / "workspace.json").read_bytes() == committed
    assert set((path / "tabs" / str(tab.id)).glob("*.json")) == records_before


def test_analysis_records_round_trip_with_root_and_child_ownership(
    tmp_path: Path,
) -> None:
    path = tmp_path / "workspace"
    store = _store()
    workspace = Workspace(name="analyses")
    node_id = uuid.uuid4()
    tab = workspace.add_tab(
        Tab.create(
            kind=AnalysisKind.CONCORDANCE,
            name="Concordance",
            timestamp=datetime.now(UTC),
        )
    )
    source_request = ConcordanceAnalysisRequest(
        node_ids=[node_id],
        node_columns={node_id: "text"},
        search_word="word",
    )
    root = workspace.add_analysis(
        AnalysisRecord.create(
            source_request,
            tab_id=tab.id,
            execution_scope=AnalysisExecutionScope.PREVIEW,
            timestamp=datetime.now(UTC),
        )
    )
    child = workspace.add_analysis(
        AnalysisRecord.create(
            ConcordanceRunAllAnalysisRequest(
                source=source_request,
            ),
            tab_id=tab.id,
            execution_scope=AnalysisExecutionScope.SUPPORTING,
            timestamp=datetime.now(UTC),
            parent_analysis_id=root.id,
        )
    )

    committed = store.commit(path, workspace, expected_revision=None)
    loaded = store.load(path).workspace

    assert committed.analysis_count == 2
    assert loaded.analyses[root.id] == root
    assert loaded.analyses[child.id] == child
    assert loaded.analysis_children(root.id) == [child]


def test_invalid_stored_result_is_isolated_without_rewriting_its_record(
    tmp_path: Path,
) -> None:
    path = tmp_path / "workspace"
    store = _store()
    workspace = Workspace(name="result integrity")
    timestamp = datetime.now(UTC)
    tab = workspace.add_tab(
        Tab.create(
            kind=AnalysisKind.CONCORDANCE,
            name="Concordance",
            timestamp=timestamp,
        )
    )
    node_id = uuid.uuid4()
    record = AnalysisRecord.create(
        ConcordanceAnalysisRequest(
            node_ids=[node_id],
            node_columns={node_id: "text"},
            search_word="word",
        ),
        tab_id=tab.id,
        execution_scope=AnalysisExecutionScope.PREVIEW,
        timestamp=timestamp,
    ).start(timestamp).succeed(timestamp, result_payload={"ready": True})
    workspace.add_analysis(record)
    store.commit(path, workspace, expected_revision=None)

    metadata = json.loads((path / "workspace.json").read_text())
    reference = next(
        item for item in metadata["analyses"] if item["id"] == str(record.id)
    )
    record_path = path / reference["record_path"]
    payload = json.loads(record_path.read_text())
    payload["result_payload"] = {"ready": "yes"}
    record_path.write_text(json.dumps(payload), encoding="utf-8")
    before = record_path.read_bytes()

    loaded = store.load(path).workspace

    assert record.id not in loaded.analyses
    assert record.id in loaded.corrupt_analysis_ids
    assert record_path.read_bytes() == before


def test_detached_analysis_remains_persisted_but_is_not_live(
    tmp_path: Path,
) -> None:
    path = tmp_path / "workspace"
    store = _store()
    workspace = Workspace(name="detached analysis")
    node_id = uuid.uuid4()
    root = workspace.add_analysis(
        AnalysisRecord.create(
            ConcordanceAnalysisRequest(
                node_ids=[node_id],
                node_columns={node_id: "text"},
                search_word="word",
            ),
            tab_id=uuid.uuid4(),
            execution_scope=AnalysisExecutionScope.PREVIEW,
            timestamp=datetime.now(UTC),
        ),
        link_to_tab=False,
    )

    store.commit(path, workspace, expected_revision=None)
    loaded = store.load(path).workspace

    assert loaded.analyses[root.id] == root
    assert loaded.live_analysis_ids() == set()
    assert loaded.reserved_node_ids() == {node_id}


def test_analysis_private_execution_storage_survives_commits_until_record_removal(
    tmp_path: Path,
) -> None:
    path = tmp_path / "workspace"
    store = _store()
    workspace = Workspace(name="execution storage")
    node_id = uuid.uuid4()
    root = workspace.add_analysis(
        AnalysisRecord.create(
            ConcordanceAnalysisRequest(
                node_ids=[node_id],
                node_columns={node_id: "text"},
                search_word="word",
            ),
            tab_id=uuid.uuid4(),
            execution_scope=AnalysisExecutionScope.PREVIEW,
            timestamp=datetime.now(UTC),
        ),
        link_to_tab=False,
    )
    store.commit(path, workspace, expected_revision=None)
    private = path / "analyses" / str(root.id) / ".execution" / "input"
    private.mkdir(parents=True)
    (private / "snapshot.json").write_text("{}", encoding="utf-8")

    store.commit(path, workspace, expected_revision=1)

    assert (private / "snapshot.json").is_file()
    workspace.remove_analysis(root.id)
    store.commit(path, workspace, expected_revision=2)
    assert not (path / "analyses" / str(root.id)).exists()


def test_corrupt_analysis_is_isolated_and_preserved_across_tab_mutation(
    tmp_path: Path,
) -> None:
    path = tmp_path / "workspace"
    store = _store()
    workspace = Workspace(name="corrupt analysis")
    node_id = uuid.uuid4()
    tab = workspace.add_tab(
        Tab.create(
            kind=AnalysisKind.CONCORDANCE,
            name="Healthy tab",
            timestamp=datetime.now(UTC),
        )
    )
    root = workspace.add_analysis(
        AnalysisRecord.create(
            ConcordanceAnalysisRequest(
                node_ids=[node_id],
                node_columns={node_id: "text"},
                search_word="word",
            ),
            tab_id=tab.id,
            execution_scope=AnalysisExecutionScope.PREVIEW,
            timestamp=datetime.now(UTC),
        )
    )
    store.commit(path, workspace, expected_revision=None)
    payload = json.loads((path / "workspace.json").read_text(encoding="utf-8"))
    analysis_path = path / payload["analyses"][0]["record_path"]
    invalid_bytes = b"not valid analysis json"
    analysis_path.write_bytes(invalid_bytes)

    loaded = store.load(path).workspace
    assert loaded.tabs[tab.id].name == "Healthy tab"
    assert loaded.analyses == {}
    assert loaded.corrupt_analysis_ids == {root.id}
    assert loaded.corrupt_analysis_bytes(root.id) == invalid_bytes

    loaded.tabs[tab.id].name = "Renamed around corruption"
    second = store.commit(path, loaded, expected_revision=1)
    second_payload = json.loads((path / "workspace.json").read_text(encoding="utf-8"))
    preserved = path / second_payload["analyses"][0]["record_path"]

    assert second.revision == 2
    assert preserved.read_bytes() == invalid_bytes
    assert store.load(path).workspace.corrupt_analysis_ids == {root.id}


@pytest.mark.parametrize("revision", [True, 1.0, "1"])
def test_inspect_rejects_coerced_revision_types(
    tmp_path: Path, revision: object
) -> None:
    path = tmp_path / "workspace"
    store, _workspace, _parent, _child = _committed_graph(path)
    _rewrite_workspace_snapshot(
        path,
        lambda payload: payload["workspace_metadata"].__setitem__("revision", revision),
    )

    with pytest.raises(WorkspaceSnapshotInvalidError):
        store.inspect(path)


@pytest.mark.parametrize("invalid_graph", ["self", "cycle", "invalid_roles"])
def test_inspect_rejects_invalid_topology(tmp_path: Path, invalid_graph: str) -> None:
    path = tmp_path / "workspace"
    store, _workspace, parent, child = _committed_graph(path)

    def mutate(payload: dict) -> None:
        by_id = {entry["node_metadata"]["id"]: entry for entry in payload["nodes"]}
        if invalid_graph == "self":
            by_id[str(child.id)]["node_metadata"]["provenance"] = _clone_provenance(
                child.id
            )
        elif invalid_graph == "cycle":
            by_id[str(parent.id)]["node_metadata"]["provenance"] = _clone_provenance(
                child.id
            )
        else:
            by_id[str(child.id)]["node_metadata"]["provenance"]["inputs"][0][
                "role"
            ] = "left"

    _rewrite_workspace_snapshot(path, mutate)

    with pytest.raises(WorkspaceSnapshotInvalidError):
        store.inspect(path)


def test_relocated_snapshot_rebase_is_copy_on_write_and_keeps_revision(
    tmp_path: Path,
) -> None:
    original = tmp_path / "original"
    data = original / "data"
    data.mkdir(parents=True)
    source = data / "source.parquet"
    pl.DataFrame({"value": [1, 2]}).write_parquet(source)
    workspace = Workspace(name="movable")
    node = workspace.add_node(
        Node(name="source", data=pl.scan_parquet(source.resolve()))
    )
    store = _store()
    store.commit(original, workspace, expected_revision=None)

    moved = tmp_path / "moved"
    shutil.copytree(original, moved)
    shutil.rmtree(original)
    before = (moved / "workspace.json").read_bytes()

    relocated = store.rebase_snapshot_sources(moved)
    loaded = store.load(moved)

    assert relocated.revision == 1
    assert loaded.snapshot.revision == 1
    assert (moved / "workspace.json").read_bytes() != before
    collected = loaded.workspace.nodes[node.id].data.collect()
    assert collected["value"].to_list() == [1, 2]


def test_snapshot_can_be_compiled_and_validated_for_future_publication_root(
    tmp_path: Path,
) -> None:
    original = tmp_path / "original"
    data = original / "data"
    data.mkdir(parents=True)
    source = data / "source.parquet"
    pl.DataFrame({"value": [1, 2]}).write_parquet(source)
    workspace = Workspace(name="staged")
    node = workspace.add_node(
        Node(name="source", data=pl.scan_parquet(source.resolve()))
    )
    store = _store()
    store.commit(original, workspace, expected_revision=None)

    staging = tmp_path / "staging"
    future = tmp_path / "published"
    shutil.copytree(original, staging)
    shutil.rmtree(original)

    store.rebase_snapshot_sources(staging, published_root=future)
    validated = store.load(staging, published_root=future)
    plan = staging / json.loads((staging / "workspace.json").read_text())["nodes"][
        0
    ]["data_path"]

    assert not future.exists()
    assert list_source_paths(plan) == [str(future / "data" / "source.parquet")]
    assert validated.workspace.nodes[node.id].name == "source"

    os.replace(staging, future)
    collected = store.load(future).workspace.nodes[node.id].data.collect()
    assert collected["value"].to_list() == [1, 2]


def test_reconcile_removes_all_unreferenced_data_generations(tmp_path: Path) -> None:
    path = tmp_path / "workspace"
    store, _workspace, _parent, _child = _committed_graph(path)
    data = path / "data"
    orphan_plan = data / "orphan.plbin"
    orphan_source = data / "orphan.parquet"
    stale_hidden_artifact = data / ".materialized-analysis.parquet"
    orphan_plan.write_bytes(b"orphan")
    orphan_source.write_bytes(b"orphan")
    stale_hidden_artifact.write_bytes(b"obsolete analysis cache")

    snapshot = store.reconcile(path)

    assert snapshot.revision == 1
    assert not orphan_plan.exists()
    assert not orphan_source.exists()
    assert not stale_hidden_artifact.exists()


@pytest.mark.parametrize(
    ("target", "field"),
    [
        ("envelope", "extra"),
        ("metadata", "extra"),
        ("metadata", "description"),
    ],
)
def test_snapshot_rejects_noncanonical_schema_fields(
    tmp_path: Path,
    target: str,
    field: str,
) -> None:
    path = tmp_path / "workspace"
    store, _workspace, _parent, _child = _committed_graph(path)

    def mutate(payload: dict) -> None:
        container = payload if target == "envelope" else payload["workspace_metadata"]
        if field == "extra":
            container[field] = True
        else:
            del container[field]

    _rewrite_workspace_snapshot(path, mutate)

    with pytest.raises(WorkspaceSnapshotInvalidError):
        store.inspect(path)


@pytest.mark.skipif(not hasattr(Path, "symlink_to"), reason="symlinks unavailable")
def test_load_isolates_symlinked_plan_and_its_dependent(tmp_path: Path) -> None:
    path = tmp_path / "workspace"
    store, _workspace, parent, child = _committed_graph(path)
    payload = json.loads((path / "workspace.json").read_text(encoding="utf-8"))
    plan = path / payload["nodes"][0]["data_path"]
    real_plan = plan.with_suffix(".real")
    plan.rename(real_plan)
    try:
        plan.symlink_to(real_plan.name)
    except OSError:
        pytest.skip("symlink creation is unavailable")

    loaded = store.load(path).workspace

    assert loaded.nodes == {}
    assert loaded.unavailable_node_ids == {parent.id, child.id}
    assert plan.is_symlink()


def test_load_isolates_schema_mismatch_without_rewriting_healthy_sibling(
    tmp_path: Path,
) -> None:
    path = tmp_path / "workspace"
    store, _workspace, parent, child = _committed_graph(path)

    def corrupt_child_schema(payload: dict) -> None:
        by_id = {entry["node_metadata"]["id"]: entry for entry in payload["nodes"]}
        by_id[str(child.id)]["node_metadata"]["schema"][0]["dtype"] = "Boolean"

    _rewrite_workspace_snapshot(path, corrupt_child_schema)
    before = (path / "workspace.json").read_bytes()

    loaded = store.load(path).workspace

    assert list(loaded.nodes) == [parent.id]
    assert loaded.unavailable_node_ids == {child.id}
    assert (path / "workspace.json").read_bytes() == before


def test_load_isolates_invalid_node_fields_without_rewriting_healthy_sibling(
    tmp_path: Path,
) -> None:
    path = tmp_path / "workspace"
    store, _workspace, parent, child = _committed_graph(path)

    def remove_child_name(payload: dict) -> None:
        by_id = {entry["node_metadata"]["id"]: entry for entry in payload["nodes"]}
        del by_id[str(child.id)]["node_metadata"]["name"]

    _rewrite_workspace_snapshot(path, remove_child_name)
    before = (path / "workspace.json").read_bytes()

    loaded = store.load(path).workspace

    assert list(loaded.nodes) == [parent.id]
    assert loaded.unavailable_node_ids == {child.id}
    assert (path / "workspace.json").read_bytes() == before
