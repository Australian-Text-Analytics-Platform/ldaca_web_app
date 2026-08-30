"""Concordance tokens-mode helper.

Implements the second concordance mode:

- **Regex mode (default)** — unchanged. Polars-text concordance engine walks
  raw text; ``num_left_tokens`` means "characters" for CJK because there's
    no whitespace, but partial-word patterns like ``equ\\w*`` survive.
- **Tokens mode** — walks the tokenization column
  for exact-token matches with N-**actual-token** left/right context. The
  word-aware semantics CJK users want once Tokenise has been run.

Only the live (non-materialised) page path is wired here; the materialised
parquet flow keeps the regex semantics.

Used by:
- FastAPI workspace analysis routers, frontend analysis features, and backend tests because they need this unit's "Concordance tokens-mode helper" behavior.

Flow:
- Concordance routes call these helpers when a request targets tokenization output.
- Query parsing turns user alternatives into exact-token match sets.
- Page builders walk token lists to produce KWIC rows with actual-token context windows.
"""

from __future__ import annotations

import logging
import math
import re
from collections.abc import Sequence
from typing import Any, cast

import polars as pl

from ..shared.serialization import serialize_json_rows
from ..shared.errors import InvalidInputError
from .generated_columns import (
    CONC_END_IDX_COLUMN,
    CONC_EXTRACTION_COLUMN,
    CONC_L1_COLUMN,
    CONC_LEFT_CONTEXT_COLUMN,
    CONC_MATCHED_TEXT_COLUMN,
    CONC_R1_COLUMN,
    CONC_RIGHT_CONTEXT_COLUMN,
    CONC_START_IDX_COLUMN,
    CORE_CONCORDANCE_COLUMNS,
)

logger = logging.getLogger(__name__)

# Pipe, comma, or any whitespace can separate alternatives in the search
# input. Runs collapse so ``cat,  dog | fish`` and ``cat dog fish`` parse the
# same way. Exposed at module level so the unit tests can pin the contract.
TOKENS_MODE_ALT_SEPARATOR_RE = re.compile(r"[\s,|]+")


def parse_tokens_mode_alternatives(
    search_word: str, *, case_sensitive: bool
) -> set[str]:
    """Split a tokens-mode search query into a set of alternatives.

    The user can express multi-keyword search using any of space, comma,
    or ``|`` between alternatives (mix-and-match is fine) — mirroring the
    way regex-mode users write ``cat|dog|fish`` but without the
    surrounding-text regex semantics that tokens mode by design rejects.
    Empty / whitespace-only alternatives are silently dropped so a stray
    separator doesn't accidentally widen the match set.
    """
    alternatives: set[str] = set()
    for raw in TOKENS_MODE_ALT_SEPARATOR_RE.split(str(search_word or "")):
        alt = raw.strip()
        if not alt:
            continue
        alternatives.add(alt if case_sensitive else alt.casefold())
    return alternatives


def find_token_matches(
    tokens: Sequence[dict[str, Any] | None],
    search_word: str,
    *,
    case_sensitive: bool,
) -> list[int]:
    """Return indices of tokens matching any of the user's alternatives.

    ``search_word`` is parsed by :func:`parse_tokens_mode_alternatives`
    so the user can supply one or many tokens separated by space, comma,
    or ``|`` — the same alternation regex-mode users get for free via
    regex syntax. Each alternative is an exact-token equality match
    against the tokenization column; substring / partial matches are
    intentionally not supported in tokens mode (that's what text mode
    is for).



    Used by token-aware concordance workers and live result queries.
    """
    needles = parse_tokens_mode_alternatives(search_word, case_sensitive=case_sensitive)
    if not needles:
        return []
    matches: list[int] = []
    for i, struct in enumerate(tokens):
        if struct is None:
            continue
        token = str(struct.get("token") or "")
        candidate = token if case_sensitive else token.casefold()
        if candidate in needles:
            matches.append(i)
    return matches


def build_token_hit(
    tokens: list[dict[str, Any]],
    match_index: int,
    *,
    raw_text: str,
    num_left: int,
    num_right: int,
) -> dict[str, Any]:
    """Build one concordance hit struct from a token match.

    ``left_context`` / ``right_context`` are sliced from ``raw_text`` between
    the relevant token offsets, so the strings preserve the original
    separators (single chars for CJK, whitespace for English).



    Used by token-aware concordance workers and live result queries.
    """
    match_struct = tokens[match_index]
    start_idx = int(match_struct["start"])
    end_idx = int(match_struct["end"])
    matched_text = match_struct["token"]

    left_slice = tokens[max(0, match_index - num_left) : match_index]
    right_slice = tokens[match_index + 1 : match_index + 1 + num_right]

    left_context = (
        raw_text[int(left_slice[0]["start"]) : start_idx] if left_slice else ""
    )
    right_context = (
        raw_text[end_idx : int(right_slice[-1]["end"])] if right_slice else ""
    )

    l1 = tokens[match_index - 1]["token"] if match_index > 0 else None
    r1 = tokens[match_index + 1]["token"] if match_index + 1 < len(tokens) else None
    extraction_start = int(left_slice[0]["start"]) if left_slice else start_idx
    extraction_end = int(right_slice[-1]["end"]) if right_slice else end_idx

    return {
        CONC_LEFT_CONTEXT_COLUMN: left_context,
        CONC_MATCHED_TEXT_COLUMN: matched_text,
        CONC_RIGHT_CONTEXT_COLUMN: right_context,
        CONC_START_IDX_COLUMN: start_idx,
        CONC_END_IDX_COLUMN: end_idx,
        CONC_L1_COLUMN: l1,
        CONC_R1_COLUMN: r1,
        # CONC_extraction mirrors the regex-mode shape — the raw KWIC window
        # is the slice from the first context token start to the last
        # context token end, including the matched span in between.
        CONC_EXTRACTION_COLUMN: raw_text[extraction_start:extraction_end],
    }


def compute_tokens_concordance_page(
    base_lf: pl.LazyFrame,
    *,
    column: str,
    tokenization_column: str,
    request: dict[str, Any],
    page: int,
    page_size: int,
    sort_by: str | None,
    descending: bool,
    node_label: str | None = None,
) -> dict[str, Any]:
    """Page payload for the tokens-mode concordance path.

    Shape matches :func:`concordance_core.compute_concordance_page` so the
    response builder can route either way without changes downstream.



    Used by ``AnalysisResultService`` for token-aware concordance pages.
    """
    search_word = str(request.get("search_word") or "")
    case_sensitive = bool(request.get("case_sensitive", False))
    num_left = int(request.get("num_left_tokens", 10) or 10)
    num_right = int(request.get("num_right_tokens", 10) or 10)

    total_source_rows = base_lf.select(pl.len()).collect().item()
    total_source_rows = int(total_source_rows or 0)

    effective_sort_by: str | None = None
    if sort_by:
        schema = base_lf.collect_schema()
        if sort_by not in schema or sort_by in CORE_CONCORDANCE_COLUMNS:
            raise InvalidInputError("Sort column is not available for concordance")
        base_lf = base_lf.sort(sort_by, descending=descending)
        effective_sort_by = sort_by

    start = (page - 1) * page_size
    page_lf = base_lf.slice(start, page_size)
    page_df = page_lf.collect()

    metadata_columns = [c for c in page_df.columns if c != tokenization_column]
    has_text_column = column in metadata_columns
    columns = list(metadata_columns) + list(CORE_CONCORDANCE_COLUMNS)
    if has_text_column:
        columns.append(CONC_EXTRACTION_COLUMN)
    if node_label:
        columns.append("__source_node")

    grouped_rows: list[list[dict[str, Any]]] = []
    for row in page_df.to_dicts():
        tokens = row.get(tokenization_column) or []
        if not isinstance(tokens, list) or not tokens:
            continue
        raw_text = str(row.get(column) or "") if has_text_column else ""
        # Drop the temporary hydrated token column from the metadata copy.
        base_row = {
            key: value for key, value in row.items() if key != tokenization_column
        }

        match_indices = find_token_matches(
            tokens, search_word, case_sensitive=case_sensitive
        )
        hits = []
        for match_index in match_indices:
            hit = build_token_hit(
                cast(list[dict[str, Any]], tokens),
                match_index,
                raw_text=raw_text,
                num_left=num_left,
                num_right=num_right,
            )
            full_hit: dict[str, Any] = {**base_row, **hit}
            if node_label:
                full_hit["__source_node"] = node_label
            hits.append(full_hit)
        if hits:
            grouped_rows.append(hits)

    total_source_pages = (
        math.ceil(total_source_rows / page_size) if total_source_rows else 0
    )
    metadata = {
        "concordance_columns": [c for c in columns if c in CORE_CONCORDANCE_COLUMNS],
        "metadata_columns": [c for c in columns if c not in CORE_CONCORDANCE_COLUMNS],
        "all_columns": columns,
    }

    return {
        "data": serialize_json_rows(grouped_rows),
        "columns": columns,
        "metadata": metadata,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total_source_rows": total_source_rows,
            "total_source_pages": total_source_pages,
            "result_count": len(grouped_rows),
            "has_next": page < total_source_pages,
            "has_prev": page > 1,
        },
        "sorting": {
            "sort_by": effective_sort_by,
            "descending": descending,
        },
    }


__all__ = [
    "find_token_matches",
    "build_token_hit",
    "compute_tokens_concordance_page",
]
