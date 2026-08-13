"""File-type detection, bounded data loading, and dtype normalization.

``NodeService`` uses this module to turn a validated user-file path into a
fully inferred Polars frame before staging an immutable source Data Block.
File preview instead preserves raw CSV/TSV lexemes as strings; JSON-family
previews use the same full-file inference as source creation.
"""

import stat
import unicodedata
import zipfile
from pathlib import Path, PurePosixPath, PureWindowsPath
from types import MappingProxyType
from typing import Final

import fastexcel
import polars as pl

LOADABLE_FILE_TYPES: Final = MappingProxyType(
    {
        ".csv": "csv",
        ".tsv": "tsv",
        ".json": "json",
        ".jsonl": "jsonl",
        ".ndjson": "jsonl",
        ".parquet": "parquet",
        ".avro": "avro",
        ".arrow": "ipc",
        ".ipc": "ipc",
        ".feather": "ipc",
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
        ".zip": "zip",
    }
)


class DataFileLoadError(ValueError):
    """A user-provided data file could not be parsed by its canonical loader."""


def detect_file_type(filename: str) -> str:
    """Detect file type from extension.

    Used by:
    - backend API routes, backend tests, core workspace and worker services because they
      need a backend boundary that validates inputs before delegating to workspace or worker
      state.
    """
    return LOADABLE_FILE_TYPES.get(Path(filename).suffix.lower(), "unknown")


def is_loadable_file(filename: str) -> bool:
    """Return whether one filename is admitted by the canonical allowlist."""

    return Path(filename).suffix.lower() in LOADABLE_FILE_TYPES


def load_data_file(
    file_path: Path,
    sheet_name: str | None = None,
) -> pl.LazyFrame | pl.DataFrame:
    """Build the authoritative loader for one supported user file.

    Used by ``materialize_data_file`` and direct loader tests. Row-oriented
    formats inspect the complete bounded source when establishing their schema,
    so values after Polars' default inference window cannot invalidate a type
    selected from only the first 100 rows.
    """
    try:
        return _load_data_file(file_path, sheet_name)
    except _DATA_FILE_LOAD_EXCEPTIONS as exc:
        raise DataFileLoadError("Data file could not be loaded") from exc


def materialize_data_file(
    file_path: Path,
    sheet_name: str | None = None,
) -> pl.DataFrame:
    """Materialize an authoritative source frame under one error boundary.

    Called by ``NodeService`` at the source-file I/O boundary before canonical
    dtype normalization and Parquet staging. Both loader construction and lazy
    collection are translated to ``DataFileLoadError`` so deferred Polars parse
    failures have the same service contract as eager reader failures.
    """
    try:
        loaded = load_data_file(file_path, sheet_name)
        return loaded.collect() if isinstance(loaded, pl.LazyFrame) else loaded
    except DataFileLoadError:
        raise
    except _DATA_FILE_LOAD_EXCEPTIONS as exc:
        raise DataFileLoadError("Data file could not be loaded") from exc


def load_data_file_preview(
    file_path: Path,
    sheet_name: str | None = None,
) -> pl.LazyFrame | pl.DataFrame:
    """Build the value-inspection loader used by ``FileReadService``.

    CSV and TSV previews disable inference so every field, including lexemes
    such as ``001``, is exposed as a string. JSON-family previews retain full
    inference because those formats encode value types directly; all remaining
    formats keep their authoritative loader behavior.
    """
    file_type = detect_file_type(file_path.name)
    try:
        if file_type == "csv":
            return pl.scan_csv(file_path, infer_schema=False)
        if file_type == "tsv":
            return pl.scan_csv(file_path, separator="\t", infer_schema=False)
        return _load_data_file(file_path, sheet_name)
    except _DATA_FILE_LOAD_EXCEPTIONS as exc:
        raise DataFileLoadError("Data file could not be loaded") from exc


_DATA_FILE_LOAD_EXCEPTIONS = (
    OSError,
    UnicodeError,
    ValueError,
    zipfile.BadZipFile,
    zipfile.LargeZipFile,
    fastexcel.FastExcelError,
    pl.exceptions.PolarsError,
)


def _load_data_file(
    file_path: Path,
    sheet_name: str | None,
) -> pl.LazyFrame | pl.DataFrame:
    file_type = detect_file_type(file_path.name)

    if file_type == "csv":
        return pl.scan_csv(file_path, infer_schema_length=None)
    if file_type == "parquet":
        return pl.scan_parquet(file_path)
    if file_type == "avro":
        return pl.read_avro(file_path)
    if file_type == "ipc":
        return pl.scan_ipc(file_path)
    if file_type == "json":
        return pl.read_json(file_path, infer_schema_length=None)
    if file_type == "jsonl":
        return pl.scan_ndjson(file_path, infer_schema_length=None)
    if file_type == "tsv":
        return pl.scan_csv(file_path, separator="\t", infer_schema_length=None)
    if file_type == "excel":
        validate_spreadsheet_container(file_path)
        result = (
            pl.read_excel(file_path, sheet_name=sheet_name)
            if sheet_name is not None
            else pl.read_excel(file_path)
        )
        if not isinstance(result, pl.DataFrame):
            raise RuntimeError("Excel import did not produce one DataFrame")
        return result
    if file_type == "text":
        return read_text_file(file_path)
    if file_type == "zip":
        return read_zip_file(file_path)
    raise ValueError(f"Unsupported file type: {file_type}")


def read_text_file(file_path: Path) -> pl.DataFrame:
    """Read a plain text file into a single-column Polars DataFrame."""
    content = file_path.read_text(encoding="utf-8")
    lines = content.splitlines()
    if not lines:
        return pl.DataFrame({"text": []})
    return pl.DataFrame({"text": lines})


_ZIP_DOCUMENT_SCHEMA = {
    "file_path": pl.String,
    "base_name": pl.String,
    "extension": pl.String,
    "document": pl.String,
}


def read_zip_file(file_path: Path) -> pl.DataFrame:
    """Read safe UTF-8 ZIP members into the canonical document table."""

    records: list[dict[str, str]] = []
    try:
        with zipfile.ZipFile(file_path) as archive:
            members = _validate_zip_members(archive, label="ZIP archive")
            for member in sorted(members, key=lambda item: item.filename):
                if member.is_dir():
                    continue
                inner_path = member.filename
                inner_name = PurePosixPath(inner_path).name
                if inner_path.startswith("__MACOSX/") or inner_name.startswith("._"):
                    continue
                try:
                    document = archive.read(member).decode("utf-8", errors="strict")
                except UnicodeDecodeError:
                    continue
                path = PurePosixPath(inner_path)
                records.append(
                    {
                        "file_path": inner_path,
                        "base_name": path.stem,
                        "extension": path.suffix,
                        "document": document,
                    }
                )
    except (OSError, zipfile.BadZipFile, zipfile.LargeZipFile) as exc:
        raise ValueError("ZIP archive is invalid") from exc

    return pl.DataFrame(records, schema=_ZIP_DOCUMENT_SCHEMA)


def validate_spreadsheet_container(file_path: Path) -> None:
    """Bound and validate ZIP-based spreadsheet containers before parsing."""

    if file_path.suffix.lower() == ".xls":
        return
    try:
        with zipfile.ZipFile(file_path) as archive:
            _validate_zip_members(archive, label="Spreadsheet")
    except (OSError, zipfile.BadZipFile, zipfile.LargeZipFile) as exc:
        raise ValueError("Spreadsheet container is invalid") from exc


def _validate_zip_members(
    archive: zipfile.ZipFile,
    *,
    label: str,
) -> list[zipfile.ZipInfo]:
    """Validate a ZIP directory before any member is read."""

    members = archive.infolist()
    seen: set[str] = set()
    for member in members:
        raw_name = member.orig_filename
        name = raw_name[:-1] if member.is_dir() and raw_name.endswith("/") else raw_name
        posix = PurePosixPath(name)
        windows = PureWindowsPath(name)
        if (
            not name
            or "\\" in name
            or "\x00" in name
            or posix.is_absolute()
            or windows.drive
            or windows.root
            or any(part in {"", ".", ".."} for part in name.split("/"))
        ):
            raise ValueError(f"{label} contains an unsafe member path")
        collision = unicodedata.normalize("NFC", name).casefold()
        if collision in seen:
            raise ValueError(f"{label} contains colliding member names")
        seen.add(collision)
        if member.flag_bits & 0x1:
            raise ValueError(f"Encrypted {label.lower()}s are unsupported")
        unix_mode = (member.external_attr >> 16) & 0xFFFF
        kind = stat.S_IFMT(unix_mode)
        allowed = {0, stat.S_IFDIR} if member.is_dir() else {0, stat.S_IFREG}
        if kind not in allowed:
            raise ValueError(f"{label} contains a link or special file")
        if member.file_size:
            if member.compress_size == 0:
                raise ValueError(f"{label} compression ratio is invalid")
            if member.file_size / member.compress_size > 200:
                raise ValueError(f"{label} compression ratio is too high")
    return members


_JS_MAX_SAFE_INTEGER = 2**53 - 1

_CANONICAL_DATETIME = pl.Datetime(time_unit="us", time_zone="UTC")
_INTEGERS_TO_PROMOTE = {
    pl.Int8,
    pl.Int16,
    pl.Int32,
    pl.UInt8,
    pl.UInt16,
    pl.UInt32,
    pl.UInt64,
}


def normalize_dtypes(
    df: pl.DataFrame,
) -> tuple[pl.DataFrame, list[dict[str, str]]]:
    """Coerce columns to the project's canonical dtype profile.

    Returns the normalized frame plus a per-column change log
    ``[{"column", "from_dtype", "to_dtype", "reason"}, ...]`` so callers can
    surface a consolidated warning to the user. The change log is empty when
    nothing needed casting.

    ``NodeService`` returns the change log with the created Data Block so the
    caller can explain any normalization applied at ingestion.
    """
    if df.width == 0:
        return df, []

    changes: list[dict[str, str]] = []
    casts: list[pl.Expr] = []

    for col, dtype in df.schema.items():
        if isinstance(dtype, pl.Datetime):
            time_unit = dtype.time_unit
            time_zone = dtype.time_zone
            if time_unit == "us" and time_zone == "UTC":
                continue
            expr = pl.col(col)
            reason_parts: list[str] = []
            if time_zone is None:
                expr = expr.dt.replace_time_zone("UTC")
                reason_parts.append("naive datetime assumed UTC")
            elif time_zone != "UTC":
                expr = expr.dt.convert_time_zone("UTC")
                reason_parts.append(f"converted from {time_zone} to UTC")
            if time_unit != "us":
                expr = expr.dt.cast_time_unit("us")
                reason_parts.append(
                    f"precision {time_unit}->us "
                    "(text analytics does not need sub-microsecond resolution)"
                )
            casts.append(expr.alias(col))
            changes.append(
                {
                    "column": col,
                    "from_dtype": str(dtype),
                    "to_dtype": str(_CANONICAL_DATETIME),
                    "reason": "; ".join(reason_parts),
                }
            )
        elif dtype in _INTEGERS_TO_PROMOTE:
            casts.append(pl.col(col).cast(pl.Int64).alias(col))
            kind = "unsigned" if str(dtype).startswith("UInt") else "narrower signed"
            changes.append(
                {
                    "column": col,
                    "from_dtype": str(dtype),
                    "to_dtype": "Int64",
                    "reason": (
                        f"{kind} integer promoted to Int64 so joins/stacks "
                        "across heterogeneous sources align"
                    ),
                }
            )
        elif dtype == pl.Float32:
            casts.append(pl.col(col).cast(pl.Float64).alias(col))
            changes.append(
                {
                    "column": col,
                    "from_dtype": "Float32",
                    "to_dtype": "Float64",
                    "reason": "Float32 widened to Float64 for cross-source alignment",
                }
            )

    if casts:
        df = df.with_columns(casts)
    return df, changes
