"""Canonical semantic and physical types for Topic Coverage values."""

from __future__ import annotations

import polars as pl

TOPIC_COVERAGE_EXTENSION = "org.ldaca.wordflow.topic_coverage.v1"

TOPIC_COVERAGE_ENTRY_DTYPE = pl.Struct(
    [
        pl.Field("topic_id", pl.Int64),
        pl.Field("coverage", pl.Float64),
    ]
)


def topic_coverage_storage_dtype(topic_count: int) -> pl.Array:
    """Return storage for outlier ``-1`` plus every real Topic."""

    if topic_count < 0:
        raise ValueError("Topic count cannot be negative")
    return pl.Array(TOPIC_COVERAGE_ENTRY_DTYPE, topic_count + 1)


def topic_coverage_dtype(topic_count: int) -> pl.Extension:
    """Return the semantic Topic Coverage type and its physical storage."""

    return pl.Extension(
        TOPIC_COVERAGE_EXTENSION,
        topic_coverage_storage_dtype(topic_count),
        '{"version":1}',
    )


def topic_coverage_storage(dtype: pl.DataType) -> pl.DataType:
    """Return physical storage for a Topic Coverage extension or dtype."""

    if isinstance(dtype, pl.Extension):
        if dtype.ext_name() != TOPIC_COVERAGE_EXTENSION:
            raise ValueError("Extension is not Topic Coverage")
        storage = dtype.ext_storage()
        if not isinstance(storage, pl.DataType):
            raise ValueError("Topic Coverage requires concrete storage")
        return storage
    return dtype


def is_topic_coverage_storage_dtype(dtype: pl.DataType) -> bool:
    """Whether ``dtype`` is the canonical fixed-size physical representation."""

    if isinstance(dtype, pl.Extension) and dtype.ext_name() != TOPIC_COVERAGE_EXTENSION:
        return False
    storage = topic_coverage_storage(dtype)
    return isinstance(storage, pl.Array) and storage.inner == TOPIC_COVERAGE_ENTRY_DTYPE


def is_topic_coverage_dtype(dtype: pl.DataType) -> bool:
    """Whether ``dtype`` carries Wordflow's exact semantic extension identity."""

    return (
        isinstance(dtype, pl.Extension)
        and dtype.ext_name() == TOPIC_COVERAGE_EXTENSION
        and is_topic_coverage_storage_dtype(dtype)
    )


def topic_count_from_storage_dtype(dtype: pl.DataType) -> int:
    """Read the real-Topic count from canonical storage or fail clearly."""

    storage = topic_coverage_storage(dtype)
    if not isinstance(storage, pl.Array) or storage.inner != TOPIC_COVERAGE_ENTRY_DTYPE:
        raise ValueError("Topic Coverage storage is not a canonical fixed-size array")
    return storage.size - 1


__all__ = [
    "TOPIC_COVERAGE_EXTENSION",
    "TOPIC_COVERAGE_ENTRY_DTYPE",
    "is_topic_coverage_dtype",
    "is_topic_coverage_storage_dtype",
    "topic_count_from_storage_dtype",
    "topic_coverage_dtype",
    "topic_coverage_storage",
    "topic_coverage_storage_dtype",
]
