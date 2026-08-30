"""Estimate dense concordance and quotation page sizes from bounded probes."""

from __future__ import annotations

from collections.abc import Callable, Sequence

# A search yielding fewer than ten hits in the first 100 documents is sparse
# enough to use the largest candidate. Larger probes add latency without
# materially improving the first-page choice.
DEFAULT_PAGE_SIZE_CANDIDATES: tuple[int, ...] = (10, 20, 50, 100)
TARGET_OCCURRENCES: int = 10


def estimate_page_size(
    probe_fn: Callable[[int], int],
    *,
    candidates: Sequence[int] = DEFAULT_PAGE_SIZE_CANDIDATES,
    target: int = TARGET_OCCURRENCES,
) -> int:
    """Return the first dense candidate, or the largest sparse candidate."""
    if not candidates:
        raise ValueError("candidates must be non-empty")
    last = candidates[0]
    for size in candidates:
        last = size
        count = int(probe_fn(size) or 0)
        if count >= target:
            return size
    return last
