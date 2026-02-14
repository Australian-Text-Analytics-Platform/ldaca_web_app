"""Shared helper utilities for analysis routes and worker tasks."""

from __future__ import annotations

import math
from typing import Any


def normalize_sort_order(sort_order: str | None, *, default: str = "asc") -> str:
    """Normalize sort order to `asc`/`desc` with a configurable default."""
    if isinstance(sort_order, str) and sort_order.lower() == "desc":
        return "desc"
    return default


def safe_float(value: Any, *, default: float | None = 0.0) -> float | None:
    """Parse finite float values, returning a default for invalid/NaN/Inf input."""
    try:
        number = float(value)
    except TypeError, ValueError:
        return default
    if math.isnan(number) or math.isinf(number):
        return default
    return number


def sanitize_stop_words(value: Any) -> list[str]:
    """Normalize stop words from text/iterables into a unique case-insensitive list."""
    if value is None:
        return []
    if isinstance(value, str):
        raw_items = value.split(",")
    elif isinstance(value, (list, tuple, set)):
        raw_items = list(value)
    else:
        return []

    sanitized: list[str] = []
    seen: set[str] = set()
    for item in raw_items:
        if item is None:
            continue
        token = str(item).strip()
        if not token:
            continue
        lowered = token.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        sanitized.append(token)
    return sanitized
