"""Core concordance computation for Analysis execution and Result queries.

Used by:
- concordance workers and ``AnalysisResultService``.
- focused backend computation tests.

Flow:
- Callers pass immutable requests and snapshotted Node plans into these helpers.
- Helpers normalize request payloads, compute regex/token concordance pages, and attach metadata.
- Response builders serialize dense page payloads and generated-column metadata.
"""

from __future__ import annotations

import logging
import math
import re
from functools import partial
from typing import Any

import polars as pl

from ..shared.serialization import serialize_json_rows
from ..shared.errors import InvalidInputError
from .concordance_tokens import (
    compute_tokens_concordance_page,
    find_token_matches,
)
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
    compute_concordance_extraction_string,
)
from .page_size import DEFAULT_PAGE_SIZE_CANDIDATES, estimate_page_size


logger = logging.getLogger(__name__)

DEFAULT_CONCORDANCE_PAGE = 1
DEFAULT_CONCORDANCE_PAGE_SIZE = 20
DEFAULT_CONCORDANCE_DESCENDING = True


def concordance_non_empty_expr() -> pl.Expr:
    """Build an expression that removes empty concordance rows.





    Why:
    - Drops rows with no meaningful matched/context text before pagination.
    """
    return pl.any_horizontal(
        [
            pl.col(CONC_MATCHED_TEXT_COLUMN)
            .cast(pl.Utf8, strict=False)
            .str.strip_chars()
            .str.len_chars()
            .fill_null(0)
            > 0,
            pl.col(CONC_LEFT_CONTEXT_COLUMN)
            .cast(pl.Utf8, strict=False)
            .str.strip_chars()
            .str.len_chars()
            .fill_null(0)
            > 0,
            pl.col(CONC_RIGHT_CONTEXT_COLUMN)
            .cast(pl.Utf8, strict=False)
            .str.strip_chars()
            .str.len_chars()
            .fill_null(0)
            > 0,
        ]
    )


def build_concordance_lazyframe(
    node_data: pl.LazyFrame,
    column: str,
    request: dict[str, Any],
) -> pl.LazyFrame:
    """Create concordance rows from a source LazyFrame and request options.





    Why:
    - Encapsulates `polars_text.concordance` expansion and filtering in one
      reusable transformation step.
    """
    import polars_text as pt

    search_pattern, use_regex = build_concordance_search_pattern(
        request["search_word"],
        regex=bool(request["regex"]),
        whole_word=bool(request.get("whole_word", False)),
    )

    expr = pt.concordance(
        pl.col(column),
        search_pattern,
        num_left_tokens=request["num_left_tokens"],
        num_right_tokens=request["num_right_tokens"],
        regex=use_regex,
        case_sensitive=request["case_sensitive"],
        remove_punct=bool(request.get("ignore_punctuation", False)),
    )
    return node_data.select([pl.all(), expr.alias("concordance")])


def build_concordance_search_pattern(
    search_word: str,
    *,
    regex: bool,
    whole_word: bool,
) -> tuple[str, bool]:
    """Return the effective concordance pattern and whether regex mode is needed.



    Used by concordance workers and live result queries.
    """
    if not whole_word:
        return search_word, regex

    base_pattern = search_word if regex else re.escape(search_word)
    return rf"\b(?:{base_pattern})\b", True


def _project_concordance_hit(
    raw_hit: dict[str, Any],
    *,
    document_text: str | None = None,
    contexts_include_separators: bool = False,
) -> dict[str, Any]:
    """Project one raw concordance struct into canonical response columns.

    When ``document_text`` is provided, ``CONC_extraction`` is computed
    using the same slicing rule as the worker-side materialised parquet.
    """
    start_idx = raw_hit.get("start_idx")
    end_idx = raw_hit.get("end_idx")
    projected: dict[str, Any] = {
        CONC_LEFT_CONTEXT_COLUMN: raw_hit.get("left_context"),
        CONC_MATCHED_TEXT_COLUMN: raw_hit.get("matched_text"),
        CONC_RIGHT_CONTEXT_COLUMN: raw_hit.get("right_context"),
        CONC_START_IDX_COLUMN: start_idx,
        CONC_END_IDX_COLUMN: end_idx,
        CONC_L1_COLUMN: raw_hit.get("l1"),
        CONC_R1_COLUMN: raw_hit.get("r1"),
    }
    if document_text is not None and start_idx is not None and end_idx is not None:
        projected[CONC_EXTRACTION_COLUMN] = compute_concordance_extraction_string(
            document_text=document_text,
            left_context=raw_hit.get("left_context"),
            right_context=raw_hit.get("right_context"),
            start_idx=int(start_idx),
            end_idx=int(end_idx),
            contexts_include_separators=contexts_include_separators,
        )
    return projected


def _concordance_hit_has_content(hit: dict[str, Any]) -> bool:
    """Return whether a projected concordance hit contains meaningful text."""
    for key in (
        CONC_MATCHED_TEXT_COLUMN,
        CONC_LEFT_CONTEXT_COLUMN,
        CONC_RIGHT_CONTEXT_COLUMN,
    ):
        value = hit.get(key)
        if value is None:
            continue
        if str(value).strip():
            return True
    return False


def _column_metadata(
    columns: list[str],
    concordance_columns: tuple[str, ...],
) -> dict[str, list[str]]:
    """Support concordance computation helpers with a column metadata helper."""

    return {
        "concordance_columns": [c for c in columns if c in concordance_columns],
        "metadata_columns": [c for c in columns if c not in concordance_columns],
        "all_columns": columns,
    }


def _serialize_grouped_concordance_rows(
    result_df: pl.DataFrame,
    *,
    node_label: str | None = None,
    text_column: str | None = None,
    contexts_include_separators: bool = False,
) -> tuple[list[list[dict[str, Any]]], list[str]]:
    """Serialize collected concordance rows into grouped per-document hit lists.

    When ``text_column`` is given and that column survives on the result frame
    (it normally does — ``build_concordance_lazyframe`` keeps ``pl.all()``),
    each projected hit gets a ``CONC_extraction`` field with the stitched
    raw KWIC window.
    """
    if result_df.height == 0:
        return [], []

    metadata_columns = [
        column for column in result_df.columns if column != "concordance"
    ]
    has_extraction = bool(text_column) and text_column in metadata_columns
    columns = [
        *metadata_columns,
        *CORE_CONCORDANCE_COLUMNS,
    ]
    if has_extraction:
        columns.append(CONC_EXTRACTION_COLUMN)
    if node_label:
        columns.append("__source_node")

    grouped_rows: list[list[dict[str, Any]]] = []
    for row in result_df.to_dicts():
        raw_hits = row.get("concordance") or []
        if not isinstance(raw_hits, list):
            continue

        base_row = {key: value for key, value in row.items() if key != "concordance"}
        document_text: str | None = None
        if has_extraction:
            raw_doc = base_row.get(text_column)
            document_text = str(raw_doc) if raw_doc is not None else ""
        grouped_hits: list[dict[str, Any]] = []
        for raw_hit in raw_hits:
            if not isinstance(raw_hit, dict):
                continue
            projected_hit = {
                **base_row,
                **_project_concordance_hit(
                    raw_hit,
                    document_text=document_text,
                    contexts_include_separators=contexts_include_separators,
                ),
            }
            if node_label:
                projected_hit["__source_node"] = node_label
            if _concordance_hit_has_content(projected_hit):
                grouped_hits.append(projected_hit)

        if grouped_hits:
            grouped_rows.append(grouped_hits)

    return grouped_rows, columns


def compute_concordance_page(
    base_lf: pl.LazyFrame,
    column: str,
    request: dict[str, Any],
    *,
    page: int,
    page_size: int | None,
    sort_by: str | None,
    descending: bool,
    node_label: str | None = None,
) -> dict[str, Any]:
    """Compute one concordance page for a single node source.





    Why:
    - Produces a stable page payload shape shared by single-node and combined
      result views. When `page_size` is None the size is estimated from the
      configured candidate ladder so the first page yields dense results.
    """
    total_rows_df = base_lf.select(pl.len()).collect()
    total_source_rows = total_rows_df.item()

    resolved_page_size = _resolve_page_size(base_lf, column, request, page_size)

    effective_sort_by: str | None = None
    if sort_by:
        schema = base_lf.collect_schema()
        if sort_by not in schema or sort_by in CORE_CONCORDANCE_COLUMNS:
            raise InvalidInputError("Sort column is not available for concordance")
        base_lf = base_lf.sort(sort_by, descending=descending)
        effective_sort_by = sort_by

    start = (page - 1) * resolved_page_size
    page_lf = base_lf.slice(start, resolved_page_size)

    concordance_lf = build_concordance_lazyframe(page_lf, column, request)
    result_df = concordance_lf.collect()
    page_rows, columns = _serialize_grouped_concordance_rows(
        result_df,
        node_label=node_label,
        text_column=column,
        contexts_include_separators=bool(
            request.get("ignore_punctuation", False)
        ),
    )

    total_source_pages = (
        math.ceil(total_source_rows / resolved_page_size) if total_source_rows else 0
    )

    # `CONC_extraction` is intentionally classified under `metadata_columns`
    # so the existing metadata-columns picker offers it as an opt-in toggle,
    # matching the rest of the user-controllable column set. The CONC_
    # prefix makes the source obvious; behaviourally it's "an optional column
    # you can show or use for Derived Data Block Creation if you want it."
    metadata = _column_metadata(columns, CORE_CONCORDANCE_COLUMNS)

    return {
        "data": serialize_json_rows(page_rows),
        "columns": columns,
        "metadata": metadata,
        "pagination": {
            "page": page,
            "page_size": resolved_page_size,
            "total_source_rows": total_source_rows,
            "total_source_pages": total_source_pages,
            "result_count": len(page_rows),
            "has_next": page < total_source_pages,
            "has_prev": page > 1,
        },
        "sorting": {
            "sort_by": effective_sort_by,
            "descending": descending,
        },
    }


def compute_node_concordance_page(
    src: dict[str, Any],
    request: dict[str, Any],
    *,
    page: int,
    page_size: int | None,
    sort_by: str | None,
    descending: bool,
) -> dict[str, Any]:
    """Route a node to either regex-mode or tokens-mode page computation.

    Tokens mode requires callers to supply the temporary token column produced
    from the immutable Analysis request. Text mode ignores tokenizer mappings.
    """
    base_lf = src["lf"]
    column = src["column"]
    label = src.get("label")
    tokenization_column = src.get("tokenization_column")
    search_mode = str(request.get("search_mode") or "regex")

    node_request: dict[str, Any] = dict(request)

    if search_mode == "tokens":
        if not tokenization_column:
            raise ValueError("Tokens-mode concordance requires tokenized input")
        effective_page_size = (
            int(page_size)
            if page_size is not None and int(page_size) > 0
            else DEFAULT_CONCORDANCE_PAGE_SIZE
        )
        return compute_tokens_concordance_page(
            base_lf,
            column=column,
            tokenization_column=tokenization_column,
            request=node_request,
            page=page,
            page_size=effective_page_size,
            sort_by=sort_by,
            descending=descending,
            node_label=label,
        )
    return compute_concordance_page(
        base_lf,
        column,
        node_request,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        descending=descending,
        node_label=label,
    )


def _count_concordance_hits(
    base_lf: pl.LazyFrame,
    column: str,
    request: dict[str, Any],
    size: int,
) -> int:
    """Return occurrence count when running concordance on the first `size` rows.

    Used by the bounded first-page density estimator.
    """
    slice_lf = build_concordance_lazyframe(base_lf.slice(0, size), column, request)
    count_df = slice_lf.select(
        pl.col("concordance").list.len().fill_null(0).sum().alias("total")
    ).collect()
    value = count_df.item()
    return int(value or 0)


def _count_tokens_concordance_hits(
    base_lf: pl.LazyFrame,
    column: str,
    tokenization_column: str,
    request: dict[str, Any],
    size: int,
) -> int:
    """Tokens-mode equivalent of :func:`_count_concordance_hits`.

    Walks the first ``size`` rows of the tokenization column and counts
    exact-token matches of ``search_word``. Without this, the page-size
    estimator probes via the regex engine, which produces 0 hits for CJK
    queries (``\b``-style whole-word semantics don't apply) and pushes the
    estimator all the way to the largest candidate.

    Used by the bounded first-page density estimator for token-aware results.
    """
    search_word = str(request.get("search_word") or "")
    if not search_word:
        return 0
    case_sensitive = bool(request.get("case_sensitive", False))
    slice_lf = base_lf.slice(0, size)
    slice_df = slice_lf.select(tokenization_column).collect()
    total = 0
    for tokens in slice_df.get_column(tokenization_column).to_list():
        if not isinstance(tokens, list) or not tokens:
            continue
        total += len(
            find_token_matches(tokens, search_word, case_sensitive=case_sensitive)
        )
    return total


def _resolve_page_size(
    base_lf: pl.LazyFrame,
    column: str,
    request: dict[str, Any],
    requested: int | None,
    *,
    tokenization_column: str | None = None,
) -> int:
    """Return an effective page size, estimating when the client omitted one.

    For tokens-mode requests, the probe walks the request-produced tokens
    column directly so CJK searches estimate against actual hit density.
    """
    if requested is not None and int(requested) > 0:
        return int(requested)
    use_tokens_probe = (
        str(request.get("search_mode") or "regex") == "tokens"
        and tokenization_column is not None
    )
    if use_tokens_probe:
        probe = partial(
            _count_tokens_concordance_hits,
            base_lf,
            column,
            tokenization_column,
            request,
        )
    else:
        probe = partial(_count_concordance_hits, base_lf, column, request)
    return estimate_page_size(probe, candidates=DEFAULT_PAGE_SIZE_CANDIDATES)
