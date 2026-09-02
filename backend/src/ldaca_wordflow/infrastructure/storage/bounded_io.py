"""Bounded binary writer used at durable storage boundaries."""

from __future__ import annotations

import os
from collections.abc import Callable
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


class BoundedSeekableWriter:
    """Delegate seekable binary writes while enforcing one file-size ceiling."""

    def __init__(
        self,
        output: BinaryIO,
        limit: int,
        *,
        overflow: Callable[[], Exception],
    ) -> None:
        self._output = output
        self._limit = limit
        self._overflow = overflow

    def write(self, content: bytes) -> int:
        if self._output.tell() + len(content) > self._limit:
            raise self._overflow()
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


__all__ = [
    "BoundedBinaryWriter",
    "BoundedSeekableWriter",
    "write_parquet_bounded",
]
