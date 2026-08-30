"""Bounded file export for ordered Workspace Data Blocks."""

from __future__ import annotations

import os
import uuid
import zipfile
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import IO, BinaryIO, cast

import polars as pl

from ..domain.workspace import Node
from ..models.node_resources import DataBlockExportFormat, DataBlockExportRequest
from ..shared.errors import NodeNotFoundError, ResourceTooLargeError
from .response_snapshots import ResponseSnapshot, ResponseSnapshotService
from .workspace import WorkspaceService


@dataclass(frozen=True, slots=True)
class _ExportFormatSpec:
    extension: str
    media_type: str


_FORMAT_SPECS = {
    DataBlockExportFormat.CSV: _ExportFormatSpec("csv", "text/csv; charset=utf-8"),
    DataBlockExportFormat.JSON: _ExportFormatSpec("json", "application/json"),
    DataBlockExportFormat.NDJSON: _ExportFormatSpec("ndjson", "application/x-ndjson"),
    DataBlockExportFormat.PARQUET: _ExportFormatSpec(
        "parquet", "application/vnd.apache.parquet"
    ),
    DataBlockExportFormat.IPC: _ExportFormatSpec(
        "arrow", "application/vnd.apache.arrow.file"
    ),
}


class DataBlockExportService:
    """Materialize Data Blocks into immutable response-lifetime files."""

    def __init__(
        self,
        workspaces: WorkspaceService,
        response_snapshots: ResponseSnapshotService,
        *,
        max_export_bytes: int,
    ) -> None:
        if max_export_bytes < 1:
            raise ValueError("Data Block export limit must be positive")
        self._workspaces = workspaces
        self._response_snapshots = response_snapshots
        self._max_export_bytes = max_export_bytes

    async def export(
        self,
        user_id: str,
        workspace_id: uuid.UUID,
        request: DataBlockExportRequest,
    ) -> tuple[ResponseSnapshot, str, str, int]:
        """Export the exact requested Data Blocks from one stable Workspace view."""

        node_ids = request.node_ids
        spec = _FORMAT_SPECS[request.format]
        multiple = len(node_ids) > 1
        async with self._workspaces.read_context(user_id, workspace_id) as lease:
            nodes: list[Node] = []
            for node_id in node_ids:
                node = lease.workspace.nodes.get(node_id)
                if node is None:
                    raise NodeNotFoundError("Data Block not found")
                nodes.append(node)
            filename = (
                f"{_safe_export_stem(lease.workspace.name, 'workspace')}_data_blocks.zip"
                if multiple
                else f"{_safe_export_stem(nodes[0].name, str(node_ids[0]))}.{spec.extension}"
            )
            snapshot = await self._response_snapshots.create_generated(
                suffix=".zip" if multiple else f".{spec.extension}",
                max_output_bytes=self._max_export_bytes,
                reservation_bytes=self._max_export_bytes,
                producer=partial(
                    _write_export,
                    tuple(nodes),
                    request.format,
                ),
            )
            revision = lease.revision
        return (
            snapshot,
            filename,
            "application/zip" if multiple else spec.media_type,
            revision,
        )


@dataclass(slots=True)
class _WriteBudget:
    limit: int
    written: int = 0

    def consume(self, size: int) -> None:
        if self.written + size > self.limit:
            raise ResourceTooLargeError("Data Block export exceeds its storage budget")
        self.written += size


class _BudgetedBinaryWriter:
    """Count uncompressed export bytes written to one file or ZIP entry."""

    def __init__(self, output: IO[bytes], budget: _WriteBudget) -> None:
        self._output = output
        self._budget = budget
        self.exceeded = False

    def write(self, content: bytes) -> int:
        try:
            self._budget.consume(len(content))
        except ResourceTooLargeError:
            self.exceeded = True
            raise
        return self._output.write(content)

    def flush(self) -> None:
        self._output.flush()

    def tell(self) -> int:
        return self._output.tell()


class _BoundedSeekableWriter:
    """Keep the final ZIP file inside the admitted response budget."""

    def __init__(self, output: IO[bytes], limit: int) -> None:
        self._output = output
        self._limit = limit

    def write(self, content: bytes) -> int:
        if self._output.tell() + len(content) > self._limit:
            raise ResourceTooLargeError("Data Block export exceeds its storage budget")
        return self._output.write(content)

    def seek(self, offset: int, whence: int = os.SEEK_SET) -> int:
        return self._output.seek(offset, whence)

    def tell(self) -> int:
        return self._output.tell()

    def flush(self) -> None:
        self._output.flush()

    def seekable(self) -> bool:
        return True

    def writable(self) -> bool:
        return True


def _write_export(
    nodes: tuple[Node, ...],
    export_format: DataBlockExportFormat,
    target: Path,
    max_output_bytes: int,
) -> None:
    spec = _FORMAT_SPECS[export_format]
    budget = _WriteBudget(max_output_bytes)
    try:
        with target.open("xb") as raw_output:
            if len(nodes) == 1:
                writer = _BudgetedBinaryWriter(raw_output, budget)
                _write_lazyframe(nodes[0].data, export_format, writer)
            else:
                zip_output = cast(
                    BinaryIO,
                    _BoundedSeekableWriter(raw_output, max_output_bytes),
                )
                with zipfile.ZipFile(
                    zip_output,
                    mode="w",
                    compression=zipfile.ZIP_DEFLATED,
                    compresslevel=6,
                ) as archive:
                    for node, archive_name in zip(
                        nodes,
                        _archive_names(nodes, spec.extension),
                        strict=True,
                    ):
                        with archive.open(archive_name, mode="w") as member:
                            writer = _BudgetedBinaryWriter(member, budget)
                            _write_lazyframe(node.data, export_format, writer)
            raw_output.flush()
            os.fsync(raw_output.fileno())
    except BaseException:
        target.unlink(missing_ok=True)
        raise


def _write_lazyframe(
    frame: pl.LazyFrame,
    export_format: DataBlockExportFormat,
    writer: _BudgetedBinaryWriter,
) -> None:
    try:
        if export_format is DataBlockExportFormat.CSV:
            frame.sink_csv(cast(BinaryIO, writer))
        elif export_format is DataBlockExportFormat.JSON:
            content = frame.collect().write_json().encode()
            writer.write(content)
        elif export_format is DataBlockExportFormat.NDJSON:
            frame.sink_ndjson(cast(BinaryIO, writer))
        elif export_format is DataBlockExportFormat.PARQUET:
            frame.sink_parquet(cast(BinaryIO, writer))
        else:
            frame.sink_ipc(cast(BinaryIO, writer))
    except pl.exceptions.ComputeError as exc:
        if writer.exceeded:
            raise ResourceTooLargeError(
                "Data Block export exceeds its storage budget"
            ) from exc
        raise


def _archive_names(nodes: tuple[Node, ...], extension: str) -> list[str]:
    counts: dict[str, int] = {}
    names: list[str] = []
    for node in nodes:
        stem = _safe_export_stem(node.name, str(node.id))
        occurrence = counts.get(stem, 0) + 1
        counts[stem] = occurrence
        unique_stem = stem if occurrence == 1 else f"{stem}_{occurrence}"
        names.append(f"{unique_stem}.{extension}")
    return names


def _safe_export_stem(value: str, fallback: str) -> str:
    normalized = "".join(
        character if character.isalnum() or character in {"-", "_"} else "_"
        for character in value.strip()
    ).strip("_")
    return normalized or fallback


__all__ = ["DataBlockExportService"]
