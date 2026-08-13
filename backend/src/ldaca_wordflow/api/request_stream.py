"""Incremental request-body adapter for pre-parser storage admission."""

from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import Request


class RequestByteStream:
    """Expose ``Request.stream`` through the storage service's bounded read API."""

    def __init__(self, request: Request) -> None:
        self._iterator: AsyncIterator[bytes] = request.stream().__aiter__()
        self._buffer = bytearray()
        self._finished = False

    async def read(self, size: int) -> bytes:
        """Return at most ``size`` bytes without materializing the request body."""

        while len(self._buffer) < size and not self._finished:
            try:
                self._buffer.extend(await anext(self._iterator))
            except StopAsyncIteration:
                self._finished = True
        chunk = bytes(self._buffer[:size])
        del self._buffer[:size]
        return chunk


__all__ = ["RequestByteStream"]
