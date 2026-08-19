"""Bounded, single-flight Topic projection basis cache tests."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from threading import Event, Lock

import pytest

from ldaca_wordflow.services.topic_projection_cache import (
    TopicProjectionBasisCache,
    TopicProjectionCacheKey,
)


def _key(value: int) -> TopicProjectionCacheKey:
    return TopicProjectionCacheKey(
        user_id="user",
        workspace_id="workspace",
        analysis_id="analysis",
        context_path="/context",
        context_inode=1,
        context_size=2,
        context_mtime_ns=3,
        cluster_count=value,
    )


def test_cache_reuses_values_and_evicts_by_entry_and_byte_limits() -> None:
    cache = TopicProjectionBasisCache(max_entries=2, max_bytes=5)
    calls: list[int] = []

    def build(value: int) -> bytes:
        calls.append(value)
        return bytes([value, value])

    assert cache.get_or_build(_key(1), lambda: build(1)) == b"\x01\x01"
    assert cache.get_or_build(_key(1), lambda: build(9)) == b"\x01\x01"
    cache.get_or_build(_key(2), lambda: build(2))
    cache.get_or_build(_key(3), lambda: build(3))
    cache.get_or_build(_key(1), lambda: build(1))
    assert calls == [1, 2, 3, 1]


def test_disabled_oversized_and_failed_builds_are_not_retained() -> None:
    disabled = TopicProjectionBasisCache(max_entries=0, max_bytes=10)
    calls = 0

    def build() -> bytes:
        nonlocal calls
        calls += 1
        return b"value"

    disabled.get_or_build(_key(1), build)
    disabled.get_or_build(_key(1), build)
    assert calls == 2

    oversized = TopicProjectionBasisCache(max_entries=2, max_bytes=2)
    oversized.get_or_build(_key(1), build)
    oversized.get_or_build(_key(1), build)
    assert calls == 4

    failing = TopicProjectionBasisCache(max_entries=2, max_bytes=10)
    with pytest.raises(RuntimeError, match="failed"):
        failing.get_or_build(_key(1), lambda: (_ for _ in ()).throw(RuntimeError("failed")))
    assert failing.get_or_build(_key(1), lambda: b"ok") == b"ok"


def test_concurrent_misses_share_one_builder() -> None:
    cache = TopicProjectionBasisCache(max_entries=2, max_bytes=100)
    entered = Event()
    release = Event()
    calls = 0
    calls_lock = Lock()

    def build() -> bytes:
        nonlocal calls
        with calls_lock:
            calls += 1
        entered.set()
        assert release.wait(timeout=2)
        return b"basis"

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [
            executor.submit(cache.get_or_build, _key(2), build) for _ in range(4)
        ]
        assert entered.wait(timeout=2)
        release.set()
        assert [future.result(timeout=2) for future in futures] == [b"basis"] * 4
    assert calls == 1


def test_cluster_context_and_analysis_identity_changes_rebuild() -> None:
    cache = TopicProjectionBasisCache(max_entries=16, max_bytes=1_000)
    calls = 0

    def build() -> bytes:
        nonlocal calls
        calls += 1
        return b"basis"

    base = _key(2)
    for key in (
        base,
        replace(base, cluster_count=3),
        replace(base, context_mtime_ns=4),
        replace(base, analysis_id="other-analysis"),
        base,
    ):
        cache.get_or_build(key, build)
    assert calls == 4
