"""Safe file inspection through the canonical Arrow IPC table boundary."""

from __future__ import annotations

from functools import partial
from pathlib import Path

import anyio
import fastexcel
import polars as pl
from anyio.to_thread import run_sync as run_sync_in_worker_thread

from ..infrastructure.storage.data_loading import (
    DataFileLoadError,
    detect_file_type,
    load_data_file_preview,
    validate_spreadsheet_container,
)
from ..models.files import FileWorksheetsResource
from ..shared.errors import InvalidInputError, ResourceTooLargeError
from ..shared.table_transport import (
    IpcTablePage,
    encode_schema_stream,
    materialize_page,
)
from .user_files import UserFileStore


class FileReadService:
    """Own bounded previews, worksheet discovery, and UTF-8 reads."""

    def __init__(
        self,
        file_store: UserFileStore,
        *,
        limiter: anyio.CapacityLimiter,
        max_preview_bytes: int,
        max_text_bytes: int,
    ) -> None:
        self._file_store = file_store
        self._limiter = limiter
        self._max_preview_bytes = max_preview_bytes
        self._max_text_bytes = max_text_bytes

    async def preview(
        self,
        user_id: str,
        relative_path: str,
        *,
        page: int,
        page_size: int,
        sheet_name: str | None,
    ) -> IpcTablePage:
        async with self._file_store.read_path(user_id, relative_path) as path:
            await self._ensure_preview_size(path)
            return await self._run_sync(
                _materialize_file_page,
                path,
                page,
                page_size,
                sheet_name,
            )

    async def schema(
        self,
        user_id: str,
        relative_path: str,
        *,
        sheet_name: str | None,
    ) -> bytes:
        async with self._file_store.read_path(user_id, relative_path) as path:
            await self._ensure_preview_size(path)
            return await self._run_sync(_file_schema, path, sheet_name)

    async def worksheets(
        self,
        user_id: str,
        relative_path: str,
    ) -> FileWorksheetsResource:
        async with self._file_store.read_path(user_id, relative_path) as path:
            await self._ensure_preview_size(path)
            sheets = await self._run_sync(_excel_worksheets, path)
            return FileWorksheetsResource(
                sheets=sheets,
                default_sheet=sheets[0],
            )

    async def read_text(self, user_id: str, relative_path: str) -> tuple[str, str]:
        async with self._file_store.read_path(user_id, relative_path) as path:
            if (await self._stat(path)).st_size > self._max_text_bytes:
                raise ResourceTooLargeError("File is too large for a text response")
            try:
                content = await self._run_sync(path.read_text, encoding="utf-8")
            except UnicodeDecodeError as exc:
                raise InvalidInputError("File is not valid UTF-8 text") from exc
            media_type = (
                "text/markdown" if path.suffix.lower() == ".md" else "text/plain"
            )
            return content, media_type

    async def _ensure_preview_size(self, path: Path) -> None:
        if (await self._stat(path)).st_size > self._max_preview_bytes:
            raise ResourceTooLargeError("File is too large to preview")

    async def _stat(self, path: Path):
        return await self._run_sync(path.stat)

    async def _run_sync(self, function, *args, **kwargs):
        return await run_sync_in_worker_thread(
            partial(function, *args, **kwargs),
            abandon_on_cancel=False,
            limiter=self._limiter,
        )


def _file_lazyframe(path: Path, sheet_name: str | None) -> pl.LazyFrame:
    """Build the preview-specific lazy frame consumed by page and schema reads.

    CSV/TSV fields remain raw strings while JSON-family types come from full
    inference. Deferred collection errors are translated by the materializing
    caller because constructing a lazy scanner does not necessarily parse data.
    """
    file_type = detect_file_type(path.name)
    try:
        if file_type == "excel":
            sheets = _excel_worksheets(path)
            selected = sheet_name or sheets[0]
            if selected not in sheets:
                raise InvalidInputError("Excel sheet not found")
            sheet_name = selected
        loaded = load_data_file_preview(path, sheet_name)
        return loaded if isinstance(loaded, pl.LazyFrame) else loaded.lazy()
    except InvalidInputError:
        raise
    except DataFileLoadError as exc:
        raise InvalidInputError("File preview could not be generated") from exc


def _materialize_file_page(
    path: Path,
    page: int,
    page_size: int,
    sheet_name: str | None,
) -> IpcTablePage:
    """Materialize one raw-value preview page and classify parser failures."""
    try:
        return materialize_page(
            _file_lazyframe(path, sheet_name),
            page=page,
            page_size=page_size,
        )
    except InvalidInputError:
        raise
    except (DataFileLoadError, pl.exceptions.PolarsError) as exc:
        raise InvalidInputError("File preview could not be generated") from exc


def _file_schema(path: Path, sheet_name: str | None) -> bytes:
    """Materialize the preview policy's schema and classify parser failures."""
    try:
        return encode_schema_stream(_file_lazyframe(path, sheet_name).collect_schema())
    except InvalidInputError:
        raise
    except (DataFileLoadError, pl.exceptions.PolarsError) as exc:
        raise InvalidInputError("File preview could not be generated") from exc


def _excel_worksheets(path: Path) -> list[str]:
    if detect_file_type(path.name) != "excel":
        raise InvalidInputError("File is not an Excel workbook")
    try:
        validate_spreadsheet_container(path)
        sheets = [str(name) for name in fastexcel.read_excel(path).sheet_names]
    except (OSError, ValueError, fastexcel.FastExcelError) as exc:
        raise InvalidInputError("Excel workbook could not be read") from exc
    if not sheets:
        raise InvalidInputError("Excel workbook contains no sheets")
    return sheets


__all__ = ["FileReadService"]
