"""Filesystem location adapter for the Rust embedding cache.

The actual DuckDB schema and vector reuse live in ``polars_text`` on the Rust
side. This module appends the stable filename to a runtime-owned cache root; it
does not resolve users or settings itself.

Used by:
- ``workers.topic_modeling`` because topic-modeling workers need a stable per-user
  cache location to pass into the Rust pipeline.

Flow: resolve the user cache folder and append the embedding-cache filename.
"""

from __future__ import annotations

from pathlib import Path

EMBEDDINGS_CACHE_FILENAME = "embeddings.duckdb"


def embeddings_cache_path(cache_root: str | Path) -> Path:
    """Return the embedding-cache file below an explicit cache root.

    Used by:
    - topic-modeling worker tests and runtime code because both need the same
      observable ``embeddings.duckdb`` location while leaving ``tokens.duckdb``
      reserved for tokenization.

    Flow: resolve Wordflow's per-user cache folder, then append the embedding
        cache filename.
    """
    return Path(cache_root) / EMBEDDINGS_CACHE_FILENAME


__all__ = ["EMBEDDINGS_CACHE_FILENAME", "embeddings_cache_path"]
