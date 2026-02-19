"""LDaCA import worker task implementation."""

from __future__ import annotations

import os
from typing import Any, Dict, Optional


def run_ldaca_import_task(
    configure_worker_environment,
    user_id: str,
    workspace_id: str,
    url: str,
    filename: Optional[str] = None,
    progress_callback: Optional[callable] = None,
) -> Dict[str, Any]:
    """Execute LDaCA dataset import in a worker process.

    Used by:
    - `core.worker.ldaca_import_task`
    - `TASK_REGISTRY["ldaca_import"]`

    Why:
    - Performs download/extract/convert/save steps off the API thread.

    Refactor note:
    - URL-derived filename normalization logic is substantial; extracting a
      small pure helper would simplify this function and improve testability.
    """
    configure_worker_environment()

    try:
        import re
        import urllib.parse

        from ldaca_web_app_backend.core.utils import get_user_data_folder
        from ldacatabulator.tabulator import LDaCATabulator

        print(f"[Worker {os.getpid()}] Starting LDaCA import task for user {user_id}")

        if progress_callback:
            progress_callback(0.1, "Connecting to LDaCA...")

        if not filename:
            try:
                parsed = urllib.parse.urlparse(url)
                path_parts = parsed.path.split("/")
                candidate = path_parts[-1] if path_parts else "ldaca_import"
                candidate = urllib.parse.unquote(candidate)

                if candidate.startswith("arcp://"):
                    candidate = candidate[7:]

                candidate = re.sub(r"[^a-zA-Z0-9._~-]", "_", candidate)
                candidate = re.sub(r"_+", "_", candidate)

                if not candidate or candidate == ".":
                    candidate = "ldaca_import"

                if candidate.lower().endswith(".zip"):
                    candidate = candidate[:-4] + ".parquet"
                elif not candidate.lower().endswith(".parquet"):
                    candidate += ".parquet"

                filename = candidate
            except Exception:
                filename = "ldaca_import.parquet"

        if progress_callback:
            progress_callback(0.3, "Downloading and extracting...")

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

        user_data_folder = get_user_data_folder(user_id)
        ldaca_folder = user_data_folder / "LDaCA"
        ldaca_folder.mkdir(parents=True, exist_ok=True)

        file_path = ldaca_folder / filename

        stem = file_path.stem
        suffix = file_path.suffix
        counter = 1
        while file_path.exists():
            file_path = ldaca_folder / f"{stem}_{counter}{suffix}"
            counter += 1

        try:
            df.to_parquet(str(file_path))
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
