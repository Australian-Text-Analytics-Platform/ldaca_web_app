"""LDaCA import worker task implementation."""

from __future__ import annotations

import os
from typing import Any, Callable, Dict, Optional


def _extract_corpus_name(url: str) -> str | None:
    """Extract the authentic corpus name from the RO-Crate preview HTML.

    Uses the same JSON-LD parsing approach as LDaCATabulator.get_corpus_info()
    but only returns the corpus name string. Written here (not in the
    ldaca-tabulator submodule) to avoid modifying the submodule.
    """
    import json
    from pathlib import Path
    from urllib.parse import unquote, urlparse

    from bs4 import BeautifulSoup

    html_path = Path("./rocrate/ro-crate-preview.html")
    if not html_path.exists():
        return None

    try:
        parsed_url = urlparse(url)
        encoded_name = Path(parsed_url.path).name.removesuffix(".zip")
        corpus_id = unquote(encoded_name)

        html_content = html_path.read_text(encoding="utf-8")
        soup = BeautifulSoup(html_content, "html.parser")
        script_tag = soup.find("script", type="application/ld+json")
        if not script_tag or not script_tag.string:
            return None

        json_data = json.loads(script_tag.string)
        corpus_node = next(
            (
                item
                for item in json_data.get("@graph", [])
                if item.get("@id") == corpus_id
            ),
            None,
        )
        if corpus_node is None:
            return None

        return corpus_node.get("name")
    except Exception:
        return None


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
        import re

        from ldaca_web_app_backend.core.utils import get_user_data_folder
        from ldacatabulator.tabulator import LDaCATabulator

        print(f"[Worker {os.getpid()}] Starting LDaCA import task for user {user_id}")

        if progress_callback:
            progress_callback(0.1, "Connecting to LDaCA...")

        if progress_callback:
            progress_callback(0.3, "Downloading and extracting...")

        try:
            ldac_tb = LDaCATabulator(url)
        except Exception as e:
            raise ValueError(f"Failed to download/init LDaCATabulator: {e}")

        # Extract authentic corpus name from the RO-Crate HTML
        corpus_name = _extract_corpus_name(url)
        if corpus_name:
            sanitized = _sanitize_name(corpus_name)
        else:
            # Fallback to URL-derived name
            sanitized = _sanitize_name(
                re.sub(
                    r"\.zip$",
                    "",
                    re.sub(r"^arcp://", "", url.split("/")[-1]),
                    flags=re.IGNORECASE,
                )
            )

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
            "message": f"Successfully imported {corpus_name or sanitized}",
        }

    except Exception as e:
        print(f"[Worker {os.getpid()}] LDaCA import failed: {str(e)}")
        if progress_callback:
            progress_callback(-1, f"Failed: {str(e)}")
        raise
