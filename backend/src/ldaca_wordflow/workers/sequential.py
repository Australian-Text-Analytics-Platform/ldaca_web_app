"""Process-worker implementation for sequential Analysis execution.

The Analysis service hands this worker an immutable LazyFrame snapshot and
request payload. The worker performs the Polars aggregation and returns the
result payload that the service persists on the Analysis.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any
from collections.abc import Callable

from .utils import process_entrypoint

logger = logging.getLogger(__name__)


@process_entrypoint
def run_sequential_analysis(
    user_id: str,
    workspace_id: str,
    input_snapshot_dir: str,
    node_id: str,
    artifact_dir: str,
    request_payload: dict[str, Any],
    progress_callback: Callable[[float, str], None] | None = None,
) -> dict[str, Any]:
    """Execute sequential Analysis inside a worker process.

    Used by:
    - the canonical Analysis execution registry because submission must return
      without waiting for computation.

    Flow: load the snapshotted node plan,
    invoke the existing pure-Polars aggregation, and return a JSON-safe payload
    for the Analysis service to publish on the canonical Analysis resource.
    """

    try:
        if progress_callback:
            progress_callback(0.05, "Loading sequential analysis input...")

        from .input_snapshots import load_snapshot_node
        from ..analysis.sequential_core import (
            SEQUENTIAL_GROUP_INDEX_COLUMN,
            SEQUENTIAL_PERIOD_INDEX_COLUMN,
            SEQUENTIAL_PUBLICATION_GROUP_INDEX_COLUMN,
            SEQUENTIAL_PUBLICATION_PERIOD_INDEX_COLUMN,
            _build_sequential_result_frames,
        )
        from ..domain.workspace import SequentialAnalysisRequest
        from ..shared.table_transport import write_ipc_stream

        if "node_id" in request_payload:
            raise ValueError("Sequential node_id must use the snapshot selector")
        snapshot_node = load_snapshot_node(input_snapshot_dir, node_id)
        request = SequentialAnalysisRequest.model_validate(
            {"node_id": node_id, **request_payload}
        )
        if progress_callback:
            progress_callback(0.25, "Running sequential analysis...")

        result_df, publication_df = _build_sequential_result_frames(
            snapshot_node.data,
            time_column=request.time_column,
            group_by_columns=request.group_by_columns,
            frequency=request.frequency,
            sort_by_time=request.sort_by_time,
            column_type=request.column_type,
            numeric_origin=request.numeric_origin,
            numeric_interval=request.numeric_interval,
            custom_interval_value=request.custom_interval_value,
            custom_interval_unit=request.custom_interval_unit,
        )

        result_path = Path(artifact_dir) / "result.arrows"
        publication_path = Path(artifact_dir) / "publication.parquet"
        result_path.parent.mkdir(parents=True, exist_ok=True)
        write_ipc_stream(result_df, str(result_path))
        publication_df.write_parquet(publication_path)

        source_columns = [
            column
            for column in publication_df.columns
            if column
            not in {
                SEQUENTIAL_PUBLICATION_PERIOD_INDEX_COLUMN,
                SEQUENTIAL_PUBLICATION_GROUP_INDEX_COLUMN,
            }
        ]

        return {
            "state": "successful",
            "table": {
                "table_id": "result",
                "artifact": str(result_path),
            },
            "publication_artifact": str(publication_path),
            "source": {
                "node_id": snapshot_node.id,
                "node_name": snapshot_node.name,
                "document_column": snapshot_node.document,
                "columns": source_columns,
                "period_count": result_df.get_column(
                    SEQUENTIAL_PERIOD_INDEX_COLUMN
                ).n_unique(),
                "group_count": result_df.get_column(
                    SEQUENTIAL_GROUP_INDEX_COLUMN
                ).n_unique(),
            },
        }
    except Exception:
        logger.exception(
            "Sequential Analysis failed for user=%s workspace=%s node=%s",
            user_id,
            workspace_id,
            node_id,
        )
        raise


__all__ = ["run_sequential_analysis"]
