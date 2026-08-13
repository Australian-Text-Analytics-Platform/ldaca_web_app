"""Service-level Data Block Edit metadata and history behavior."""

from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import Any, cast

import anyio
import polars as pl
import pytest
import uuid

from ldaca_wordflow.domain.workspace import Node, Workspace
from ldaca_wordflow.models.node_resources import (
    AnnotationClassesNodeEditRequest,
    DeleteColumnNodeEditRequest,
    CloneNodeCreateRequest,
    RenameColumnNodeEditRequest,
    SetCellNodeEditRequest,
    NodeUpdateRequest,
)
from ldaca_wordflow.services.nodes import NodeService
from ldaca_wordflow.services.node_operations import build_derived_node
from ldaca_wordflow.shared.errors import InvalidInputError


class _WorkspaceGate:
    def __init__(self, workspace: Workspace) -> None:
        self.workspace = workspace
        self.revision = 1

    @asynccontextmanager
    async def mutation_context(self, _user_id: str, _workspace_id: str):
        lease = SimpleNamespace(
            workspace=self.workspace,
            revision=self.revision,
            commit_requested=True,
        )
        yield lease
        if lease.commit_requested:
            self.revision += 1
            lease.revision = self.revision


def _service(workspace: Workspace) -> NodeService:
    return NodeService(
        cast(Any, _WorkspaceGate(workspace)),
        cast(Any, None),
        storage_admission=cast(Any, None),
        io_limiter=anyio.CapacityLimiter(2),
        max_source_bytes=1,
        max_storage_bytes=1,
    )


@pytest.mark.anyio
async def test_column_edits_change_document_without_changing_tokenizer() -> None:
    workspace = Workspace(name="metadata")
    node = workspace.add_node(
        Node(
            data=pl.DataFrame(
                {
                    "text": ["hello"],
                    "text_tokens": [["hello"]],
                    "other": [1],
                }
            ).lazy(),
            name="source",
            document="text",
            tokenizer_model="native:plain_words_en",
        )
    )
    service = _service(workspace)

    renamed_source, _revision = await service.edit(
        "user",
        workspace.id,
        node.id,
        RenameColumnNodeEditRequest(column="text", new_name="body"),
    )
    assert renamed_source.document == "body"
    assert renamed_source.tokenizer_model == "native:plain_words_en"

    renamed_tokens, _revision = await service.edit(
        "user",
        workspace.id,
        node.id,
        RenameColumnNodeEditRequest(
            column="text_tokens",
            new_name="tokens",
        ),
    )
    assert renamed_tokens.tokenizer_model == "native:plain_words_en"

    deleted_source, _revision = await service.edit(
        "user",
        workspace.id,
        node.id,
        DeleteColumnNodeEditRequest(column="body"),
    )
    assert deleted_source.document is None
    assert deleted_source.tokenizer_model == "native:plain_words_en"

    restored_plan, _revision = await service.undo("user", workspace.id, node.id)
    assert "body" in node.data.collect_schema()
    assert restored_plan.document is None
    assert restored_plan.tokenizer_model == "native:plain_words_en"


@pytest.mark.anyio
async def test_document_and_tokenizer_patches_are_independent_and_clearable() -> None:
    workspace = Workspace(name="preferences")
    node = workspace.add_node(
        Node(
            data=pl.DataFrame({"text": ["hello"], "body": ["world"]}).lazy(),
            name="source",
            document="text",
            tokenizer_model="native:plain_words_en",
        )
    )
    service = _service(workspace)

    tokenizer_updated, _revision = await service.update(
        "user",
        workspace.id,
        node.id,
        NodeUpdateRequest(tokenizer_model="  lindera:jieba  "),
    )
    assert tokenizer_updated.document == "text"
    assert tokenizer_updated.tokenizer_model == "lindera:jieba"

    document_updated, _revision = await service.update(
        "user",
        workspace.id,
        node.id,
        NodeUpdateRequest(document="body"),
    )
    assert document_updated.document == "body"
    assert document_updated.tokenizer_model == "lindera:jieba"

    tokenizer_cleared, _revision = await service.update(
        "user",
        workspace.id,
        node.id,
        NodeUpdateRequest(tokenizer_model="   "),
    )
    assert tokenizer_cleared.document == "body"
    assert tokenizer_cleared.tokenizer_model is None


def test_clone_inherits_document_but_not_tokenizer_preference() -> None:
    workspace = Workspace(name="derived")
    source = workspace.add_node(
        Node(
            id=str(uuid.uuid4()),
            data=pl.DataFrame({"text": ["hello"]}).lazy(),
            name="source",
            document="text",
            tokenizer_model="native:plain_words_en",
        )
    )

    clone = build_derived_node(
        workspace,
        CloneNodeCreateRequest(source_node_id=uuid.UUID(source.id)),
    )

    assert clone.document == "text"
    assert clone.tokenizer_model is None


@pytest.mark.anyio
async def test_set_cell_is_identity_preserving_undoable_and_no_op_aware() -> None:
    workspace = Workspace(name="cells")
    node = workspace.add_node(
        Node(
            data=pl.DataFrame(
                {
                    "text": ["first", "second"],
                    "annotation": [None, None],
                },
                schema={"text": pl.String, "annotation": pl.String},
            ).lazy(),
            name="source",
        )
    )
    service = _service(workspace)

    edited, revision = await service.edit(
        "user",
        workspace.id,
        node.id,
        SetCellNodeEditRequest(
            column="annotation",
            row_index=1,
            value="Relevant",
        ),
    )

    assert str(edited.id) == node.id
    assert revision == 2
    assert node.data.collect()["annotation"].to_list() == [None, "Relevant"]
    assert node.can_undo is True

    no_op, no_op_revision = await service.edit(
        "user",
        workspace.id,
        node.id,
        SetCellNodeEditRequest(
            column="annotation",
            row_index=1,
            value="Relevant",
        ),
    )

    assert no_op_revision == revision
    assert no_op.can_undo is True
    await service.undo("user", workspace.id, node.id)
    assert node.data.collect()["annotation"].to_list() == [None, None]
    assert node.can_undo is False


@pytest.mark.anyio
async def test_set_cell_rejects_missing_non_string_and_out_of_range_targets() -> None:
    workspace = Workspace(name="invalid cells")
    node = workspace.add_node(
        Node(
            data=pl.DataFrame(
                {"count": [1], "annotation": [None]},
                schema={"count": pl.Int64, "annotation": pl.String},
            ).lazy(),
            name="source",
        )
    )
    service = _service(workspace)

    for request in (
        SetCellNodeEditRequest(column="missing", row_index=0, value="x"),
        SetCellNodeEditRequest(column="count", row_index=0, value="x"),
        SetCellNodeEditRequest(column="annotation", row_index=2, value="x"),
    ):
        with pytest.raises(InvalidInputError):
            await service.edit("user", workspace.id, node.id, request)


@pytest.mark.anyio
async def test_annotation_classes_preserve_extra_columns_and_commit_once() -> None:
    workspace = Workspace(name="classes")
    node = workspace.add_node(
        Node(
            data=pl.DataFrame(
                {
                    "class": ["support", "critical"],
                    "description": ["Supportive", "Critical"],
                    "code": [10, 20],
                }
            ).lazy(),
            name="classes",
        )
    )
    service = _service(workspace)

    edited, revision = await service.edit(
        "user",
        workspace.id,
        node.id,
        AnnotationClassesNodeEditRequest(
            class_column="class",
            description_column="description",
            rows=[
                {"class": "support", "description": "Supports"},
                {"class": "critical", "description": "Criticises"},
                {"class": "neutral", "description": "Neither"},
            ],
        ),
    )

    assert str(edited.id) == node.id
    assert revision == 2
    assert node.data.collect().to_dicts() == [
        {"class": "support", "description": "Supports", "code": 10},
        {"class": "critical", "description": "Criticises", "code": 20},
        {"class": "neutral", "description": "Neither", "code": None},
    ]
    assert node.can_undo is True

    await service.undo("user", workspace.id, node.id)
    assert node.data.collect().to_dicts() == [
        {"class": "support", "description": "Supportive", "code": 10},
        {"class": "critical", "description": "Critical", "code": 20},
    ]


@pytest.mark.anyio
async def test_identical_annotation_classes_create_no_checkpoint() -> None:
    workspace = Workspace(name="classes")
    node = workspace.add_node(
        Node(
            data=pl.DataFrame(
                {"class": ["support"], "description": ["Supportive"]}
            ).lazy(),
            name="classes",
        )
    )
    service = _service(workspace)

    _edited, revision = await service.edit(
        "user",
        workspace.id,
        node.id,
        AnnotationClassesNodeEditRequest(
            class_column="class",
            description_column="description",
            rows=[{"class": "support", "description": "Supportive"}],
        ),
    )

    assert revision == 1
    assert node.can_undo is False
