"""Bounded binary writer used at durable storage boundaries."""

from __future__ import annotations

from typing import BinaryIO, IO, cast

import polars as pl

from ...shared.errors import ResourceTooLargeError


class BoundedBinaryWriter:
    """Delegate binary writes while enforcing one aggregate byte ceiling."""

    def __init__(self, output: BinaryIO, limit: int, *, label: str) -> None:
        self._output = output
        self._limit = limit
        self._label = label
        self._written = 0
        self.exceeded = False

    def write(self, content: bytes) -> int:
        next_total = self._written + len(content)
        if next_total > self._limit:
            self.exceeded = True
            raise ResourceTooLargeError(f"{self._label} exceeds its storage budget")
        written = self._output.write(content)
        self._written += written
        return written

    def flush(self) -> None:
        self._output.flush()

    def tell(self) -> int:
        return self._output.tell()


def write_parquet_bounded(
    dataframe: pl.DataFrame,
    output: BinaryIO,
    limit: int,
    *,
    label: str,
) -> None:
    """Write Parquet with a hard ceiling and preserve the domain 413 error."""

    writer = BoundedBinaryWriter(output, limit, label=label)
    try:
        dataframe.write_parquet(cast(IO[bytes], writer))
    except pl.exceptions.ComputeError as exc:
        if writer.exceeded:
            raise ResourceTooLargeError(f"{label} exceeds its storage budget") from exc
        raise


__all__ = ["BoundedBinaryWriter", "write_parquet_bounded"]
