"""Token Frequency analysis endpoints extracted from workspaces monolith.

Paths preserved exactly as /workspaces/{workspace_id}/token-frequencies*.
"""

from fastapi import APIRouter, Depends, HTTPException

from ....core.analysis_store import clear_analyses, get_latest_analysis, save_analysis
from ....core.auth import get_current_user
from ....core.workspace import workspace_manager
from ....models import (
    TokenFrequencyData,
    TokenFrequencyRequest,
    TokenFrequencyResponse,
    TokenStatisticsData,
)

# This router uses the same '/workspaces' prefix as the base router so paths are identical
# to their original definitions when included at top level.
router = APIRouter(prefix="/workspaces")


@router.get("/{workspace_id}/token-frequencies/current-request")
async def token_frequencies_current_request(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    rec = get_latest_analysis(user_id, workspace_id, task="token_frequencies")
    if not rec:
        return None
    return {"state": "successful", "message": "ok", "data": rec.request}


@router.post("/{workspace_id}/token-frequencies/current-request")
async def update_token_frequencies_current_request(
    workspace_id: str,
    request_update: dict,
    current_user: dict = Depends(get_current_user),
):
    """Update the last saved token_frequencies request (e.g., stop_words) without recomputing results."""
    user_id = current_user["id"]
    prev = get_latest_analysis(user_id, workspace_id, task="token_frequencies")
    merged_req: dict = {}
    if prev and isinstance(prev.request, dict):
        merged_req = {**prev.request}
    try:
        merged_req.update(request_update or {})
    except Exception:
        pass
    prev_result: dict = prev.result if prev and isinstance(prev.result, dict) else {}
    try:
        save_analysis(
            user_id=user_id,
            workspace_id=workspace_id,
            task="token_frequencies",
            request_dict=merged_req,
            result_dict=prev_result,
        )
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Failed to save request: {e}")
    return {"state": "successful", "message": "saved", "data": merged_req}


@router.get("/{workspace_id}/token-frequencies/current-result")
async def token_frequencies_current_result(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    rec = get_latest_analysis(user_id, workspace_id, task="token_frequencies")
    if not rec:
        return None
    stored = rec.result
    if (
        isinstance(stored, dict)
        and "data" in stored
        and ("status" in stored or "success" in stored or "state" in stored)
        and isinstance(stored["data"], (dict, list))
    ):
        inner = stored["data"]
        if (
            isinstance(inner, dict)
            and "data" in inner
            and ("status" in inner or "success" in inner or "state" in inner)
        ):
            inner = inner["data"]
        domain = inner
    else:
        domain = stored
    return {"state": "successful", "message": "ok", "data": domain}


@router.post("/{workspace_id}/token-frequencies/clear")
async def clear_token_frequencies_results(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    removed = clear_analyses(user_id, workspace_id, task="token_frequencies")
    return {"state": "successful", "cleared": {"analyses_removed": removed}}


@router.post(
    "/{workspace_id}/token-frequencies",
    response_model=TokenFrequencyResponse,
    summary="Calculate token frequencies for selected nodes",
    description="Calculate and compare token frequencies across one or two nodes using the docframe library",
)
async def calculate_token_frequencies(
    workspace_id: str,
    request: TokenFrequencyRequest,
    current_user: dict = Depends(get_current_user),
):
    """Calculate token frequencies for the specified nodes."""
    try:
        user_id = current_user["id"]

        if not request.node_ids:
            raise HTTPException(
                status_code=400, detail="At least one node ID must be provided"
            )
        if request.limit is not None and request.limit <= 0:
            raise HTTPException(
                status_code=400, detail="limit must be a positive integer"
            )
        if len(request.node_ids) > 2:
            raise HTTPException(
                status_code=400, detail="Maximum of 2 nodes can be compared"
            )
        if not request.node_columns:
            request.node_columns = {}

        workspace = workspace_manager.get_workspace(user_id, workspace_id)
        if not workspace:
            raise HTTPException(
                status_code=404, detail=f"Workspace {workspace_id} not found"
            )

        try:
            import polars as pl

            from docframe import DocDataFrame, DocLazyFrame
        except ImportError as e:
            raise HTTPException(
                status_code=500, detail=f"Required libraries not available: {str(e)}"
            )

        frames_dict = {}

        for node_id in request.node_ids:
            node = workspace_manager.get_node_from_workspace(
                user_id, workspace_id, node_id
            )
            if not node:
                raise HTTPException(status_code=404, detail=f"Node {node_id} not found")

            node_data = node.data if hasattr(node, "data") else node
            node_name = node.name if hasattr(node, "name") and node.name else node_id

            try:
                is_doc_frame = isinstance(node_data, (DocDataFrame, DocLazyFrame))
                is_lazy = isinstance(node_data, (DocLazyFrame, pl.LazyFrame))

                if hasattr(node_data, "columns"):
                    available_columns = node_data.columns
                elif hasattr(node_data, "collect_schema"):
                    available_columns = list(node_data.collect_schema().keys())
                elif hasattr(node_data, "schema"):
                    available_columns = list(node_data.schema.keys())
                else:
                    available_columns = []

                column_name = request.node_columns.get(node_id)

                if not column_name:
                    if is_doc_frame:
                        if (
                            hasattr(node_data, "document_column")
                            and node_data.document_column
                        ):
                            column_name = node_data.document_column
                        else:
                            for col in [
                                "document",
                                "text",
                                "content",
                                "body",
                                "message",
                            ]:
                                if col in available_columns:
                                    column_name = col
                                    break
                            if not column_name:
                                raise HTTPException(
                                    status_code=400,
                                    detail=(
                                        f"Could not auto-detect text column for DocFrame node {node_id}. "
                                        f"Available columns: {available_columns}. Please specify a column name."
                                    ),
                                )
                    else:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Column specification required for node {node_id}. Available columns: {available_columns}",
                        )

                if column_name not in available_columns:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Column '{column_name}' not found in node {node_id}. Available columns: {available_columns}",
                    )

                try:
                    from docframe import DocDataFrame as _DDF  # type: ignore
                    from docframe import DocLazyFrame as _DLF  # type: ignore
                except Exception as _e:  # pragma: no cover
                    raise HTTPException(
                        status_code=500,
                        detail=f"docframe not available for token frequency: {_e}",
                    )

                if isinstance(node_data, _DLF):
                    if column_name == node_data.document_column:
                        processed_frame = node_data
                    else:
                        base_lazy = node_data.to_lazyframe()
                        selected_lazy = base_lazy.select(
                            pl.col(column_name).alias("document")
                        )
                        processed_frame = _DLF(
                            selected_lazy, document_column="document"
                        )
                elif isinstance(node_data, _DDF):
                    if column_name == node_data.document_column:  # type: ignore[attr-defined]
                        processed_frame = node_data
                    else:
                        selected_df_any = node_data.select(
                            pl.col(column_name).alias("document")
                        )  # type: ignore[call-arg]
                        if not isinstance(selected_df_any, pl.DataFrame) and hasattr(
                            selected_df_any, "collect"
                        ):
                            try:  # type: ignore[call-arg]
                                selected_df_any = selected_df_any.collect()  # type: ignore[assignment]
                            except Exception:  # pragma: no cover
                                pass
                        if not isinstance(
                            selected_df_any, pl.DataFrame
                        ):  # pragma: no cover
                            raise HTTPException(
                                status_code=500,
                                detail="Failed to materialize DataFrame for token frequency calculation",
                            )
                        processed_frame = _DDF(
                            selected_df_any, document_column="document"
                        )
                else:
                    selected_data = node_data.select(
                        pl.col(column_name).alias("document")
                    )
                    if is_lazy:
                        processed_frame = DocLazyFrame(selected_data)
                    else:
                        if hasattr(selected_data, "collect"):
                            selected_data = selected_data.collect()
                        processed_frame = DocDataFrame(selected_data)

                frames_dict[node_name] = processed_frame

            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(
                    status_code=500, detail=f"Error processing node {node_id}: {str(e)}"
                )

        try:
            from docframe.core.text_utils import compute_token_frequencies
        except ImportError:
            raise HTTPException(
                status_code=500,
                detail="docframe library not available for token frequency calculation",
            )

        frequency_results, stats_df = compute_token_frequencies(
            frames=frames_dict, stop_words=request.stop_words
        )

        response_data = {}
        for frame_name, freq_dict in frequency_results.items():
            sorted_tokens = sorted(freq_dict.items(), key=lambda x: x[1], reverse=True)
            response_data[frame_name] = {
                "data": [
                    TokenFrequencyData(token=token, frequency=freq)
                    for token, freq in sorted_tokens
                    if freq > 0
                ],
                "columns": ["token", "frequency"],
            }

        statistics_data = None
        if (
            len(request.node_ids) == 2
            and stats_df is not None
            and not stats_df.is_empty()
        ):
            statistics_data = []
            for row in stats_df.iter_rows(named=True):
                statistics_data.append(
                    TokenStatisticsData(
                        token=row["token"],
                        freq_corpus_0=int(row["freq_corpus_0"]),
                        freq_corpus_1=int(row["freq_corpus_1"]),
                        expected_0=float(row["expected_0"]),
                        expected_1=float(row["expected_1"]),
                        corpus_0_total=int(row["corpus_0_total"]),
                        corpus_1_total=int(row["corpus_1_total"]),
                        percent_corpus_0=float(row["percent_corpus_0"]),
                        percent_corpus_1=float(row["percent_corpus_1"]),
                        percent_diff=float(row["percent_diff"]),
                        log_likelihood_llv=float(row["log_likelihood_llv"]),
                        bayes_factor_bic=float(row["bayes_factor_bic"]),
                        effect_size_ell=float(row["effect_size_ell"]),
                        relative_risk=float(row["relative_risk"])
                        if row["relative_risk"] is not None
                        else None,
                        log_ratio=float(row["log_ratio"])
                        if row["log_ratio"] is not None
                        else None,
                        odds_ratio=float(row["odds_ratio"])
                        if row["odds_ratio"] is not None
                        else None,
                        significance=str(row["significance"]),
                    )
                )

        result = TokenFrequencyResponse(
            state="successful",
            message=f"Successfully calculated token frequencies for {len(frames_dict)} node(s)",
            data=response_data,
            statistics=statistics_data,
        )

        try:  # pragma: no cover
            req_dict = (
                request.model_dump(exclude_none=True)
                if hasattr(request, "model_dump")
                else request.dict(exclude_none=True)
            )
            result_dict = (
                result.model_dump(exclude_none=True)
                if hasattr(result, "model_dump")
                else result.dict(exclude_none=True)
            )
            save_analysis(
                user_id=user_id,
                workspace_id=workspace_id,
                task="token_frequencies",
                request_dict=req_dict,
                result_dict=result_dict,
            )
        except Exception as _persist_err:  # pragma: no cover
            print(f"[analysis_persist] token_frequencies save failed: {_persist_err}")

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error calculating token frequencies: {str(e)}"
        )
