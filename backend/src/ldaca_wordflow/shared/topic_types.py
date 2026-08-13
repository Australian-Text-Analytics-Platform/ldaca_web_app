"""Canonical semantic and physical types for Topic Distribution values."""

from __future__ import annotations

import polars as pl

TOPIC_DISTRIBUTION_EXTENSION = "org.ldaca.wordflow.topic_distribution.v1"

TOPIC_DISTRIBUTION_ENTRY_DTYPE = pl.Struct(
    [
        pl.Field("topic_id", pl.Int64),
        pl.Field("proportion", pl.Float64),
    ]
)


def topic_distribution_storage_dtype(topic_count: int) -> pl.Array:
    """Return storage for outlier ``-1`` plus every real topic."""

    if topic_count < 0:
        raise ValueError("Topic count cannot be negative")
    return pl.Array(TOPIC_DISTRIBUTION_ENTRY_DTYPE, topic_count + 1)


def topic_distribution_dtype(topic_count: int) -> pl.Extension:
    """Return the semantic Topic Distribution type and its physical storage."""

    return pl.Extension(
        TOPIC_DISTRIBUTION_EXTENSION,
        topic_distribution_storage_dtype(topic_count),
        '{"version":1}',
    )


def topic_distribution_storage(dtype: pl.DataType) -> pl.DataType:
    """Return physical storage for a Topic Distribution extension or dtype."""

    if isinstance(dtype, pl.Extension):
        if dtype.ext_name() != TOPIC_DISTRIBUTION_EXTENSION:
            raise ValueError("Extension is not a Topic Distribution")
        storage = dtype.ext_storage()
        if not isinstance(storage, pl.DataType):
            raise ValueError("Topic Distribution requires concrete storage")
        return storage
    return dtype


def is_topic_distribution_storage_dtype(dtype: pl.DataType) -> bool:
    """Whether ``dtype`` is the canonical fixed-size physical representation."""

    if (
        isinstance(dtype, pl.Extension)
        and dtype.ext_name() != TOPIC_DISTRIBUTION_EXTENSION
    ):
        return False
    storage = topic_distribution_storage(dtype)
    return (
        isinstance(storage, pl.Array)
        and storage.inner == TOPIC_DISTRIBUTION_ENTRY_DTYPE
    )


def is_topic_distribution_dtype(dtype: pl.DataType) -> bool:
    """Whether ``dtype`` carries Wordflow's exact semantic extension identity."""

    return (
        isinstance(dtype, pl.Extension)
        and dtype.ext_name() == TOPIC_DISTRIBUTION_EXTENSION
        and is_topic_distribution_storage_dtype(dtype)
    )


def topic_count_from_storage_dtype(dtype: pl.DataType) -> int:
    """Read the real-topic count from canonical storage or fail clearly."""

    storage = topic_distribution_storage(dtype)
    if (
        not isinstance(storage, pl.Array)
        or storage.inner != TOPIC_DISTRIBUTION_ENTRY_DTYPE
    ):
        raise ValueError("Topic Distribution storage is not a canonical fixed-size array")
    return storage.size - 1


__all__ = [
    "TOPIC_DISTRIBUTION_EXTENSION",
    "TOPIC_DISTRIBUTION_ENTRY_DTYPE",
    "is_topic_distribution_dtype",
    "is_topic_distribution_storage_dtype",
    "topic_count_from_storage_dtype",
    "topic_distribution_dtype",
    "topic_distribution_storage",
    "topic_distribution_storage_dtype",
]
