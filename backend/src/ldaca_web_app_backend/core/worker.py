"""
Worker module for heavy computational tasks using ProcessPoolExecutor.

This module provides isolation for CPU-intensive tasks like topic modeling,
avoiding GIL issues and Numba threading conflicts by running work in separate processes.
"""

import multiprocessing as mp
import os
from concurrent.futures import Future, ProcessPoolExecutor
from typing import Any, Dict, Optional

# Set up optimal process start method for macOS/Unix
# Only set this in the main process to avoid re-execution issues with PyInstaller
if hasattr(mp, "set_start_method"):
    try:
        # Check if we're in the main process
        if mp.current_process().name == "MainProcess":
            mp.set_start_method("spawn", force=True)
    except RuntimeError:
        pass  # Already set


def _configure_worker_environment():
    """Configure environment variables for numeric libraries in worker processes."""
    # Force safe threading configuration from the start
    os.environ["NUMBA_THREADING_LAYER"] = "workqueue"
    os.environ["NUMBA_THREADING_LAYER_PRIORITY"] = "workqueue omp tbb"
    os.environ["NUMBA_NUM_THREADS"] = "1"
    os.environ["OMP_NUM_THREADS"] = "1"
    os.environ["MKL_NUM_THREADS"] = "1"
    os.environ["OPENBLAS_NUM_THREADS"] = "1"

    print(
        f"[Worker {os.getpid()}] INFO: Using safe workqueue threading (single-threaded)"
    )

    # Try to upgrade to TBB if it's actually available and functional
    tbb_functional = False
    try:
        # Test 1: Check if TBB package is importable
        import tbb  # noqa: F401

        print(f"[Worker {os.getpid()}] INFO: TBB package found")

        # Test 2: Check if Numba can actually use TBB
        try:
            # Try to initialize Numba with TBB temporarily
            old_layer = os.environ.get("NUMBA_THREADING_LAYER")
            try:
                os.environ["NUMBA_THREADING_LAYER"] = "tbb"
                os.environ["NUMBA_THREADING_LAYER_PRIORITY"] = "tbb workqueue omp"

                # Test basic numba compilation with TBB
                import numba as nb

                @nb.jit(nopython=True)
                def _test_tbb():
                    return 42

                result = _test_tbb()
                if result == 42:
                    tbb_functional = True
                    print(f"[Worker {os.getpid()}] SUCCESS: TBB threading functional")

            except Exception as e:
                print(f"[Worker {os.getpid()}] WARNING: TBB test failed: {e}")
                # Restore safe settings
                os.environ["NUMBA_THREADING_LAYER"] = "workqueue"
                os.environ["NUMBA_THREADING_LAYER_PRIORITY"] = "workqueue"
                os.environ["NUMBA_NUM_THREADS"] = "1"

        except Exception as e:
            print(f"[Worker {os.getpid()}] WARNING: Numba TBB check failed: {e}")

    except ImportError:
        print(f"[Worker {os.getpid()}] INFO: TBB package not available")

    # If TBB is functional, configure it properly
    if tbb_functional:
        os.environ["NUMBA_THREADING_LAYER"] = "tbb"
        os.environ["NUMBA_THREADING_LAYER_PRIORITY"] = "tbb workqueue omp"
        # Don't set NUMBA_NUM_THREADS when using TBB
        if "NUMBA_NUM_THREADS" in os.environ:
            del os.environ["NUMBA_NUM_THREADS"]
        print(f"[Worker {os.getpid()}] INFO: Upgraded to TBB threading layer")
    else:
        print(
            f"[Worker {os.getpid()}] INFO: Using workqueue threading layer (single-threaded)"
        )


def topic_modeling_task(
    user_id: str,
    workspace_id: str,
    node_ids: list[str],
    node_columns: Dict[str, str],
    min_topic_size: int = 5,
    use_ctfidf: bool = False,
    progress_callback: Optional[callable] = None,
) -> Dict[str, Any]:
    """
    Execute topic modeling in a worker process.

    Args:
        user_id: User ID
        workspace_id: Workspace ID
        node_ids: List of node IDs to analyze
        node_columns: Mapping of node_id -> column_name
        min_topic_size: Minimum topic size parameter
        use_ctfidf: Whether to use c-TF-IDF embeddings
        progress_callback: Optional callback for progress updates

    Returns:
        Dictionary containing topic modeling results
    """
    # Configure environment at the start of each task
    _configure_worker_environment()

    try:
        # Import heavy libraries after environment is configured
        import polars as pl
        from docframe import DocDataFrame, DocLazyFrame
        from docframe.core.text_utils import topic_visualization

        # Import workspace manager (this should be lightweight)
        from ldaca_web_app_backend.core.workspace import workspace_manager

        print(
            f"[Worker {os.getpid()}] Starting topic modeling task for workspace {workspace_id}"
        )

        if progress_callback:
            progress_callback(0.1, "Initializing workspace...")

        # Get workspace and nodes
        # NOTE: Worker runs in separate process, so workspace_manager memory is empty
        # We need to explicitly load the workspace from disk
        workspace = workspace_manager.get_workspace(user_id, workspace_id)
        if not workspace:
            # Try to set current workspace to force loading from disk
            success = workspace_manager.set_current_workspace(user_id, workspace_id)
            if success:
                workspace = workspace_manager.get_workspace(user_id, workspace_id)

        if not workspace:
            raise ValueError(
                f"Workspace {workspace_id} not found (worker process cannot access workspace)"
            )

        if progress_callback:
            progress_callback(0.2, "Loading node data...")

        corpora = []
        node_names = []

        for i, node_id in enumerate(node_ids):
            node = workspace_manager.get_node_from_workspace(
                user_id, workspace_id, node_id
            )
            if not node:
                raise ValueError(f"Node {node_id} not found")

            node_data = getattr(node, "data", node)
            node_name = getattr(node, "name", None) or node_id

            # Get available columns
            if hasattr(node_data, "columns"):
                available_columns = node_data.columns
            elif hasattr(node_data, "collect_schema"):
                available_columns = list(node_data.collect_schema().keys())
            elif hasattr(node_data, "schema"):
                available_columns = list(node_data.schema.keys())
            else:
                available_columns = []

            # Determine column to use
            column_name = node_columns.get(node_id)
            if not column_name:
                if isinstance(node_data, (DocDataFrame, DocLazyFrame)) and getattr(
                    node_data, "document_column", None
                ):
                    column_name = node_data.document_column
                else:
                    common = [
                        c
                        for c in ["document", "text", "content", "body", "message"]
                        if c in available_columns
                    ]
                    if common:
                        column_name = common[0]

            if not column_name:
                raise ValueError(
                    f"Could not determine text column for node {node_id}. Available: {available_columns}"
                )

            if column_name not in available_columns:
                raise ValueError(
                    f"Column '{column_name}' not in node {node_id}. Available: {available_columns}"
                )

            # Extract corpus
            if not hasattr(node_data, "select"):
                raise ValueError(f"Unsupported node data type for node {node_id}")

            sel = node_data.select(pl.col(column_name).alias("__doc_col__"))
            if hasattr(sel, "collect"):
                try:
                    sel = sel.collect()
                except Exception:
                    pass

            docs = [
                str(v) if v is not None else "" for v in sel["__doc_col__"].to_list()
            ]
            corpora.append(docs)
            node_names.append(node_name)

            if progress_callback:
                progress_callback(
                    0.2 + 0.3 * (i + 1) / len(node_ids), f"Loaded {node_name}"
                )

        if progress_callback:
            progress_callback(0.6, "Running topic modeling...")

        # Run topic modeling with threading error handling
        try:
            tv = topic_visualization(
                corpora=corpora,
                min_topic_size=min_topic_size,
                use_ctfidf=use_ctfidf,
            )
        except Exception as e:
            error_msg = str(e).lower()
            # Check if this is a threading-related error
            if any(
                phrase in error_msg
                for phrase in [
                    "no threading layer could be loaded",
                    "intel tbb",
                    "threading layer",
                    "tbb",
                    "numba_num_threads",
                    "threads have been launched",
                ]
            ):
                print(f"[Worker {os.getpid()}] WARNING: Threading error detected: {e}")
                print(
                    f"[Worker {os.getpid()}] INFO: Reconfiguring with safe threading and retrying..."
                )

                # Force safe threading configuration
                os.environ["NUMBA_THREADING_LAYER"] = "workqueue"
                os.environ["NUMBA_THREADING_LAYER_PRIORITY"] = "workqueue omp tbb"
                os.environ["NUMBA_NUM_THREADS"] = "1"

                # Clear any cached numba compilations
                try:
                    import numba

                    # Try to clear caches if possible
                    if hasattr(numba, "core") and hasattr(numba.core, "config"):
                        numba.core.config.THREADING_LAYER = "workqueue"
                except Exception:
                    pass

                # Retry the computation with safe settings
                print(
                    f"[Worker {os.getpid()}] INFO: Retrying topic modeling with workqueue threading..."
                )
                tv = topic_visualization(
                    corpora=corpora,
                    min_topic_size=min_topic_size,
                    use_ctfidf=use_ctfidf,
                )
                print(
                    f"[Worker {os.getpid()}] SUCCESS: Topic modeling succeeded with fallback threading"
                )
            else:
                # Re-raise non-threading errors
                raise

        if progress_callback:
            progress_callback(0.9, "Finalizing results...")

        result = {
            "topics": tv["topics"],
            "corpus_sizes": tv["corpus_sizes"],
            "per_corpus_topic_counts": tv.get("per_corpus_topic_counts"),
            "meta": {**tv.get("meta", {}), "node_names": node_names},
        }

        if progress_callback:
            progress_callback(1.0, "Completed successfully")

        print(f"[Worker {os.getpid()}] Topic modeling completed successfully")
        return result

    except Exception as e:
        print(f"[Worker {os.getpid()}] Topic modeling failed: {str(e)}")
        if progress_callback:
            progress_callback(-1, f"Failed: {str(e)}")
        raise


def _materialize_to_polars_df(obj):
    import polars as pl

    if isinstance(obj, pl.LazyFrame):
        obj = obj.collect()

    # DocFrame objects expose to_lazyframe()/to_polars() helpers
    if hasattr(obj, "to_lazyframe"):
        obj = obj.to_lazyframe().collect()
    elif hasattr(obj, "to_polars"):
        obj = obj.to_polars()

    if hasattr(obj, "_df") and not isinstance(obj, pl.DataFrame):
        obj = obj._df

    if not isinstance(obj, pl.DataFrame):
        try:
            obj = pl.DataFrame(obj)
        except Exception as exc:
            raise ValueError(
                f"Unable to coerce concordance result into Polars DataFrame: {exc}"
            )
    return obj


def concordance_task(
    user_id: str,
    workspace_id: str,
    node_ids: list[str],
    node_columns: Dict[str, str],
    search_word: str,
    num_left_tokens: int = 5,
    num_right_tokens: int = 5,
    regex: bool = False,
    case_sensitive: bool = False,
    progress_callback: Optional[callable] = None,
) -> Dict[str, Any]:
    """
    Execute concordance analysis in a worker process.

    Args:
        user_id: User ID
        workspace_id: Workspace ID
        node_ids: List of node IDs to analyze
        node_columns: Mapping of node_id -> column_name
        search_word: The word or pattern to search for
        num_left_tokens: Number of tokens to the left
        num_right_tokens: Number of tokens to the right
        regex: Whether search_word is a regex
        case_sensitive: Whether search is case sensitive
        progress_callback: Optional callback for progress updates

    Returns:
        Dictionary containing concordance results (DataFrames)
    """
    _configure_worker_environment()

    try:
        from ldaca_web_app_backend.core.workspace import workspace_manager

        print(
            f"[Worker {os.getpid()}] Starting concordance task for workspace {workspace_id}"
        )

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

        results = {}

        for i, node_id in enumerate(node_ids):
            node = workspace_manager.get_node_from_workspace(
                user_id, workspace_id, node_id
            )
            if not node:
                raise ValueError(f"Node {node_id} not found")

            node_data = getattr(node, "data", node)
            column_name = node_columns.get(node_id)

            if not column_name:
                raise ValueError(f"No column specified for node {node_id}")

            if not hasattr(node_data, "text"):
                raise ValueError(f"Node {node_id} does not support text operations")

            if progress_callback:
                progress_callback(
                    0.2 + 0.3 * (i + 1) / len(node_ids), f"Processing {node_id}..."
                )

            concordance_df = node_data.text.concordance(
                column=column_name,
                search_word=search_word,
                num_left_tokens=num_left_tokens,
                num_right_tokens=num_right_tokens,
                regex=regex,
                case_sensitive=case_sensitive,
                explode=True,
                unnest=True,
            )
            concordance_df = _materialize_to_polars_df(concordance_df)

            results[node_id] = {
                "rows": concordance_df.to_dicts(),
                "columns": list(concordance_df.columns),
            }

        if progress_callback:
            progress_callback(1.0, "Completed successfully")

        print(f"[Worker {os.getpid()}] Concordance completed successfully")
        return {"node_results": results}

    except Exception as e:
        print(f"[Worker {os.getpid()}] Concordance failed: {str(e)}")
        if progress_callback:
            progress_callback(-1, f"Failed: {str(e)}")
        raise


def _filter_concordance_rows(df: "pl.DataFrame") -> "pl.DataFrame":
    """Filter out empty concordance matches."""
    import polars as pl

    if not isinstance(df, pl.DataFrame) or df.height == 0:
        return df

    candidate_columns = [
        col
        for col in ("matched_text", "left_context", "right_context")
        if col in df.columns
    ]
    if not candidate_columns:
        return df

    try:
        non_empty_checks = [
            (
                pl
                .col(col)
                .cast(pl.Utf8, strict=False)
                .str.strip_chars()
                .str.len_chars()
                .fill_null(0)
                > 0
            )
            for col in candidate_columns
        ]
        mask = pl.any_horizontal(non_empty_checks)
        return df.filter(mask)
    except Exception:
        fallback_mask = pl.any_horizontal([
            pl.col(col).is_not_null() for col in candidate_columns
        ])
        return df.filter(fallback_mask)


def concordance_detach_task(
    user_id: str,
    workspace_id: str,
    node_id: str,
    column: str,
    search_word: str,
    num_left_tokens: int,
    num_right_tokens: int,
    regex: bool,
    case_sensitive: bool,
    new_node_name: Optional[str] = None,
    progress_callback: Optional[callable] = None,
) -> Dict[str, Any]:
    """Execute concordance detach in a worker process."""
    _configure_worker_environment()

    try:
        import re
        from pathlib import Path

        import polars as pl
        from docframe import DocDataFrame, DocLazyFrame
        from ldaca_web_app_backend.core.workspace import workspace_manager

        print(
            f"[Worker {os.getpid()}] Starting concordance detach task for workspace {workspace_id}"
        )

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

        workspace_dir = workspace_manager.get_workspace_dir(user_id, workspace_id)
        if not workspace_dir:
            raise ValueError(f"Workspace folder not found for {workspace_id}")

        if progress_callback:
            progress_callback(0.2, "Loading node data...")

        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise ValueError(f"Node {node_id} not found")

        node_data = getattr(node, "data", node)

        # Check columns
        if hasattr(node_data, "columns"):
            available_columns = node_data.columns
        elif hasattr(node_data, "collect_schema"):
            available_columns = list(node_data.collect_schema().keys())
        elif hasattr(node_data, "schema"):
            try:
                available_columns = list(node_data.schema.keys())
            except Exception:
                available_columns = []
        else:
            available_columns = []

        if available_columns and column not in available_columns:
            raise ValueError(
                f"Column '{column}' not found. Available columns: {available_columns}"
            )

        if not hasattr(node_data, "text"):
            raise ValueError("This node does not support text analysis")

        if progress_callback:
            progress_callback(0.4, "Computing concordance matches...")

        # Compute concordance
        concordance_result = node_data.text.concordance(
            column=column,
            search_word=search_word,
            num_left_tokens=num_left_tokens,
            num_right_tokens=num_right_tokens,
            regex=regex,
            case_sensitive=case_sensitive,
            explode=True,
            unnest=True,
        )

        if "document_idx" not in concordance_result.columns:
            concordance_with_idx = concordance_result.with_row_index("document_idx")
        else:
            concordance_with_idx = concordance_result

        # Materialize underlying data
        if progress_callback:
            progress_callback(0.6, "Joining with original data...")

        if isinstance(node_data, pl.LazyFrame):
            underlying_df = node_data.collect()
        elif hasattr(node_data, "to_lazyframe"):
            underlying_df = node_data.to_lazyframe().collect()
        elif hasattr(node_data, "_df") and not isinstance(node_data, pl.DataFrame):
            underlying_df = node_data._df
        else:
            underlying_df = node_data

        if isinstance(underlying_df, pl.LazyFrame):
            underlying_df = underlying_df.collect()

        if not isinstance(underlying_df, pl.DataFrame):
            raise ValueError("Failed to materialize underlying data")

        original_with_idx = underlying_df.with_row_index("document_idx")

        other_df = concordance_with_idx.select([
            "document_idx",
            "left_context",
            "matched_text",
            "right_context",
            "start_idx",
            "end_idx",
            "l1",
            "r1",
            "l1_freq",
            "r1_freq",
        ])

        # Filter empty rows
        other_df = _filter_concordance_rows(other_df)

        final_data = original_with_idx.join(
            other_df, on="document_idx", how="right"
        ).drop("document_idx")

        # Determine new node name
        if new_node_name:
            effective_node_name = new_node_name
        else:
            original_name = (
                node.name if hasattr(node, "name") and node.name else node_id
            )
            effective_node_name = f"{original_name}_conc_{search_word}"

        if progress_callback:
            progress_callback(0.8, "Persisting new node...")

        document_column = getattr(node, "document", None) or getattr(
            node_data, "document_column", None
        )

        # Stage data (lazy persist) logic inline to avoid helper dependency or copy helper
        data_dir = workspace_dir / "data"
        data_dir.mkdir(parents=True, exist_ok=True)

        def _safe_stem(name: str) -> str:
            stem = re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("._") or "data"
            return stem

        base_stem = _safe_stem(effective_node_name)
        parquet_path = data_dir / f"{base_stem}.parquet"
        suffix = 1
        while parquet_path.exists():
            parquet_path = data_dir / f"{base_stem}_{suffix}.parquet"
            suffix += 1

        try:
            final_data.write_parquet(parquet_path)
        except Exception as exc:
            raise RuntimeError(f"Failed to write parquet: {exc}")

        try:
            lazy_data = pl.scan_parquet(parquet_path)
            if document_column:
                try:
                    lazy_data = DocLazyFrame(lazy_data, document_column=document_column)
                except Exception:
                    pass
        except Exception as exc:
            raise RuntimeError(f"Failed to reload parquet: {exc}")

        if progress_callback:
            progress_callback(0.9, "Finalizing result...")

        # We do NOT add the node here anymore. Main process handles graph updates.

        total_rows = final_data.height

        if progress_callback:
            progress_callback(1.0, "Analysis completed, registering result...")

        return {
            "success": True,
            "message": f"Concordance analysis complete. Found {len(concordance_result)} matches.",
            "parquet_path": str(parquet_path),
            "new_node_name": effective_node_name,
            "parent_node_id": node_id,
            "document_column": document_column,
            "total_rows": total_rows,
            "concordance_matches": len(concordance_result),
        }

    except Exception as e:
        print(f"[Worker {os.getpid()}] Concordance detach failed: {str(e)}")
        if progress_callback:
            progress_callback(-1, f"Failed: {str(e)}")
        raise


def quotation_detach_task(
    user_id: str,
    workspace_id: str,
    node_id: str,
    column: str,
    engine_config: Dict[str, Any],
    new_node_name: Optional[str] = None,
    progress_callback: Optional[callable] = None,
) -> Dict[str, Any]:
    """Execute quotation detach in a worker process."""
    _configure_worker_environment()

    try:
        import asyncio
        import re
        from pathlib import Path

        import polars as pl
        from docframe import DocDataFrame, DocLazyFrame
        from ldaca_web_app_backend.core.workspace import workspace_manager
        from ldaca_web_app_backend.models import (
            QuotationEngineConfig,
            QuotationEngineType,
        )

        # Helper to convert to polars and ensure quote dataframe
        # We need to replicate _to_polars_dataframe, _ensure_quote_dataframe, _join_quotes_with_base logic here
        # or abstract them. For robustness and isolation, inline/copy is safer for worker.

        print(
            f"[Worker {os.getpid()}] Starting quotation detach task for workspace {workspace_id}"
        )

        if progress_callback:
            progress_callback(0.1, "Initializing workspace...")

        workspace = workspace_manager.get_workspace(user_id, workspace_id)
        if not workspace:
            workspace_manager.set_current_workspace(user_id, workspace_id)
            workspace = workspace_manager.get_workspace(user_id, workspace_id)

        if not workspace:
            raise ValueError(f"Workspace {workspace_id} not found")

        workspace_dir = workspace_manager.get_workspace_dir(user_id, workspace_id)
        if not workspace_dir:
            raise ValueError(f"Workspace folder not found")

        if progress_callback:
            progress_callback(0.2, "Loading node data...")

        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise ValueError(f"Node {node_id} not found")

        node_data = getattr(node, "data", node)

        try:
            engine = QuotationEngineConfig.model_validate(engine_config)
        except Exception as e:
            raise ValueError(f"Invalid engine config: {e}")

        if engine.type is QuotationEngineType.LOCAL and not hasattr(node_data, "text"):
            # Check if we can wrap it
            pass  # Will handle below

        if progress_callback:
            progress_callback(0.4, "Extracting quotations...")

        quote_df: pl.DataFrame

        # Compute quotes
        if engine.type is QuotationEngineType.REMOTE:
            # Materialize base dataframe for remote upload
            if hasattr(node_data, "lazyframe"):
                base_df = node_data.lazyframe.collect()
            elif isinstance(node_data, pl.LazyFrame):
                base_df = node_data.collect()
            elif hasattr(node_data, "dataframe"):
                base_df = pl.DataFrame(getattr(node_data, "dataframe"))
            elif hasattr(node_data, "collect") and not isinstance(
                node_data, pl.DataFrame
            ):
                collected = node_data.collect()
                base_df = (
                    collected
                    if isinstance(collected, pl.DataFrame)
                    else pl.DataFrame(collected)
                )
            else:
                base_df = (
                    node_data
                    if isinstance(node_data, pl.DataFrame)
                    else pl.DataFrame(node_data)
                )

            if not isinstance(base_df, pl.DataFrame):
                base_df = pl.DataFrame(base_df)

            from ldaca_web_app_backend.api.workspaces.analyses.quotation import (
                _ensure_quote_dataframe,
                _extract_remote_paginated,
                _prepare_documents_payload,
                _remote_payload_to_dataframe,
            )

            documents = _prepare_documents_payload(base_df, column)
            if not documents:
                quote_df = _ensure_quote_dataframe(pl.DataFrame(), text_column=column)
            else:
                payload = asyncio.get_event_loop().run_until_complete(
                    _extract_remote_paginated(engine, documents)
                )
                quote_df = _remote_payload_to_dataframe(payload)
                quote_df = _ensure_quote_dataframe(quote_df, text_column=column)
        else:
            # Local Engine - use docframe directly
            if not hasattr(node_data, "text"):
                # Try to wrap as DocDataFrame if needed, similar to logic elsewhere
                try:
                    # If it's a polars object, wrap it
                    df_to_wrap = node_data
                    if hasattr(node_data, "collect"):
                        df_to_wrap = node_data.collect()

                    if isinstance(df_to_wrap, pl.DataFrame):
                        base_df_wrapped = DocDataFrame(
                            df_to_wrap, document_column=column
                        )  # type: ignore
                        node_data = base_df_wrapped
                    else:
                        raise ValueError("Cannot access text namespace")
                except Exception:
                    raise ValueError(
                        "This node does not support text analysis (text namespace missing)"
                    )

            quote_raw = node_data.text.quotation(column, explode=True, unnest=True)

            # Materialize result
            if hasattr(quote_raw, "collect"):
                quote_df = quote_raw.collect()
            elif isinstance(quote_raw, pl.DataFrame):
                quote_df = quote_raw
            elif hasattr(quote_raw, "_df"):
                quote_df = quote_raw._df
                if hasattr(quote_df, "collect"):
                    quote_df = quote_df.collect()
            else:
                quote_df = pl.DataFrame(quote_raw)

            if not isinstance(quote_df, pl.DataFrame):
                quote_df = pl.DataFrame(quote_df)

            if progress_callback:
                progress_callback(0.6, "Structuring results...")

            if "quote" in quote_df.columns:
                quote_df = quote_df.filter(pl.col("quote").is_not_null())

            from ldaca_web_app_backend.api.workspaces.analyses.quotation import (
                _ensure_quote_dataframe as _ensure_df,
            )

            quote_df = _ensure_df(quote_df, text_column=column)

        final_data = quote_df

        # New node name
        if new_node_name:
            effective_node_name = new_node_name
        else:
            original_name = node.name if getattr(node, "name", None) else node_id
            effective_node_name = f"{original_name}_quotation"

        document_column = getattr(node, "document", None) or getattr(
            node_data, "document_column", None
        )

        if progress_callback:
            progress_callback(0.8, "Persisting result...")

        # Stage data
        data_dir = workspace_dir / "data"
        data_dir.mkdir(parents=True, exist_ok=True)

        def _safe_stem(name: str) -> str:
            stem = re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("._") or "data"
            return stem

        base_stem = _safe_stem(effective_node_name)
        parquet_path = data_dir / f"{base_stem}.parquet"
        suffix = 1
        while parquet_path.exists():
            parquet_path = data_dir / f"{base_stem}_{suffix}.parquet"
            suffix += 1

        try:
            final_data.write_parquet(parquet_path)
        except Exception as exc:
            raise RuntimeError(f"Failed to write parquet: {exc}")

        try:
            lazy_data = pl.scan_parquet(parquet_path)
            if document_column:
                try:
                    lazy_data = DocLazyFrame(lazy_data, document_column=document_column)
                except Exception:
                    pass
        except Exception as exc:
            raise RuntimeError(f"Failed to reload parquet: {exc}")

        if progress_callback:
            progress_callback(0.9, "Finalizing result...")

        # We do NOT add the node here anymore. Main process handles graph updates.

        total_rows = final_data.height

        if progress_callback:
            progress_callback(1.0, "Analysis completed, registering result...")

        return {
            "state": "successful",
            "message": f"Quotation extraction complete with {total_rows} rows",
            "parquet_path": str(parquet_path),
            "new_node_name": effective_node_name,
            "parent_node_id": node_id,
            "document_column": document_column,
            "total_rows": total_rows,
        }

    except Exception as e:
        print(f"[Worker {os.getpid()}] Quotation detach failed: {str(e)}")
        if progress_callback:
            progress_callback(-1, f"Failed: {str(e)}")
        raise


def _safe_float(value, *, default: float | None = 0.0) -> float | None:
    try:
        number = float(value)
    except TypeError, ValueError:
        return default
    # Avoid propagating NaN/Inf into JSON payloads
    if number != number:  # NaN check
        return default
    if number in (float("inf"), float("-inf")):
        return default
    return number


def _sanitize_stop_words(value) -> list[str]:
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


def token_frequencies_task(
    user_id: str,
    workspace_id: str,
    node_ids: list[str],
    node_columns: Dict[str, str],
    token_limit: int = 10,
    stop_words: Optional[list[str]] = None,
    progress_callback: Optional[callable] = None,
) -> Dict[str, Any]:
    """Execute token frequency analysis in a worker process.

    Notes:
    - This mirrors the synchronous endpoint logic but runs in a separate process.
    - `stop_words` is not applied to the raw frequency computation; it is persisted
      only as a UI preference (same convention as the API endpoint).
    """

    _configure_worker_environment()

    try:
        import math

        import polars as pl
        from docframe import DocDataFrame, DocLazyFrame
        from docframe.core.text_utils import compute_token_frequencies
        from ldaca_web_app_backend.core.workspace import workspace_manager

        print(
            f"[Worker {os.getpid()}] Starting token frequencies task for workspace {workspace_id}"
        )

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

        # Sanitize UI preferences
        requested_stop_words = _sanitize_stop_words(stop_words)
        effective_limit = int(token_limit) if int(token_limit) > 0 else 10

        # Match API constants to keep metadata stable
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

            node_data = getattr(node, "data", node)
            node_name = getattr(node, "name", None) or node_id
            node_display_names[node_id] = node_name

            # Validate column
            if hasattr(node_data, "columns"):
                available_columns = node_data.columns
            elif hasattr(node_data, "collect_schema"):
                available_columns = list(node_data.collect_schema().keys())
            elif hasattr(node_data, "schema"):
                try:
                    available_columns = list(node_data.schema.keys())
                except Exception:
                    available_columns = []
            else:
                available_columns = []

            column_name = node_columns.get(node_id)
            if not column_name:
                raise ValueError(f"No column specified for node {node_id}")
            if column_name not in available_columns:
                raise ValueError(
                    f"Column '{column_name}' not found in node {node_id}. Available columns: {available_columns}"
                )

            # Coerce into a DocLazyFrame (no persistence in worker)
            if isinstance(node_data, DocLazyFrame):
                processed = (
                    node_data
                    if node_data.document_column == column_name
                    else node_data.with_document_column(column_name)
                )
            elif isinstance(node_data, DocDataFrame):
                processed = DocLazyFrame(
                    node_data.dataframe.lazy(), document_column=column_name
                )  # type: ignore[misc]
            elif isinstance(node_data, pl.LazyFrame):
                processed = DocLazyFrame(node_data, document_column=column_name)  # type: ignore[misc]
            elif isinstance(node_data, pl.DataFrame):
                processed = DocLazyFrame(node_data.lazy(), document_column=column_name)  # type: ignore[misc]
            else:
                raise ValueError(
                    f"Unsupported node data type for text analysis: {type(node_data).__name__}"
                )

            frames_dict[node_id] = processed

            if progress_callback:
                progress_callback(
                    0.2 + 0.3 * (i + 1) / max(len(node_ids), 1),
                    f"Prepared {node_name}",
                )

        if progress_callback:
            progress_callback(0.6, "Computing token frequencies...")

        # IMPORTANT: stop words are not applied to raw frequency computation.
        frequency_results, stats_df = compute_token_frequencies(
            frames=frames_dict, stop_words=None
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
                    "expected_0": _safe_float(row.get("expected_0")) or 0.0,
                    "expected_1": _safe_float(row.get("expected_1")) or 0.0,
                    "corpus_0_total": int(row["corpus_0_total"]),
                    "corpus_1_total": int(row["corpus_1_total"]),
                    "percent_corpus_0": _safe_float(row.get("percent_corpus_0")) or 0.0,
                    "percent_corpus_1": _safe_float(row.get("percent_corpus_1")) or 0.0,
                    "percent_diff": _safe_float(row.get("percent_diff")) or 0.0,
                    "log_likelihood_llv": _safe_float(row.get("log_likelihood_llv"))
                    or 0.0,
                    "bayes_factor_bic": _safe_float(row.get("bayes_factor_bic")) or 0.0,
                    "effect_size_ell": _safe_float(row.get("effect_size_ell")) or 0.0,
                    "relative_risk": _safe_float(row.get("relative_risk"), default=None)
                    if row.get("relative_risk") is not None
                    else None,
                    "log_ratio": _safe_float(row.get("log_ratio"), default=None)
                    if row.get("log_ratio") is not None
                    else None,
                    "odds_ratio": _safe_float(row.get("odds_ratio"), default=None)
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

        print(f"[Worker {os.getpid()}] Token frequencies completed successfully")
        return result_payload

    except Exception as e:
        print(f"[Worker {os.getpid()}] Token frequencies failed: {str(e)}")
        if progress_callback:
            progress_callback(-1, f"Failed: {str(e)}")
        raise


def ldaca_import_task(
    user_id: str,
    workspace_id: str,
    url: str,
    filename: Optional[str] = None,
    progress_callback: Optional[callable] = None,
) -> Dict[str, Any]:
    """Execute LDaCA import in a worker process."""
    _configure_worker_environment()

    try:
        import re
        import urllib.parse
        from pathlib import Path

        from ldaca_web_app_backend.core.utils import get_user_data_folder
        from ldacatabulator.tabulator import LDaCATabulator

        print(f"[Worker {os.getpid()}] Starting LDaCA import task for user {user_id}")

        if progress_callback:
            progress_callback(0.1, "Connecting to LDaCA...")

        # Determine filename if not provided
        if not filename:
            # Parse filename from URL
            try:
                parsed = urllib.parse.urlparse(url)
                path_parts = parsed.path.split("/")
                candidate = path_parts[-1] if path_parts else "ldaca_import"
                # Decode URL encoding (e.g. %2F -> /)
                candidate = urllib.parse.unquote(candidate)

                # Sanitize filename: remove URL schemes and safe characters
                # User requested saving under LDaCA folder with clean name
                # remove arcp prefix if present to clean up name a bit
                if candidate.startswith("arcp://"):
                    candidate = candidate[7:]

                # Replace invalid FS characters with underscore
                candidate = re.sub(r"[^a-zA-Z0-9._~-]", "_", candidate)

                # Collapse multiple underscores
                candidate = re.sub(r"_+", "_", candidate)

                # Fallback sanitation
                if not candidate or candidate == ".":
                    candidate = "ldaca_import"

                # If zip, replace with parquet
                if candidate.lower().endswith(".zip"):
                    candidate = candidate[:-4] + ".parquet"
                elif not candidate.lower().endswith(".parquet"):
                    candidate += ".parquet"

                filename = candidate
            except Exception:
                filename = "ldaca_import.parquet"

        if progress_callback:
            progress_callback(0.3, "Downloading and extracting...")

        # Initialize Tabulator
        # Note: LDaCATabulator does download in __init__ or get_text calls?
        # Based on example: ldac_tb = LDaCATabulator(zip_url) -> downloads
        try:
            ldac_tb = LDaCATabulator(url)
        except Exception as e:
            raise ValueError(f"Failed to download/init LDaCATabulator: {e}")

        if progress_callback:
            progress_callback(0.6, "Converting to DataFrame...")

        try:
            df = ldac_tb.get_text()
        except Exception as e:
            raise ValueError(f"Failed to extract text DataFrame: {e}")

        if progress_callback:
            progress_callback(0.8, "Saving to user data...")

        # Get user data folder
        user_data_folder = get_user_data_folder(user_id)

        # Create LDaCA specific subdirectory
        ldaca_folder = user_data_folder / "LDaCA"
        ldaca_folder.mkdir(parents=True, exist_ok=True)

        file_path = ldaca_folder / filename

        # Ensure unique name
        stem = file_path.stem
        suffix = file_path.suffix
        counter = 1
        while file_path.exists():
            file_path = ldaca_folder / f"{stem}_{counter}{suffix}"
            counter += 1

        # Save to parquet
        try:
            # Check if dataframe is pandas or polars?
            # The notebook says "pandas table".
            import pandas as pd

            if isinstance(df, pd.DataFrame):
                df.to_parquet(str(file_path))
            else:
                # Assume polars or other
                # Try to convert to polars if it has write_parquet, else try pandas
                if hasattr(df, "write_parquet"):
                    df.write_parquet(file_path)
                else:
                    # Final fallback, try converting to pandas
                    pd.DataFrame(df).to_parquet(str(file_path))

        except Exception as e:
            raise RuntimeError(f"Failed to save parquet file: {e}")

        if progress_callback:
            progress_callback(1.0, "Import completed successfully")

        print(f"[Worker {os.getpid()}] LDaCA import completed: {file_path.name}")

        return {
            "success": True,
            "filename": file_path.name,
            "path": str(file_path),
            "size": file_path.stat().st_size,
            "message": f"Successfully imported {filename}",
        }

    except Exception as e:
        print(f"[Worker {os.getpid()}] LDaCA import failed: {str(e)}")
        if progress_callback:
            progress_callback(-1, f"Failed: {str(e)}")
        raise


class WorkerPool:
    """Manages the ProcessPoolExecutor for background tasks."""

    def __init__(self, max_workers: Optional[int] = None):
        """Initialize the worker pool."""
        if max_workers is None:
            # Use number of CPU cores, but cap at 4 to avoid overloading
            max_workers = min(os.cpu_count() or 2, 4)

        self.max_workers = max_workers
        self._pool: Optional[ProcessPoolExecutor] = None
        self._shutdown = False
        self._active_tasks: list[Future] = []  # Track submitted tasks

    def start(self):
        """Start the worker pool lazily when first needed."""
        if self._pool is not None:
            return

        print(f"Starting worker pool with {self.max_workers} processes")
        self._pool = ProcessPoolExecutor(
            max_workers=self.max_workers,
            mp_context=mp.get_context("spawn"),  # Use spawn for better isolation
        )
        self._shutdown = False

    def shutdown(self, wait: bool = True, timeout: float = 5.0):
        """
        Shutdown the worker pool and clean up child processes.

        Args:
            wait: Whether to wait for tasks to complete
            timeout: Maximum time to wait for graceful shutdown (seconds)
        """
        if self._pool is not None:
            print("Shutting down worker pool...")

            # Cancel any pending tasks
            cancelled_count = 0
            for task in self._active_tasks:
                if not task.done():
                    task.cancel()
                    cancelled_count += 1

            if cancelled_count > 0:
                print(f"Cancelled {cancelled_count} pending tasks")

            self._shutdown = True

            # Try graceful shutdown first
            try:
                self._pool.shutdown(wait=wait, cancel_futures=True)
                print("Worker pool shutdown complete")
            except Exception as e:
                print(f"Warning: Error during worker pool shutdown: {e}")

                # Force terminate worker processes if graceful shutdown fails
                try:
                    import os as _os

                    import psutil

                    # Get worker processes
                    parent = psutil.Process(_os.getpid())
                    for child in parent.children(recursive=True):
                        if child.is_running():
                            try:
                                print(f"Force terminating worker process {child.pid}")
                                child.terminate()
                            except psutil.NoSuchProcess, psutil.AccessDenied:
                                pass

                    # Wait briefly then force kill
                    import time

                    time.sleep(0.5)
                    for child in parent.children(recursive=True):
                        if child.is_running():
                            try:
                                child.kill()
                            except psutil.NoSuchProcess, psutil.AccessDenied:
                                pass
                except ImportError:
                    print("Warning: psutil not available for force termination")

            self._pool = None
            self._active_tasks.clear()

    def submit_task(self, task_func: callable, *args, **kwargs) -> Future:
        """Submit a task to the worker pool. Starts pool lazily if not running."""
        # Lazy initialization: start pool on first task submission
        if self._pool is None and not self._shutdown:
            self.start()

        if self._pool is None:
            raise RuntimeError("Worker pool not started")
        if self._shutdown:
            raise RuntimeError("Worker pool is shutting down")

        future = self._pool.submit(task_func, *args, **kwargs)
        self._active_tasks.append(future)

        # Clean up completed tasks from tracking list
        self._active_tasks = [f for f in self._active_tasks if not f.done()]

        return future

    @property
    def is_running(self) -> bool:
        """Check if the worker pool is running."""
        return self._pool is not None and not self._shutdown

    @property
    def active_task_count(self) -> int:
        """Get the number of active (non-completed) tasks."""
        self._active_tasks = [f for f in self._active_tasks if not f.done()]
        return len(self._active_tasks)


# Global worker pool instance
worker_pool = WorkerPool()


def get_worker_pool() -> WorkerPool:
    """Get the global worker pool instance."""
    return worker_pool


# Task Registry for generic task submission
TASK_REGISTRY = {
    "topic_modeling": topic_modeling_task,
    "concordance": concordance_task,
    "concordance_detach": concordance_detach_task,
    "quotation_detach": quotation_detach_task,
    "token_frequencies": token_frequencies_task,
    "ldaca_import": ldaca_import_task,
}
TASK_REGISTRY = {
    "topic_modeling": topic_modeling_task,
    "concordance": concordance_task,
    "concordance_detach": concordance_detach_task,
    "quotation_detach": quotation_detach_task,
    "token_frequencies": token_frequencies_task,
    "ldaca_import": ldaca_import_task,
}
