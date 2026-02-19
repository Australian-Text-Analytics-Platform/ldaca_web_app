"""
Core utilities for the LDaCA Web App
"""

import io
import json
import os
import shutil
import uuid
import zipfile
from contextlib import nullcontext
from importlib import resources
from pathlib import Path
from typing import Any, Dict, Optional, Union

import polars as pl

from ..settings import settings

# Direct imports - assuming proper package installation
# (Optional) Import heavy libs lazily where needed to reduce import cost.


def get_user_data_folder(user_id: str) -> Path:
    """Get user-specific data folder with proper structure"""
    # In single-user mode, always use 'user_root' folder
    if not settings.multi_user:
        folder_name = "user_root"
    else:
        folder_name = f"user_{user_id}"

    # Base under DATA_ROOT/users/<folder_name>
    user_folder = settings.get_data_root() / settings.user_data_folder / folder_name
    user_data_folder = user_folder / "user_data"
    user_data_folder.mkdir(parents=True, exist_ok=True)
    return user_data_folder


def get_user_workspace_folder(user_id: str) -> Path:
    """Get user-specific workspace folder"""
    # In single-user mode, always use 'user_root' folder
    if not settings.multi_user:
        folder_name = "user_root"
    else:
        folder_name = f"user_{user_id}"

    # Base under DATA_ROOT/users/<folder_name>
    user_folder = settings.get_data_root() / settings.user_data_folder / folder_name
    workspace_folder = user_folder / "user_workspaces"
    workspace_folder.mkdir(parents=True, exist_ok=True)
    return workspace_folder


def validate_workspace_name(name: str) -> tuple[bool, str]:
    """Validate workspace names for safe, portable folder usage.

    Allows spaces and common punctuation but rejects path separators, control
    characters, and traversal markers.
    """

    if name is None:
        return False, "name is required"

    trimmed = name.strip()
    if not trimmed:
        return False, "name cannot be empty"

    if ".." in trimmed:
        return False, "name cannot contain '..'"

    if "/" in trimmed or "\\" in trimmed:
        return False, "name cannot contain '/' or '\\'"

    for ch in trimmed:
        code = ord(ch)
        if code < 32 or code == 127:
            return False, "name cannot contain control characters"

    return True, ""


def allocate_workspace_folder(user_id: str, workspace_name: str) -> Path:
    """Create (and return) a unique folder for a workspace under the user's root."""

    base = get_user_workspace_folder(user_id)
    base.mkdir(parents=True, exist_ok=True)

    is_valid, reason = validate_workspace_name(workspace_name)
    if not is_valid:
        raise ValueError(reason)

    preferred = workspace_name.strip()
    candidate = preferred
    counter = 1
    while (base / candidate).exists():
        candidate = f"{preferred}_{counter}"
        counter += 1
    folder = base / candidate
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def ensure_display_folder_name(current_folder: Path, desired_name: str) -> Path:
    """Ensure the on-disk folder name matches the desired display name (with suffixes).

    If the current folder name already matches the sanitized desired name, it is
    returned unchanged. Otherwise, the folder is renamed to the first available
    `<name>`, `<name>_1`, `<name>_2`, ... variant within the same parent.
    """

    parent = current_folder.parent
    is_valid, reason = validate_workspace_name(desired_name)
    if not is_valid:
        raise ValueError(reason)

    desired = desired_name.strip()
    target = parent / desired

    if current_folder == target:
        return current_folder

    if not target.exists():
        current_folder.rename(target)
        return target

    counter = 1
    while True:
        candidate = parent / f"{desired}_{counter}"
        if candidate == current_folder:
            return current_folder
        if not candidate.exists():
            current_folder.rename(candidate)
            return candidate
        counter += 1


def find_workspace_folder_by_id(user_id: str, workspace_id: str) -> Optional[Path]:
    """Locate the workspace folder for a given workspace ID, if it exists."""

    base = get_user_workspace_folder(user_id)
    if not base.exists():
        return None
    for candidate in base.iterdir():
        if not candidate.is_dir():
            continue
        metadata_path = candidate / "metadata.json"
        if not metadata_path.exists() or not metadata_path.is_file():
            continue
        try:
            with metadata_path.open("r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            continue
        ws_meta = data.get("workspace_metadata", {})
        if ws_meta.get("id") == workspace_id:
            return candidate
    return None


def setup_user_folders(user_id: str) -> Dict[str, Path]:
    """Set up complete user folder structure.

    NOTE: Sample data is NO LONGER copied automatically during auth/login.
    Clients that wish to import sample data must call the dedicated
    "import sample data" endpoint which will invoke a controlled copy
    operation. This keeps login fast and avoids unexpected data resets.

    Used by:
    - auth login/session bootstrap endpoints

    Why:
    - Ensures required user data/workspace directories always exist before I/O.
    """
    folder_name = f"user_{user_id}"

    # Base under DATA_ROOT/users/<folder_name>
    user_folder = settings.get_data_root() / settings.user_data_folder / folder_name
    user_data_folder = user_folder / "user_data"
    user_workspaces_folder = user_folder / "user_workspaces"

    # Create the main folders
    user_data_folder.mkdir(parents=True, exist_ok=True)
    user_workspaces_folder.mkdir(parents=True, exist_ok=True)

    return {
        "user_folder": user_folder,
        "user_data": user_data_folder,
        "user_workspaces": user_workspaces_folder,
    }


def import_sample_data_for_user(user_id: str) -> Dict[str, Any]:
    """Import (or re-import) sample data for a user on demand.

    Removes any existing sample_data folder then copies from the canonical
    sample data source. Returns summary statistics.

    Used by:
    - sample-data import API endpoint

    Why:
    - Keeps sample data provisioning explicit and idempotent.
    """
    source_override = settings.get_sample_data_folder()
    user_data_folder = get_user_data_folder(user_id)
    target_sample_data = user_data_folder / "sample_data"

    if source_override:
        source_ctx = nullcontext(source_override)
    else:
        source_ctx = resources.as_file(
            resources.files("ldaca_web_app_backend.resources").joinpath("sample_data")
        )

    with source_ctx as source_sample_data:
        if not source_sample_data.exists():
            raise FileNotFoundError(
                f"Source sample data folder not found: {source_sample_data}"
            )

        removed_existing = False
        if target_sample_data.exists():
            shutil.rmtree(target_sample_data)
            removed_existing = True

        temp_target = user_data_folder / f".sample_data_tmp_{uuid.uuid4().hex}"
        shutil.copytree(source_sample_data, temp_target)
        os.replace(temp_target, target_sample_data)

    file_count = 0
    bytes_copied = 0
    for fp in target_sample_data.rglob("*"):
        if fp.is_file():
            file_count += 1
            try:
                bytes_copied += fp.stat().st_size
            except OSError:
                pass

    return {
        "removed_existing": removed_existing,
        "file_count": file_count,
        "bytes_copied": bytes_copied,
        "sample_dir": str(target_sample_data),
    }


def detect_file_type(filename: str) -> str:
    """Detect file type from extension"""
    ext = Path(filename).suffix.lower()
    type_map = {
        ".csv": "csv",
        ".json": "json",
        ".jsonl": "jsonl",
        ".parquet": "parquet",
        ".xlsx": "excel",
        ".xls": "excel",
        ".xlsm": "excel",
        ".xlsb": "excel",
        ".ods": "excel",
        ".txt": "text",
        ".text": "text",
        ".md": "text",
        ".rst": "text",
        ".log": "text",
        ".tsv": "tsv",
        ".zip": "zip",
    }
    return type_map.get(ext, "unknown")


def load_data_file(
    file_path: Path,
) -> Union[pl.DataFrame, pl.LazyFrame, Any]:
    """Load data file into appropriate DataFrame type - defaults to polars LazyFrame for efficiency"""
    file_type = detect_file_type(file_path.name)

    # Load as polars LazyFrame by default for better performance and memory efficiency
    if file_type == "csv":
        return pl.scan_csv(file_path)
    elif file_type == "parquet":
        return pl.scan_parquet(file_path)
    elif file_type == "json":
        # JSON doesn't have scan_json, fall back to read_json
        return pl.read_json(file_path)
    elif file_type == "tsv":
        return pl.scan_csv(file_path, separator="\t")
    elif file_type == "excel":
        # Use Polars to read Excel directly; returns an eager DataFrame
        try:
            return pl.read_excel(file_path)
        except Exception as ex:
            # Some versions require specifying sheet id/name
            try:
                return pl.read_excel(file_path, sheet_id=0)
            except Exception as ex2:
                raise RuntimeError(f"Failed to read Excel via polars: {ex2}") from ex
    elif file_type == "zip":
        return read_zip_file(file_path)
    elif file_type == "text":
        return read_text_file(file_path)
    else:
        raise ValueError(f"Unsupported file type: {file_type}")


def read_text_file(file_path: Path) -> pl.DataFrame:
    """Read a plain text file into a Polars DataFrame with a single text column."""
    content = file_path.read_text(encoding="utf-8", errors="replace")
    lines = content.splitlines()
    if not lines:
        return pl.DataFrame({"text": []})
    return pl.DataFrame({"text": lines})


def read_zip_file(file_path: Path) -> pl.DataFrame:
    """Read a zip archive and return a Polars DataFrame.

    Strategy: if the zip contains a single supported data file, read it.
    Otherwise, return a DataFrame listing contained files.
    """
    with zipfile.ZipFile(file_path, "r") as zf:
        file_infos = [info for info in zf.infolist() if not info.is_dir()]
        if not file_infos:
            return pl.DataFrame({"filename": [], "size": []})

        def file_type_from_name(name: str) -> str:
            return detect_file_type(name)

        supported = [
            info
            for info in file_infos
            if file_type_from_name(info.filename)
            in {"csv", "tsv", "json", "jsonl", "ndjson", "parquet", "text"}
        ]

        if len(supported) == 1:
            info = supported[0]
            inner_type = file_type_from_name(info.filename)
            with zf.open(info, "r") as fh:
                data = fh.read()
            if inner_type in {"csv", "tsv"}:
                sep = "\t" if inner_type == "tsv" else ","
                return pl.read_csv(io.BytesIO(data), separator=sep)
            if inner_type in {"jsonl", "ndjson"}:
                return pl.read_ndjson(io.BytesIO(data))
            if inner_type == "json":
                return pl.read_json(io.BytesIO(data))
            if inner_type == "parquet":
                return pl.read_parquet(io.BytesIO(data))
            if inner_type == "text":
                content = data.decode("utf-8", errors="replace")
                lines = content.splitlines()
                return pl.DataFrame({"text": lines})

        return pl.DataFrame({
            "filename": [info.filename for info in file_infos],
            "size": [info.file_size for info in file_infos],
        })


def generate_workspace_id() -> str:
    """Generate a unique workspace ID"""
    return str(uuid.uuid4())


def validate_file_path(file_path: Path, user_folder: Path) -> bool:
    """Validate that file path is within user's allowed directory"""
    try:
        file_path.resolve().relative_to(user_folder.resolve())
        return True
    except ValueError:
        return False
