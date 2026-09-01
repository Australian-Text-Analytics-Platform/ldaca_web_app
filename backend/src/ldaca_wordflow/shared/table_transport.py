"""Concrete Arrow IPC encoding for every tabular HTTP boundary."""

from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

import polars as pl

from .errors import InvalidInputError
from .topic_types import TOPIC_COVERAGE_EXTENSION, topic_coverage_dtype

ARROW_STREAM_MEDIA_TYPE = "application/vnd.apache.arrow.stream"
HAS_NEXT_HEADER = "X-Wordflow-Has-Next"
TOTAL_ROWS_HEADER = "X-Wordflow-Total-Rows"


@dataclass(frozen=True, slots=True)
class IpcTablePage:
    """One self-contained page and whether another page can exist."""

    content: bytes
    has_next: bool
    total_rows: int | None = None


def encode_ipc_stream(frame: pl.DataFrame) -> bytes:
    """Encode one DataFrame as an uncompressed Arrow IPC stream."""

    output = BytesIO()
    frame.write_ipc_stream(output, compression="uncompressed")
    return output.getvalue()


def write_ipc_stream(frame: pl.DataFrame, path: str) -> None:
    """Persist one complete result table in the canonical wire format."""

    frame.write_ipc_stream(path, compression="uncompressed")


def encode_schema_stream(schema: pl.Schema) -> bytes:
    """Encode a schema as a zero-row Arrow IPC stream."""

    return encode_ipc_stream(pl.DataFrame(schema=schema))


def materialize_page(
    lazyframe: pl.LazyFrame,
    *,
    page: int,
    page_size: int,
    sort_by: str | None = None,
    descending: bool = False,
) -> IpcTablePage:
    """Materialize one page plus a single look-ahead row, without counting."""

    if page < 1 or page_size < 1:
        raise InvalidInputError("Page and page size must be positive")
    schema = lazyframe.collect_schema()
    if sort_by is not None:
        if sort_by not in schema:
            raise InvalidInputError("Table sort column not found")
        lazyframe = lazyframe.sort(sort_by, descending=descending)
    frame = lazyframe.slice((page - 1) * page_size, page_size + 1).collect()
    has_next = len(frame) > page_size
    if has_next:
        frame = frame.head(page_size)
    return IpcTablePage(content=encode_ipc_stream(frame), has_next=has_next)


__all__ = [
    "ARROW_STREAM_MEDIA_TYPE",
    "HAS_NEXT_HEADER",
    "TOTAL_ROWS_HEADER",
    "IpcTablePage",
    "TOPIC_COVERAGE_EXTENSION",
    "encode_ipc_stream",
    "encode_schema_stream",
    "materialize_page",
    "topic_coverage_dtype",
    "write_ipc_stream",
]
