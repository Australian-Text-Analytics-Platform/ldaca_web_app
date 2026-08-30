"""Process-worker implementation for token-frequency analysis.

Used by:
- canonical Analysis execution and backend tests that exercise token-frequency
  computation from immutable inputs.

Flow: tokenize from immutable request parameters, aggregate frequencies, and
persist derived artifacts for result queries.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any
from collections.abc import Callable
import uuid

from .utils import process_entrypoint

logger = logging.getLogger(__name__)

_COMPARATIVE_STATISTICS_COLUMN_NAMES = {
    "freq_corpus_0": "freq_reference",
    "percent_corpus_0": "percent_reference",
    "expected_0": "expected_reference",
    "corpus_0_total": "reference_total",
    "freq_corpus_1": "freq_study",
    "percent_corpus_1": "percent_study",
    "expected_1": "expected_study",
    "corpus_1_total": "study_total",
}


def _prepare_snapshot_inputs(
    *,
    input_snapshot_dir: str,
    scratch_dir: str,
    node_ids: list[uuid.UUID],
    node_columns: dict[uuid.UUID, str],
    node_tokenizer_models: dict[uuid.UUID, str],
    token_cache_path: str | None,
) -> tuple[
    dict[uuid.UUID, list[str]],
    dict[uuid.UUID, str],
    dict[uuid.UUID, str],
]:
    """Load one canonical snapshot into computation-only corpus inputs."""

    import polars as pl

    from ..analysis.token_cache import PLAIN_WORDS_EN_MODEL, tokenize_lazyframe
    from ..infrastructure.storage.input_snapshots import load_snapshot_node

    scratch_root = Path(scratch_dir)
    scratch_root.mkdir(parents=True, exist_ok=True)
    corpora: dict[uuid.UUID, list[str]] = {}
    display_names: dict[uuid.UUID, str] = {}
    token_streams: dict[uuid.UUID, str] = {}
    for node_id in node_ids:
        snapshot_node = load_snapshot_node(input_snapshot_dir, node_id)
        source_column = node_columns[node_id]
        display_names[node_id] = snapshot_node.name
        tokenizer_model = node_tokenizer_models[node_id]
        if tokenizer_model == PLAIN_WORDS_EN_MODEL:
            docs_df = snapshot_node.data.select(
                pl.col(source_column).alias("__doc_col__")
            ).collect()
            corpora[node_id] = [
                str(value) if value is not None else ""
                for value in docs_df["__doc_col__"].to_list()
            ]
            continue
        node_data, tokenization_col = tokenize_lazyframe(
            data=snapshot_node.data,
            source_column=source_column,
            model=tokenizer_model,
            cache_path=token_cache_path,
        )
        stream_path = scratch_root / f"token-stream-{node_id}.parquet"
        (
            node_data.select(
                pl.col(tokenization_col)
                .list.eval(pl.element().struct.field("token"))
                .explode()
                .alias("token")
            )
            .filter(pl.col("token").is_not_null())
            .sink_parquet(stream_path)
        )
        token_streams[node_id] = str(stream_path)
    return corpora, display_names, token_streams


def _compute_token_frequencies(
    node_corpora: dict[uuid.UUID, list[str]],
    node_display_names: dict[uuid.UUID, str],
    artifact_dir: str,
    token_limit: int = 10,
    progress_callback: Callable[[float, str], None] | None = None,
    node_token_streams: dict[uuid.UUID, str] | None = None,
    node_tokenizer_models: dict[uuid.UUID, str] | None = None,
) -> dict[str, Any]:
    """Execute token-frequency analysis inside a worker process.

    Used by:
    - canonical token-frequency Analysis execution, which owns submission,
      progress, cancellation, and artifact cleanup.
    Why:
        - Computes token frequencies off the API thread and writes Parquet artifacts
            for main-process lazy retrieval.

    Flow: tokenize from immutable request parameters, aggregate frequencies,
        and persist derived artifacts for result queries.
    """
    try:
        if progress_callback:
            progress_callback(0.02, "Loading token frequency resources...")

        import polars as pl
        import polars_text as pt

        logger.info("Starting token-frequency Analysis")

        artifact_root = Path(artifact_dir)
        artifact_root.mkdir(parents=True, exist_ok=True)

        if progress_callback:
            progress_callback(0.1, "Validating payload...")

        if progress_callback:
            progress_callback(0.2, "Preparing text data...")

        if token_limit < 1:
            raise ValueError("token_limit must be positive")
        effective_limit = token_limit

        token_streams = dict(node_token_streams or {})
        corpora = dict(node_corpora or {})
        display_names = dict(node_display_names or {})
        requested_node_tokenizer_models = {
            node_id: model.strip()
            for node_id, model in (node_tokenizer_models or {}).items()
            if model and model.strip()
        }

        prepared_node_ids = list({**corpora, **token_streams}.keys())
        if not prepared_node_ids:
            raise ValueError("At least one corpus is required")
        if len(prepared_node_ids) > 2:
            raise ValueError("Maximum of 2 corpora can be compared")
        missing_tokenizer_model_node_ids = [
            node_id
            for node_id in corpora
            if node_id not in requested_node_tokenizer_models
        ]
        if missing_tokenizer_model_node_ids:
            raise ValueError(
                "node_tokenizer_models must include a tokenizer model for raw-text nodes: "
                + ", ".join(map(str, missing_tokenizer_model_node_ids))
            )

        for i, node_id in enumerate(prepared_node_ids):
            node_name = display_names.get(node_id) or str(node_id)

            if progress_callback:
                progress_callback(
                    0.2 + 0.3 * (i + 1) / max(len(prepared_node_ids), 1),
                    f"Prepared text data for {node_name}",
                )

        if progress_callback:
            progress_callback(0.6, "Computing token frequencies...")

        frequency_results: dict[uuid.UUID, dict[str, int]] = {}
        stats_df = None
        for node_id in prepared_node_ids:
            if node_id in token_streams:
                # The API endpoint spilled one row per token (post-explode,
                # post-null-filter) to a parquet via
                # ``sink_parquet`` so we count in Polars without
                # round-tripping through Python objects. The endpoint
                # guarantees the column name is ``token``.
                # ``scan_parquet`` + ``group_by`` + ``len`` stays lazy
                # until the final ``collect`` returns a small N×2 frame.
                freq_df = (
                    pl.scan_parquet(token_streams[node_id])
                    .group_by("token")
                    .len()
                    .rename({"len": "frequency"})
                    .with_columns(
                        pl.col("token").cast(pl.Utf8),
                        pl.col("frequency").cast(pl.Int64),
                    )
                    .collect()
                )
                frequency_results[node_id] = {
                    str(row["token"]): int(row["frequency"])
                    for row in freq_df.to_dicts()
                }
            else:
                docs = corpora.get(node_id) or []
                series = pl.Series(
                    "document",
                    [str(v) if v is not None else "" for v in docs],
                )
                effective_tokenizer_model = requested_node_tokenizer_models[node_id]
                frequency_results[node_id] = pt.token_frequencies(
                    series,
                    model=effective_tokenizer_model,
                )

        if len(prepared_node_ids) == 2:
            stats_df = pt.token_frequency_stats(
                frequency_results[prepared_node_ids[0]],
                frequency_results[prepared_node_ids[1]],
            )
            stats_df = stats_df.rename(
                {
                    source: target
                    for source, target in _COMPARATIVE_STATISTICS_COLUMN_NAMES.items()
                    if source in stats_df.columns
                }
            )

        if progress_callback:
            progress_callback(0.85, "Writing token-frequency results...")

        node_artifacts: list[dict[str, Any]] = []
        for frame_key, freq_dict in frequency_results.items():
            sorted_tokens = sorted(freq_dict.items(), key=lambda x: x[1], reverse=True)
            filtered_tokens = [
                (token, freq) for token, freq in sorted_tokens if freq and freq > 0
            ]
            token_rows = [
                {"token": token, "frequency": int(freq)}
                for token, freq in filtered_tokens
            ]
            token_path = artifact_root / f"tokens-{frame_key}.arrows"
            token_frame = pl.DataFrame(token_rows).with_columns(
                [
                    pl.col("token").cast(pl.Utf8),
                    pl.col("frequency").cast(pl.Int64),
                ]
            )
            from ..shared.table_transport import write_ipc_stream

            write_ipc_stream(token_frame, str(token_path))
            display_name = display_names.get(frame_key, str(frame_key))
            node_artifacts.append(
                {
                    "node_id": frame_key,
                    "node_name": display_name,
                    "table": {
                        "table_id": f"tokens-{frame_key}",
                        "artifact": str(token_path),
                    },
                }
            )

        statistics_table: dict[str, str] | None = None
        if len(prepared_node_ids) == 2 and stats_df is not None:
            stats_path = artifact_root / "statistics.arrows"
            write_ipc_stream(stats_df, str(stats_path))
            statistics_table = {
                "table_id": "statistics",
                "artifact": str(stats_path),
            }

        result_payload: dict[str, Any] = {
            "state": "successful",
            "message": f"Successfully calculated token frequencies for {len(prepared_node_ids)} node(s)",
            "tables": {
                "version": 1,
                "nodes": node_artifacts,
                "statistics": statistics_table,
            },
            "metadata": {
                "effective_token_limit": effective_limit,
            },
        }

        logger.info("Token frequencies completed successfully")
        return result_payload

    except Exception as e:
        logger.error("Token frequencies failed: %s", e)
        raise


@process_entrypoint
def run_token_frequency_analysis(
    *,
    node_ids: list[uuid.UUID],
    node_columns: dict[uuid.UUID, str],
    artifact_dir: str,
    scratch_dir: str,
    input_snapshot_dir: str,
    token_limit: int,
    node_tokenizer_models: dict[uuid.UUID, str],
    token_cache_path: str,
    progress_callback: Callable[[float, str], None] | None = None,
) -> dict[str, Any]:
    """Run the canonical snapshot-only token-frequency process contract."""

    if set(node_tokenizer_models) != set(node_ids):
        raise ValueError("Tokenizer models must exactly match token-frequency nodes")
    if set(node_columns) != set(node_ids):
        raise ValueError("Columns must exactly match token-frequency nodes")
    corpora, display_names, token_streams = _prepare_snapshot_inputs(
        input_snapshot_dir=input_snapshot_dir,
        scratch_dir=scratch_dir,
        node_ids=node_ids,
        node_columns=node_columns,
        node_tokenizer_models=node_tokenizer_models,
        token_cache_path=token_cache_path,
    )
    return _compute_token_frequencies(
        node_corpora=corpora,
        node_display_names=display_names,
        artifact_dir=artifact_dir,
        token_limit=token_limit,
        progress_callback=progress_callback,
        node_token_streams=token_streams,
        node_tokenizer_models=node_tokenizer_models,
    )
