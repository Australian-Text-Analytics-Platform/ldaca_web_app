"""Token-frequency worker task implementation.

Separated from `worker.py` to keep the worker module focused and smaller.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Dict, Optional

from .analysis_helpers import sanitize_stop_words


def run_token_frequencies_task(
    configure_worker_environment,
    user_id: str,
    workspace_id: str,
    node_corpora: Dict[str, list[str]],
    node_display_names: Dict[str, str],
    artifact_dir: str,
    artifact_prefix: str,
    token_limit: int = 10,
    stop_words: Optional[list[str]] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Dict[str, Any]:
    """Execute token-frequency analysis inside a worker process.

    Used by:
    - `core.worker.token_frequencies_task`
    - `TASK_REGISTRY["token_frequencies"]`

    Why:
        - Computes token frequencies off the API thread and writes Parquet artifacts
            for main-process lazy retrieval.

    Refactor note:
    - If wrapper indirection is removed, this function can be imported directly
      into `TASK_REGISTRY`.
    """
    configure_worker_environment()

    try:
        import polars as pl
        import polars_text as pt

        print(f"[Worker] Starting token frequencies task for workspace {workspace_id}")

        artifact_root = Path(artifact_dir)
        artifact_root.mkdir(parents=True, exist_ok=True)

        if progress_callback:
            progress_callback(0.1, "Validating payload...")

        if progress_callback:
            progress_callback(0.2, "Preparing corpora...")

        requested_stop_words = sanitize_stop_words(stop_words)
        effective_limit = int(token_limit) if int(token_limit) > 0 else 10

        DEFAULT_TOKEN_LIMIT = 10
        SERVER_LIMIT_MULTIPLIER = 5
        MAX_SERVER_TOKEN_LIMIT = 5000
        server_limit = min(
            max(effective_limit * SERVER_LIMIT_MULTIPLIER, DEFAULT_TOKEN_LIMIT),
            MAX_SERVER_TOKEN_LIMIT,
        )

        node_ids = list(node_corpora.keys())
        if not node_ids:
            raise ValueError("At least one corpus is required")
        if len(node_ids) > 2:
            raise ValueError("Maximum of 2 corpora can be compared")

        for i, node_id in enumerate(node_ids):
            node_name = node_display_names.get(node_id) or node_id

            if progress_callback:
                progress_callback(
                    0.2 + 0.3 * (i + 1) / max(len(node_ids), 1),
                    f"Prepared corpus for {node_name}",
                )

        if progress_callback:
            progress_callback(0.6, "Computing token frequencies...")

        frequency_results: dict[str, dict[str, int]] = {}
        stats_df = None
        for node_id in node_ids:
            docs = node_corpora.get(node_id) or []
            series = pl.Series(
                "document", [str(v) if v is not None else "" for v in docs]
            )
            frequency_results[node_id] = pt.token_frequencies(series)

        if len(node_ids) == 2:
            stats_df = pt.token_frequency_stats(
                frequency_results[node_ids[0]],
                frequency_results[node_ids[1]],
            )

        if progress_callback:
            progress_callback(0.85, "Formatting results...")

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
            token_path = (
                artifact_root
                / f"{artifact_prefix}_token_frequencies_{frame_key}.parquet"
            )
            pl.DataFrame(token_rows).with_columns([
                pl.col("token").cast(pl.Utf8),
                pl.col("frequency").cast(pl.Int64),
            ]).lazy().sink_parquet(token_path)
            display_name = node_display_names.get(frame_key, frame_key)
            node_artifacts.append({
                "node_id": frame_key,
                "node_name": display_name,
                "token_parquet_path": str(token_path),
            })

        statistics_path: str | None = None
        if len(node_ids) == 2 and stats_df is not None:
            stats_path = artifact_root / f"{artifact_prefix}_token_statistics.parquet"
            stats_df.lazy().sink_parquet(stats_path)
            statistics_path = str(stats_path)

        analysis_params_dict = {
            "node_ids": list(node_ids),
            "node_columns": {},
            "token_limit": effective_limit,
            "server_limit": server_limit,
            "stop_words": requested_stop_words,
        }

        result_payload: Dict[str, Any] = {
            "state": "successful",
            "message": f"Successfully calculated token frequencies for {len(node_ids)} node(s)",
            "artifacts": {
                "version": 1,
                "nodes": node_artifacts,
                "statistics_parquet_path": statistics_path,
            },
            "token_limit": effective_limit,
            "analysis_params": analysis_params_dict,
            "metadata": {
                "token_limit": effective_limit,
                "server_limit": server_limit,
                "stop_words": requested_stop_words,
                "node_display_names": {**node_display_names},
            },
            "stop_words": requested_stop_words,
        }

        if progress_callback:
            progress_callback(1.0, "Completed successfully")

        print("[Worker] Token frequencies completed successfully")
        return result_payload

    except Exception as e:
        print(f"[Worker] Token frequencies failed: {str(e)}")
        if progress_callback:
            progress_callback(-1, f"Failed: {str(e)}")
        raise
