"""LDaCA import worker task implementation."""

from __future__ import annotations

import os
from contextlib import chdir
from typing import Any, Callable, Dict, Optional

from ldaca_web_app_backend.settings import settings


def _sanitize_name(name: str) -> str:
    """Sanitize a corpus name for use as a folder/file name."""
    import re

    sanitized = re.sub(r"[^\w.~-]", "_", name)
    sanitized = re.sub(r"_+", "_", sanitized)
    return sanitized.strip("_") or "ldaca_import"


def run_ldaca_import_task(
    configure_worker_environment,
    user_id: str,
    workspace_id: str,
    url: str,
    filename: Optional[str] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Dict[str, Any]:
    """Execute LDaCA dataset import in a worker process.

    Creates a per-corpus folder under ``LDaCA/`` containing:
    - ``<corpus_name>.parquet`` — the tabulated text data
    - ``README.md`` — corpus metadata from ``get_corpus_info()``
    """
    configure_worker_environment()

    try:
        from ldacatabulator.tabulator import LDaCATabulator

        from ldaca_web_app_backend.core.utils import get_user_data_folder

        print(f"[Worker {os.getpid()}] Starting LDaCA import task for user {user_id}")

        if progress_callback:
            progress_callback(0.1, "Connecting to LDaCA...")

        if progress_callback:
            progress_callback(0.3, "Downloading and extracting...")

        cache_dir = settings.get_data_root() / "ldaca_cache"
        cache_dir.mkdir(parents=True, exist_ok=True)

        try:
            with chdir(cache_dir):
                ldac_tb = LDaCATabulator(url)
                corpus_name = ldac_tb.get_name()
                sanitized = _sanitize_name(corpus_name)

                # Get corpus metadata markdown
                try:
                    corpus_info_md = ldac_tb.get_corpus_info()
                except Exception:
                    corpus_info_md = None

                if progress_callback:
                    progress_callback(0.6, "Converting to DataFrame...")

                try:
                    df = ldac_tb.get_text()
                except Exception as e:
                    raise ValueError(f"Failed to extract text DataFrame: {e}")
        except Exception as e:
            raise ValueError(f"Failed to download/init LDaCATabulator: {e}")

        if progress_callback:
            progress_callback(0.8, "Saving to user data...")

        user_data_folder = get_user_data_folder(user_id)
        ldaca_folder = user_data_folder / "LDaCA"

        # Create a per-corpus subfolder
        corpus_folder = ldaca_folder / sanitized
        counter = 1
        base_folder = corpus_folder
        while corpus_folder.exists():
            corpus_folder = base_folder.parent / f"{base_folder.name}_{counter}"
            counter += 1
        corpus_folder.mkdir(parents=True, exist_ok=True)

        parquet_filename = f"{sanitized}.parquet"
        file_path = corpus_folder / parquet_filename

        try:
            df.to_parquet(str(file_path))
        except Exception as e:
            raise RuntimeError(f"Failed to save parquet file: {e}")

        # Save corpus metadata as README.md
        if corpus_info_md:
            readme_path = corpus_folder / "README.md"
            readme_path.write_text(corpus_info_md, encoding="utf-8")

        if progress_callback:
            progress_callback(1.0, "Import completed successfully")

        print(f"[Worker {os.getpid()}] LDaCA import completed: {file_path}")

        return {
            "success": True,
            "filename": file_path.name,
            "path": str(file_path),
            "size": file_path.stat().st_size,
            "message": f"Successfully imported {corpus_name}",
        }

    except Exception as e:
        print(f"[Worker {os.getpid()}] LDaCA import failed: {str(e)}")
        if progress_callback:
            progress_callback(-1, f"Failed: {str(e)}")
        raise
