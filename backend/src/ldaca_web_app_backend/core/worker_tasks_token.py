"""Token-frequency worker task implementation.

Separated from `worker.py` to keep the worker module focused and smaller.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from .analysis_helpers import safe_float, sanitize_stop_words


def run_token_frequencies_task(
    configure_worker_environment,
    user_id: str,
    workspace_id: str,
    node_ids: list[str],
    node_columns: Dict[str, str],
    token_limit: int = 10,
    stop_words: Optional[list[str]] = None,
    progress_callback: Optional[callable] = None,
) -> Dict[str, Any]:
    """Execute token frequency analysis in a worker process."""

    configure_worker_environment()

    try:
        import polars as pl
        import polars_text as pt
        from ldaca_web_app_backend.core.workspace import workspace_manager

        print(f"[Worker] Starting token frequencies task for workspace {workspace_id}")

        if progress_callback:
            progress_callback(0.1, "Initializing workspace...")

        workspace = workspace_manager.get_workspace(user_id, workspace_id)
        if not workspace:
            success = workspace_manager.set_current_workspace(user_id, workspace_id)
            if success:
                workspace = workspace_manager.get_workspace(user_id, workspace_id)
        if not workspace:
            raise ValueError(
                f"Workspace {workspace_id} not found (worker process cannot access workspace)"
            )

        if progress_callback:
            progress_callback(0.2, "Loading node data...")

        requested_stop_words = sanitize_stop_words(stop_words)
        effective_limit = int(token_limit) if int(token_limit) > 0 else 10

        DEFAULT_TOKEN_LIMIT = 10
        SERVER_LIMIT_MULTIPLIER = 5
        MAX_SERVER_TOKEN_LIMIT = 5000
        server_limit = min(
            max(effective_limit * SERVER_LIMIT_MULTIPLIER, DEFAULT_TOKEN_LIMIT),
            MAX_SERVER_TOKEN_LIMIT,
        )

        frames_dict: dict[str, object] = {}
        node_display_names: dict[str, str] = {}

        for i, node_id in enumerate(node_ids):
            node = workspace_manager.get_node_from_workspace(
                user_id, workspace_id, node_id
            )
            if not node:
                raise ValueError(f"Node {node_id} not found")

            node_data = getattr(node, "data", None)
            if not isinstance(node_data, pl.LazyFrame):
                raise ValueError(f"Node {node_id} data must be a LazyFrame")
            node_name = getattr(node, "name", None) or node_id
            node_display_names[node_id] = node_name

            available_columns = list(node_data.collect_schema().names())

            column_name = node_columns.get(node_id)
            if not column_name:
                raise ValueError(f"No column specified for node {node_id}")
            if column_name not in available_columns:
                raise ValueError(
                    f"Column '{column_name}' not found in node {node_id}. Available columns: {available_columns}"
                )

            frames_dict[node_id] = node_data.collect()

            if progress_callback:
                progress_callback(
                    0.2 + 0.3 * (i + 1) / max(len(node_ids), 1),
                    f"Prepared {node_name}",
                )

        if progress_callback:
            progress_callback(0.6, "Computing token frequencies...")

        frequency_results: dict[str, dict[str, int]] = {}
        stats_df = None
        for node_id, df in frames_dict.items():
            series = df.get_column(node_columns[node_id])
            frequency_results[node_id] = pt.token_frequencies(series)

        if len(node_ids) == 2:
            stats_df = pt.token_frequency_stats(
                frequency_results[node_ids[0]],
                frequency_results[node_ids[1]],
            )

        if progress_callback:
            progress_callback(0.85, "Formatting results...")

        response_data: dict[str, dict] = {}
        for frame_key, freq_dict in frequency_results.items():
            sorted_tokens = sorted(freq_dict.items(), key=lambda x: x[1], reverse=True)
            filtered_tokens = [
                (token, freq) for token, freq in sorted_tokens if freq and freq > 0
            ]
            total_tokens = len(filtered_tokens)
            display_name = node_display_names.get(frame_key, frame_key)
            response_data[frame_key] = {
                "data": [
                    {"token": token, "frequency": int(freq)}
                    for token, freq in filtered_tokens
                ],
                "columns": ["token", "frequency"],
                "metadata": {
                    "applied_server_limit": None,
                    "total_tokens_before_limit": total_tokens,
                    "total_tokens_returned": total_tokens,
                    "truncated": False,
                    "token_limit": effective_limit,
                    "node_id": frame_key,
                    "display_name": display_name,
                    "node_name": display_name,
                },
            }

        statistics_data = None
        if (
            len(node_ids) == 2
            and stats_df is not None
            and hasattr(stats_df, "is_empty")
            and not stats_df.is_empty()
        ):
            statistics_data = []
            for row in stats_df.iter_rows(named=True):
                statistics_data.append({
                    "token": row["token"],
                    "freq_corpus_0": int(row["freq_corpus_0"]),
                    "freq_corpus_1": int(row["freq_corpus_1"]),
                    "expected_0": safe_float(row.get("expected_0")) or 0.0,
                    "expected_1": safe_float(row.get("expected_1")) or 0.0,
                    "corpus_0_total": int(row["corpus_0_total"]),
                    "corpus_1_total": int(row["corpus_1_total"]),
                    "percent_corpus_0": safe_float(row.get("percent_corpus_0")) or 0.0,
                    "percent_corpus_1": safe_float(row.get("percent_corpus_1")) or 0.0,
                    "percent_diff": safe_float(row.get("percent_diff")) or 0.0,
                    "log_likelihood_llv": safe_float(row.get("log_likelihood_llv"))
                    or 0.0,
                    "bayes_factor_bic": safe_float(row.get("bayes_factor_bic")) or 0.0,
                    "effect_size_ell": safe_float(row.get("effect_size_ell")) or 0.0,
                    "relative_risk": safe_float(row.get("relative_risk"), default=None)
                    if row.get("relative_risk") is not None
                    else None,
                    "log_ratio": safe_float(row.get("log_ratio"), default=None)
                    if row.get("log_ratio") is not None
                    else None,
                    "odds_ratio": safe_float(row.get("odds_ratio"), default=None)
                    if row.get("odds_ratio") is not None
                    else None,
                    "significance": str(row.get("significance")),
                })

        analysis_params_dict = {
            "node_ids": list(node_ids),
            "node_columns": dict(node_columns),
            "token_limit": effective_limit,
            "server_limit": server_limit,
            "stop_words": requested_stop_words,
        }

        result_payload: Dict[str, Any] = {
            "state": "successful",
            "message": f"Successfully calculated token frequencies for {len(frames_dict)} node(s)",
            "data": response_data,
            "statistics": statistics_data,
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
