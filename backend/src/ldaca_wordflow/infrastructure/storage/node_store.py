"""Node persistence helpers.

This module owns the serialized representation of a single :class:`Node`.
Node metadata is stored in JSON, while the underlying Polars ``LazyFrame`` is
persisted as a binary payload under a workspace-relative ``data/`` directory.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import polars as pl

from .durable_fs import atomic_output_path
from ...domain.workspace import Node, NodeProvenance

NODE_DATA_DIR = "data"


class NodePlanCapacityError(ValueError):
    """A serialized LazyFrame plan exceeds its assigned snapshot budget."""


def to_dict(
    node: Node,
    *,
    base_dir: str | Path,
    data_path: str | Path | None = None,
    max_data_bytes: int | None = None,
) -> dict[str, Any]:
    """Serialize a node into one caller-selected copy-on-write plan path.

    Standalone node serialization retains the stable ``data/<id>.plbin`` name.
    Workspace serialization supplies a unique generation path so writing a new
    graph can never mutate files referenced by the last committed metadata.
    """

    root_dir = Path(base_dir)

    rel_data_path = (
        Path(data_path)
        if data_path is not None
        else Path(NODE_DATA_DIR) / f"{node.id}.plbin"
    )
    if rel_data_path.is_absolute() or ".." in rel_data_path.parts:
        raise ValueError("Node data path must be workspace-relative")
    abs_data_path = root_dir / rel_data_path
    schema = node.data.collect_schema()
    if node.document is not None and node.document not in schema.names():
        raise ValueError("Document Column Preference is absent from Data Block schema")

    # A plan file is part of the last committed metadata snapshot. Serialize
    # beside it and replace atomically so cancellation or process failure can
    # never leave a partially written plan at the referenced path.
    serialized = node.data.serialize(format="binary")
    if not isinstance(serialized, bytes):  # pragma: no cover - Polars contract guard
        raise TypeError("LazyFrame serialization did not return bytes")
    if max_data_bytes is not None and len(serialized) > max_data_bytes:
        raise NodePlanCapacityError("Serialized node plan exceeds its storage budget")
    with atomic_output_path(abs_data_path) as temporary:
        temporary.write_bytes(serialized)

    return {
        "node_metadata": {
            "id": str(node.id),
            "name": node.name,
            "provenance": node.provenance.model_dump(mode="json"),
            "document": node.document,
            "color": node.color,
            "tokenizer_model": node.tokenizer_model,
            "schema": [
                {"name": name, "dtype": str(dtype)}
                for name, dtype in schema.items()
            ],
        },
        "data_path": rel_data_path.as_posix(),
    }


def write_published_frame(
    data: pl.DataFrame,
    *,
    base_dir: str | Path,
    name: str,
    provenance: NodeProvenance,
    document: str | None,
    color: str | None = None,
) -> dict[str, Any]:
    """Write one child-Analysis output as a private transferable Parquet file."""

    node_id = str(uuid.uuid4())
    relative = Path(NODE_DATA_DIR) / f"{node_id}.parquet"
    with atomic_output_path(Path(base_dir) / relative) as temporary:
        data.write_parquet(temporary)
    return {
        "data_block": {
            "id": node_id,
            "name": name,
            "provenance": provenance.model_dump(mode="json"),
            "document": document,
            "color": color,
        },
        "parquet_path": relative.as_posix(),
    }


__all__ = [
    "NODE_DATA_DIR",
    "NodePlanCapacityError",
    "to_dict",
    "write_published_frame",
]
