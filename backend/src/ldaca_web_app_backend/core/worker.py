"""
Worker module for heavy computational tasks using ProcessPoolExecutor.

This module provides isolation for CPU-intensive tasks like topic modeling,
avoiding GIL issues and Numba threading conflicts by running work in separate processes.
"""

import asyncio
import os
import time
from concurrent.futures import ProcessPoolExecutor, Future
from typing import Any, Dict, Optional
import multiprocessing as mp


# Set up optimal process start method for macOS/Unix
if hasattr(mp, 'set_start_method'):
    try:
        mp.set_start_method('spawn', force=True)
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
    
    print(f"[Worker {os.getpid()}] 📊 Using safe workqueue threading (single-threaded)")
    
    # Try to upgrade to TBB if it's actually available and functional
    tbb_functional = False
    try:
        # Test 1: Check if TBB package is importable
        import tbb  # noqa: F401
        print(f"[Worker {os.getpid()}] 🔍 TBB package found")
        
        # Test 2: Check if Numba can actually use TBB
        try:
            import numba
            from numba import config
            
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
                    print(f"[Worker {os.getpid()}] ✅ TBB threading functional")
                
            except Exception as e:
                print(f"[Worker {os.getpid()}] ⚠️ TBB test failed: {e}")
                # Restore safe settings
                os.environ["NUMBA_THREADING_LAYER"] = "workqueue"
                os.environ["NUMBA_THREADING_LAYER_PRIORITY"] = "workqueue"
                os.environ["NUMBA_NUM_THREADS"] = "1"
                
        except Exception as e:
            print(f"[Worker {os.getpid()}] ⚠️ Numba TBB check failed: {e}")
            
    except ImportError:
        print(f"[Worker {os.getpid()}] ℹ️ TBB package not available")
    
    # If TBB is functional, configure it properly
    if tbb_functional:
        os.environ["NUMBA_THREADING_LAYER"] = "tbb"
        os.environ["NUMBA_THREADING_LAYER_PRIORITY"] = "tbb workqueue omp"
        # Don't set NUMBA_NUM_THREADS when using TBB
        if "NUMBA_NUM_THREADS" in os.environ:
            del os.environ["NUMBA_NUM_THREADS"]
        print(f"[Worker {os.getpid()}] 📊 Upgraded to TBB threading layer")
    else:
        print(f"[Worker {os.getpid()}] 📊 Using workqueue threading layer (single-threaded)")


def topic_modeling_task(
    user_id: str,
    workspace_id: str,
    node_ids: list[str],
    node_columns: Dict[str, str],
    min_topic_size: int = 5,
    use_ctfidf: bool = False,
    progress_callback: Optional[callable] = None
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
        
        print(f"[Worker {os.getpid()}] Starting topic modeling task for workspace {workspace_id}")
        
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
            raise ValueError(f"Workspace {workspace_id} not found (worker process cannot access workspace)")
        
        if progress_callback:
            progress_callback(0.2, "Loading node data...")
            
        corpora = []
        node_names = []
        
        for i, node_id in enumerate(node_ids):
            node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
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
                if isinstance(node_data, (DocDataFrame, DocLazyFrame)) and getattr(node_data, "document_column", None):
                    column_name = node_data.document_column
                else:
                    common = [c for c in ["document", "text", "content", "body", "message"] if c in available_columns]
                    if common:
                        column_name = common[0]
                        
            if not column_name:
                raise ValueError(f"Could not determine text column for node {node_id}. Available: {available_columns}")
                
            if column_name not in available_columns:
                raise ValueError(f"Column '{column_name}' not in node {node_id}. Available: {available_columns}")
            
            # Extract corpus
            if not hasattr(node_data, "select"):
                raise ValueError(f"Unsupported node data type for node {node_id}")
            
            sel = node_data.select(pl.col(column_name).alias("__doc_col__"))
            if hasattr(sel, "collect"):
                try:
                    sel = sel.collect()
                except Exception:
                    pass
            
            docs = [str(v) if v is not None else "" for v in sel["__doc_col__"].to_list()]
            corpora.append(docs)
            node_names.append(node_name)
            
            if progress_callback:
                progress_callback(0.2 + 0.3 * (i + 1) / len(node_ids), f"Loaded {node_name}")
        
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
            if any(phrase in error_msg for phrase in [
                "no threading layer could be loaded",
                "intel tbb",
                "threading layer",
                "tbb",
                "numba_num_threads",
                "threads have been launched"
            ]):
                print(f"[Worker {os.getpid()}] ⚠️ Threading error detected: {e}")
                print(f"[Worker {os.getpid()}] 🔧 Reconfiguring with safe threading and retrying...")
                
                # Force safe threading configuration
                os.environ["NUMBA_THREADING_LAYER"] = "workqueue"
                os.environ["NUMBA_THREADING_LAYER_PRIORITY"] = "workqueue omp tbb"
                os.environ["NUMBA_NUM_THREADS"] = "1"
                
                # Clear any cached numba compilations
                try:
                    import numba
                    # Try to clear caches if possible
                    if hasattr(numba, 'core') and hasattr(numba.core, 'config'):
                        numba.core.config.THREADING_LAYER = 'workqueue'
                except Exception:
                    pass
                
                # Retry the computation with safe settings
                print(f"[Worker {os.getpid()}] 🔄 Retrying topic modeling with workqueue threading...")
                tv = topic_visualization(
                    corpora=corpora,
                    min_topic_size=min_topic_size,
                    use_ctfidf=use_ctfidf,
                )
                print(f"[Worker {os.getpid()}] ✅ Topic modeling succeeded with fallback threading")
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
    
    def start(self):
        """Start the worker pool."""
        if self._pool is not None:
            return
            
        print(f"🚀 Starting worker pool with {self.max_workers} processes")
        self._pool = ProcessPoolExecutor(
            max_workers=self.max_workers,
            mp_context=mp.get_context('spawn')  # Use spawn for better isolation
        )
        self._shutdown = False
    
    def shutdown(self, wait: bool = True):
        """Shutdown the worker pool."""
        if self._pool is not None:
            print("🛑 Shutting down worker pool...")
            self._shutdown = True
            self._pool.shutdown(wait=wait)
            self._pool = None
    
    def submit_task(self, task_func: callable, *args, **kwargs) -> Future:
        """Submit a task to the worker pool."""
        if self._pool is None:
            raise RuntimeError("Worker pool not started")
        if self._shutdown:
            raise RuntimeError("Worker pool is shutting down")
        
        return self._pool.submit(task_func, *args, **kwargs)
    
    @property
    def is_running(self) -> bool:
        """Check if the worker pool is running."""
        return self._pool is not None and not self._shutdown


# Global worker pool instance
worker_pool = WorkerPool()


def get_worker_pool() -> WorkerPool:
    """Get the global worker pool instance."""
    return worker_pool
