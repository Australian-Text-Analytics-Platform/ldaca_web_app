"""
File management endpoints
"""

from pathlib import Path
from typing import Any, Dict, List, Optional

import polars as pl
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

import docframe
from docframe import DocDataFrame

from ..core.auth import get_current_user
from ..core.utils import (
    detect_file_type,
    get_user_data_folder,
    import_sample_data_for_user,
    load_data_file,
    serialize_dataframe_for_json,
    validate_file_path,
)
from ..models import (
    FilePreviewRequest,
    FilePreviewResponse,
    FileUploadResponse,
    ImportSampleDataResponse,
)

router = APIRouter(prefix="/files", tags=["file_management"])


def _lazy_scan(file_path, file_type: str) -> pl.LazyFrame:
    """Return a Polars LazyFrame for the given file if possible.

    Prefers scan_* readers to avoid loading the whole file into memory.
    Falls back to eager read + .lazy() for formats without a native scanner.
    """
    ft = (file_type or "").lower()
    if ft == "csv":
        return pl.scan_csv(file_path)
    if ft == "tsv":
        return pl.scan_csv(file_path, separator="\t")
    if ft == "parquet":
        return pl.scan_parquet(file_path)
    if ft in ("jsonl", "ndjson"):
        # Prefer scan_ndjson when available
        scan_ndjson: Any = getattr(pl, "scan_ndjson", None)
        if callable(scan_ndjson):
            try:
                lf = scan_ndjson(file_path)
                if isinstance(lf, pl.LazyFrame):
                    return lf
            except Exception:
                pass
        return pl.read_ndjson(file_path).lazy()
    if ft == "json":
        return pl.read_json(file_path).lazy()
    if ft == "excel":
        # Polars may not have scan_excel; fall back to read_excel first sheet then lazy
        try:
            df = pl.read_excel(file_path, sheet_id=0)
            return df.lazy()
        except Exception:
            return pl.DataFrame().lazy()
    return pl.DataFrame().lazy()


def _get_supported_types_by_extension(file_type: str) -> List[str]:
    """Return supported data types for a given file type/extension."""

    ft = (file_type or "").lower()
    mapping: Dict[str, List[str]] = {
        "csv": ["DocLazyFrame", "LazyFrame"],
        "tsv": ["DocLazyFrame", "LazyFrame"],
        "jsonl": ["DocLazyFrame", "LazyFrame"],
        "ndjson": ["DocLazyFrame", "LazyFrame"],
        "json": ["DocLazyFrame", "LazyFrame"],
        "parquet": ["DocLazyFrame", "LazyFrame"],
        "excel": ["DocLazyFrame", "LazyFrame"],
        "text": ["DocLazyFrame", "LazyFrame"],
        "zip": ["DocLazyFrame", "LazyFrame"],
        "unknown": [],
    }
    return mapping.get(ft, [])


def _coerce_polars_dataframe(obj: Any) -> pl.DataFrame:
    """Ensure the returned object is a Polars DataFrame."""

    if isinstance(obj, pl.DataFrame):
        return obj
    if isinstance(obj, DocDataFrame):
        return obj.dataframe
    raise RuntimeError(
        "DocFrame returned an unsupported object when loading an Excel sheet"
    )


def _read_excel_sheet(file_path: Path, sheet_name: str) -> pl.DataFrame:
    df = docframe.read_excel(
        file_path,
        sheet_name=sheet_name,
        document_column=False,
    )
    return _coerce_polars_dataframe(df)


@router.get("/")
async def get_user_files(current_user: dict = Depends(get_current_user)):
    """Get user's files with path metadata and totals"""
    user_id = current_user["id"]
    data_folder = get_user_data_folder(user_id)

    files = []

    # Recursively find all files in the user's data folder
    for file_path in data_folder.rglob("*"):
        if file_path.is_file() and not file_path.name.startswith("."):
            # Get relative path from the data folder
            relative_path = file_path.relative_to(data_folder)
            rel_str = str(relative_path)
            is_sample = rel_str.startswith("sample_data/")
            files.append({
                "filename": rel_str,  # full path relative to user data root
                "full_path": rel_str,
                "display_name": file_path.name,
                "size": file_path.stat().st_size,
                "created_at": file_path.stat().st_ctime,
                "file_type": detect_file_type(file_path.name),
                "folder": str(relative_path.parent)
                if str(relative_path.parent) != "."
                else "",
                "is_sample": is_sample,
                "path_type": "sample" if is_sample else "user",
            })

    return {
        "files": files,
        "total": len(files),
        "user_folder": str(data_folder),
    }


@router.post("/upload", response_model=FileUploadResponse)
async def upload_file(file: UploadFile, current_user: dict = Depends(get_current_user)):
    """Upload file to user's data folder"""
    user_id = current_user["id"]
    data_folder = get_user_data_folder(user_id)

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    file_path = data_folder / file.filename

    # Check if file already exists
    if file_path.exists():
        raise HTTPException(
            status_code=409, detail=f"File {file.filename} already exists"
        )

    # Save file
    try:
        with open(file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

    file_type = detect_file_type(file.filename)

    return {
        "filename": file.filename,
        "size": len(content),
        "upload_time": str(file_path.stat().st_ctime),
        "file_type": file_type,
        "preview_available": file_type in ["csv", "json", "parquet"],
    }


@router.delete("/{filename:path}")
async def delete_file(filename: str, current_user: dict = Depends(get_current_user)):
    """Delete user's file"""
    user_id = current_user["id"]
    data_folder = get_user_data_folder(user_id)
    file_path = data_folder / filename

    # Security check
    if not validate_file_path(file_path, data_folder):
        raise HTTPException(
            status_code=403, detail="Access denied: file outside allowed directory"
        )

    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File {filename} not found")

    try:
        file_path.unlink()
        return {"message": f"File {filename} deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete file: {str(e)}")


@router.post("/import-sample-data", response_model=ImportSampleDataResponse)
async def import_sample_data(current_user: dict = Depends(get_current_user)):
    """Import (or re-import) sample data for the current user on demand."""
    user_id = current_user["id"]
    try:
        summary = import_sample_data_for_user(user_id)
        return {
            "status": "ok",
            "removed_existing": summary["removed_existing"],
            "file_count": summary["file_count"],
            "bytes_copied": summary["bytes_copied"],
            "sample_dir": summary["sample_dir"],
            "message": "Sample data imported successfully",
        }
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to import sample data: {e}"
        )


@router.post("/preview", response_model=FilePreviewResponse)
async def unified_file_preview(
    req: FilePreviewRequest, current_user: dict = Depends(get_current_user)
):
    """Unified file preview endpoint.

    - Returns supported types based on extension.
    - Provides preview data (first few rows or page slice).
    - For Excel files, returns sheet_names and supports selecting sheet via payload.sheet_name.
    """
    user_id = current_user["id"]
    data_folder = get_user_data_folder(user_id)
    file_path = data_folder / req.filename

    if not validate_file_path(file_path, data_folder):
        raise HTTPException(
            status_code=403, detail="Access denied: file outside allowed directory"
        )
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File {req.filename} not found")

    file_type = detect_file_type(file_path.name)
    supported_types = _get_supported_types_by_extension(file_type)

    # Pagination normalization
    page = max(0, int(req.page))
    page_size = max(1, min(500, int(req.page_size)))
    offset = page * page_size

    columns: List[str] = []
    preview: List[Dict[str, Any]] = []
    total_rows = 0
    sheet_names: Optional[List[str]] = None
    selected_sheet: Optional[str] = None

    try:
        if file_type == "excel":
            try:
                sheet_names = docframe.excel_sheet_names(file_path)
            except ImportError as exc:
                raise HTTPException(status_code=500, detail=str(exc)) from exc

            # Choose sheet: payload.sheet_name or first sheet
            payload = req.payload or {}
            selected_sheet = payload.get("sheet_name") or (
                sheet_names[0] if sheet_names else None
            )

            if selected_sheet is None:
                # No sheets found or cannot determine
                return FilePreviewResponse(
                    filename=req.filename,
                    file_type=file_type,
                    supported_types=supported_types,
                    columns=[],
                    preview=[],
                    total_rows=0,
                    sheet_names=sheet_names,
                    selected_sheet=None,
                )

            try:
                base_df = _read_excel_sheet(file_path, selected_sheet)
            except ImportError as exc:
                raise HTTPException(status_code=500, detail=str(exc)) from exc
            except RuntimeError as exc:
                raise HTTPException(status_code=500, detail=str(exc))

            total_rows = int(base_df.height)
            df = base_df.slice(offset, page_size)

            columns = list(df.columns)
            preview = df.fill_null("None").to_dicts() if hasattr(df, "to_dicts") else []

        elif file_type == "zip":
            doc_df = docframe.read_zip(file_path)
            df = doc_df.dataframe
            total_rows = int(df.height)
            if offset or page_size:
                df = df.slice(offset, page_size)
            columns = list(df.columns)
            preview = df.fill_null("None").to_dicts()
        elif file_type == "text":
            doc_df = docframe.read_text(file_path)
            df = doc_df.dataframe
            total_rows = int(df.height)
            if offset or page_size:
                df = df.slice(offset, page_size)
            columns = list(df.columns)
            preview = df.fill_null("None").to_dicts()
        else:
            # Non-Excel: prefer lazy scan where available
            lf = _lazy_scan(file_path, file_type).slice(offset, page_size)
            df = lf.collect()
            columns = list(df.columns)
            preview = df.fill_null("None").to_dicts()
            total_rows = 0  # unknown unless we count eagerly

        return FilePreviewResponse(
            filename=req.filename,
            file_type=file_type,
            supported_types=supported_types,
            columns=columns,
            preview=preview,
            total_rows=total_rows,
            sheet_names=sheet_names,
            selected_sheet=selected_sheet,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=400, detail=f"Error generating preview: {str(e)}"
        )


@router.get("/{filename:path}/info")
async def get_file_info(filename: str, current_user: dict = Depends(get_current_user)):
    """Get detailed file information"""
    user_id = current_user["id"]
    data_folder = get_user_data_folder(user_id)
    file_path = data_folder / filename

    # Security check
    if not validate_file_path(file_path, data_folder):
        raise HTTPException(
            status_code=403, detail="Access denied: file outside allowed directory"
        )

    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File {filename} not found")

    try:
        stat = file_path.stat()
        file_type = detect_file_type(filename)

        # Try to get DataFrame info
        df_info = None
        try:
            df = load_data_file(file_path)
            df_info = serialize_dataframe_for_json(df)
        except Exception:
            pass

        return {
            "filename": filename,
            "size": stat.st_size,
            "size_mb": stat.st_size / (1024 * 1024),
            "created_at": stat.st_ctime,
            "modified_at": stat.st_mtime,
            "file_type": file_type,
            "dataframe_info": df_info,
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error getting file info: {str(e)}"
        )


# Keep the catch-all download route LAST so that more specific routes like
# "/{filename:path}/preview" and "/{filename:path}/info" are matched first.
@router.get("/{filename:path}")
async def download_file(filename: str, current_user: dict = Depends(get_current_user)):
    """Download user's file"""
    user_id = current_user["id"]
    data_folder = get_user_data_folder(user_id)
    file_path = data_folder / filename

    # Security check
    if not validate_file_path(file_path, data_folder):
        raise HTTPException(
            status_code=403, detail="Access denied: file outside allowed directory"
        )

    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File {filename} not found")

    def iterfile():
        with open(file_path, mode="rb") as file_like:
            yield from file_like

    # Get just the filename for the download header
    download_filename = file_path.name

    return StreamingResponse(
        iterfile(),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={download_filename}"},
    )
