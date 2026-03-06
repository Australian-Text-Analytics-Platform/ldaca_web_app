"""
Core utilities for the LDaCA Web App
"""

import io
import os
import shutil
import uuid
import warnings
import zipfile
from contextlib import nullcontext
from importlib import resources
from pathlib import Path
from typing import Any, Dict, Iterable, Optional, Union

import polars as pl

from ..settings import settings

_DEFAULT_TEXT_FILE_EXTENSIONS: set[str] = {
    ".txt",
    ".md",
    ".rst",
    ".log",
    ".csv",
    ".tsv",
    ".json",
    ".jsonl",
    ".ndjson",
    ".xml",
    ".html",
    ".htm",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".text",
}

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
    sheet_name: Optional[str] = None,
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
        def _coerce_excel_result_to_dataframe(result: Any) -> pl.DataFrame:
            if isinstance(result, pl.DataFrame):
                return result
            if isinstance(result, dict):
                if (
                    sheet_name
                    and sheet_name in result
                    and isinstance(result[sheet_name], pl.DataFrame)
                ):
                    return result[sheet_name]
                for value in result.values():
                    if isinstance(value, pl.DataFrame):
                        return value
            raise RuntimeError(
                f"Unexpected Excel read result type: {type(result).__name__}"
            )

        try:
            if sheet_name:
                return _coerce_excel_result_to_dataframe(
                    pl.read_excel(file_path, sheet_name=sheet_name)
                )
            return _coerce_excel_result_to_dataframe(pl.read_excel(file_path))
        except Exception as ex:
            # Some versions require specifying sheet id/name
            try:
                return _coerce_excel_result_to_dataframe(
                    pl.read_excel(file_path, sheet_id=0)
                )
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


def read_zip_file(
    file_path: str | Path,
    *,
    encoding: str = "utf-8",
    errors: str = "ignore",
    text_extensions: Iterable[str] | None = None,
    include_extensionless: bool = True,
) -> pl.DataFrame:
    """Read text files from a ZIP archive into a Polars DataFrame.

    Returns a deterministic, path-sorted table with columns:
    ``file_path``, ``base_name``, ``extension``, and ``document``.
    """
    archive_path = Path(file_path)
    if not archive_path.exists():
        raise FileNotFoundError(f"ZIP archive not found: {archive_path}")

    if text_extensions is None:
        allowed_extensions = _DEFAULT_TEXT_FILE_EXTENSIONS
    else:
        allowed_extensions = {
            (ext if ext.startswith(".") else f".{ext}").lower()
            for ext in text_extensions
        }

    records: list[dict[str, str]] = []

    with zipfile.ZipFile(archive_path) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue

            inner_path = info.filename
            path_obj = Path(inner_path)
            file_name = path_obj.name
            base_name = path_obj.stem
            extension = path_obj.suffix

            if inner_path.startswith("__MACOSX/") or file_name.startswith("._"):
                continue

            suffix = extension.lower()
            if suffix:
                if suffix not in allowed_extensions:
                    continue
            elif not include_extensionless:
                continue

            with archive.open(info, "r") as file_obj:
                data = file_obj.read()

            try:
                text_content = data.decode(encoding, errors=errors)
            except UnicodeDecodeError:
                warnings.warn(
                    (
                        f"Skipping '{inner_path}' - unable to decode with "
                        f"encoding {encoding!r}"
                    ),
                    UserWarning,
                    stacklevel=2,
                )
                continue

            records.append({
                "file_path": inner_path,
                "base_name": base_name,
                "extension": extension,
                "document": text_content,
            })

    records.sort(key=lambda entry: entry["file_path"])

    return pl.DataFrame(
        records,
        schema={
            "file_path": pl.String,
            "base_name": pl.String,
            "extension": pl.String,
            "document": pl.String,
        },
    )


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
