"""Bounded runtime cache for complete, N-independent Topic projection bases."""

from __future__ import annotations

import threading
import uuid
from collections import OrderedDict
from collections.abc import Callable
from concurrent.futures import Future
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class TopicProjectionCacheKey:
    user_id: str
    workspace_id: uuid.UUID
    analysis_id: uuid.UUID
    context_path: str
    context_inode: int
    context_size: int
    context_mtime_ns: int
    cluster_count: int


class TopicProjectionBasisCache:
    """Single-flight LRU whose only interface is complete basis bytes by K."""

    def __init__(self, *, max_entries: int, max_bytes: int) -> None:
        if max_entries < 0 or max_bytes < 0:
            raise ValueError("Topic projection cache limits cannot be negative")
        self._max_entries = max_entries
        self._max_bytes = max_bytes
        self._entries: OrderedDict[TopicProjectionCacheKey, bytes] = OrderedDict()
        self._entry_bytes = 0
        self._inflight: dict[TopicProjectionCacheKey, Future[bytes]] = {}
        self._lock = threading.Lock()

    def get_or_build(
        self,
        key: TopicProjectionCacheKey,
        builder: Callable[[], bytes],
    ) -> bytes:
        """Return one basis, sharing concurrent misses and retaining only bounded values."""

        if self._max_entries == 0 or self._max_bytes == 0:
            return builder()
        with self._lock:
            cached = self._entries.pop(key, None)
            if cached is not None:
                self._entries[key] = cached
                return cached
            pending = self._inflight.get(key)
            owner = pending is None
            if pending is None:
                pending = Future()
                self._inflight[key] = pending
        if not owner:
            return pending.result()

        try:
            payload = builder()
            if not isinstance(payload, bytes):
                raise TypeError("Topic projection cache builder must return bytes")
            with self._lock:
                if len(payload) <= self._max_bytes:
                    self._entries[key] = payload
                    self._entry_bytes += len(payload)
                    while self._entries and (
                        len(self._entries) > self._max_entries
                        or self._entry_bytes > self._max_bytes
                    ):
                        _, evicted = self._entries.popitem(last=False)
                        self._entry_bytes -= len(evicted)
                pending.set_result(payload)
            return payload
        except BaseException as exc:
            with self._lock:
                pending.set_exception(exc)
            raise
        finally:
            with self._lock:
                self._inflight.pop(key, None)


__all__ = ["TopicProjectionBasisCache", "TopicProjectionCacheKey"]
