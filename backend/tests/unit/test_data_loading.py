"""Contract tests for the canonical Data Block source loader."""

from __future__ import annotations

import stat
import struct
import json
import zipfile
from collections.abc import Mapping, Sequence
from pathlib import Path

import polars as pl
import pytest

from ldaca_wordflow.infrastructure.storage.data_loading import (
    DataFileLoadError,
    LOADABLE_FILE_TYPES,
    detect_file_type,
    load_data_file,
    load_data_file_preview,
    materialize_data_file,
    normalize_dtypes,
)


def _write_row_oriented_fixture(
    path: Path,
    extension: str,
    rows: Sequence[Mapping[str, object]],
) -> None:
    """Write equivalent records in each row-oriented loader syntax."""
    if extension in {"csv", "tsv"}:
        separator = "," if extension == "csv" else "\t"
        header = separator.join(rows[0])
        body = [separator.join(str(value) for value in row.values()) for row in rows]
        path.write_text("\n".join([header, *body, ""]), encoding="utf-8")
    elif extension == "json":
        path.write_text(json.dumps(rows), encoding="utf-8")
    else:
        path.write_text(
            "\n".join(json.dumps(row) for row in rows) + "\n",
            encoding="utf-8",
        )


@pytest.mark.parametrize("extension", ["csv", "tsv", "json", "jsonl", "ndjson"])
def test_authoritative_row_loaders_infer_from_the_complete_file(
    tmp_path: Path,
    extension: str,
) -> None:
    """A value after row 100 widens the authoritative column without data loss."""
    path = tmp_path / f"late-mixed.{extension}"
    rows = [{"value": value} for value in range(101)] + [{"value": "late text"}]
    _write_row_oriented_fixture(path, extension, rows)

    loaded = materialize_data_file(path)
    normalized, changes = normalize_dtypes(loaded)

    assert normalized.schema == {"value": pl.String}
    assert normalized.height == 102
    assert normalized["value"].to_list() == [
        *(str(value) for value in range(101)),
        "late text",
    ]
    assert changes == []


@pytest.mark.parametrize("extension", ["csv", "tsv", "json", "jsonl", "ndjson"])
def test_authoritative_row_loaders_keep_homogeneous_numbers_numeric(
    tmp_path: Path,
    extension: str,
) -> None:
    path = tmp_path / f"numeric.{extension}"
    _write_row_oriented_fixture(
        path,
        extension,
        [{"first": value, "second": value + 1} for value in range(102)],
    )

    loaded = materialize_data_file(path)

    assert loaded.schema == {"first": pl.Int64, "second": pl.Int64}


def test_authoritative_inference_resolves_multiple_late_mixed_columns(
    tmp_path: Path,
) -> None:
    path = tmp_path / "multiple.csv"
    rows: list[dict[str, int | str]] = [
        {"first": value, "second": value} for value in range(101)
    ]
    rows.append({"first": "late first", "second": "late second"})
    _write_row_oriented_fixture(path, "csv", rows)

    loaded = materialize_data_file(path)

    assert loaded.schema == {"first": pl.String, "second": pl.String}
    assert loaded.tail(1).to_dicts() == [
        {"first": "late first", "second": "late second"}
    ]


@pytest.mark.parametrize("extension", ["csv", "tsv"])
def test_delimited_preview_loader_preserves_raw_lexemes(
    tmp_path: Path,
    extension: str,
) -> None:
    path = tmp_path / f"raw.{extension}"
    _write_row_oriented_fixture(
        path,
        extension,
        [{"identifier": "001", "value": "1"}, {"identifier": "002", "value": "2"}],
    )

    loaded = load_data_file_preview(path)
    frame = loaded.collect() if isinstance(loaded, pl.LazyFrame) else loaded

    assert frame.schema == {"identifier": pl.String, "value": pl.String}
    assert frame.to_dicts() == [
        {"identifier": "001", "value": "1"},
        {"identifier": "002", "value": "2"},
    ]


@pytest.mark.parametrize(
    ("filename", "content"),
    [
        ("invalid-utf8.csv", b"value\nvalid\n\xff\n"),
        ("malformed.csv", b"first,second\n1,2,3\n"),
        ("malformed.json", b'[{"value": 1},'),
        ("malformed.jsonl", b'{"value": 1}\n{"value":\n'),
        ("malformed.ndjson", b'{"value": 1}\n{"value":\n'),
    ],
)
def test_authoritative_materialization_wraps_deferred_parser_failures(
    tmp_path: Path,
    filename: str,
    content: bytes,
) -> None:
    path = tmp_path / filename
    path.write_bytes(content)

    with pytest.raises(DataFileLoadError):
        materialize_data_file(path)


@pytest.mark.parametrize(
    ("filename", "expected_type"),
    [
        ("DATA.CSV", "csv"),
        ("data.tsv", "tsv"),
        ("data.json", "json"),
        ("data.jsonl", "jsonl"),
        ("data.ndjson", "jsonl"),
        ("data.parquet", "parquet"),
        ("data.avro", "avro"),
        ("data.arrow", "ipc"),
        ("data.ipc", "ipc"),
        ("data.feather", "ipc"),
        ("data.xlsx", "excel"),
        ("data.xls", "excel"),
        ("data.xlsm", "excel"),
        ("data.xlsb", "excel"),
        ("data.ods", "excel"),
        ("data.txt", "text"),
        ("data.text", "text"),
        ("data.md", "text"),
        ("data.rst", "text"),
        ("data.log", "text"),
        ("documents.zip", "zip"),
        ("figure.png", "unknown"),
        ("compressed.csv.gz", "unknown"),
    ],
)
def test_loadable_file_allowlist_is_the_detection_contract(
    filename: str,
    expected_type: str,
) -> None:
    assert detect_file_type(filename) == expected_type
    assert (Path(filename).suffix.lower() in LOADABLE_FILE_TYPES) is (
        expected_type != "unknown"
    )


def test_json_lines_extensions_share_one_ingestion_path(tmp_path: Path) -> None:
    for extension in ("jsonl", "ndjson"):
        path = tmp_path / f"records.{extension}"
        path.write_text('{"text":"first"}\n{"text":"second"}\n', encoding="utf-8")

        assert detect_file_type(path.name) == "jsonl"
        loaded = load_data_file(path)
        assert isinstance(loaded, pl.LazyFrame)
        assert loaded.collect().to_dicts() == [
            {"text": "first"},
            {"text": "second"},
        ]


def test_text_ingestion_rejects_invalid_utf8_instead_of_replacing_it(
    tmp_path: Path,
) -> None:
    path = tmp_path / "invalid.txt"
    path.write_bytes(b"valid\xffinvalid")

    with pytest.raises(DataFileLoadError):
        load_data_file(path)


@pytest.mark.parametrize(
    ("extension", "writer"),
    [
        ("avro", "write_avro"),
        ("arrow", "write_ipc"),
        ("ipc", "write_ipc"),
        ("feather", "write_ipc"),
    ],
)
def test_columnar_formats_load_through_the_canonical_source_loader(
    tmp_path: Path,
    extension: str,
    writer: str,
) -> None:
    path = tmp_path / f"records.{extension}"
    expected = pl.DataFrame({"text": ["first", "second"], "count": [1, 2]})
    getattr(expected, writer)(path)

    loaded = load_data_file(path)

    assert loaded.lazy().collect().to_dicts() == expected.to_dicts()


def test_zip_ingestion_returns_one_row_per_utf8_document_in_path_order(
    tmp_path: Path,
) -> None:
    path = tmp_path / "documents.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("nested/z.custom", "last")
        archive.writestr("alpha", "first")
        archive.writestr("binary.png", b"valid-prefix\xffinvalid")
        archive.writestr("__MACOSX/ignored.txt", "metadata")
        archive.writestr("nested/._ignored.txt", "metadata")

    loaded = load_data_file(path)

    assert isinstance(loaded, pl.DataFrame)
    assert loaded.schema == {
        "file_path": pl.String,
        "base_name": pl.String,
        "extension": pl.String,
        "document": pl.String,
    }
    assert loaded.to_dicts() == [
        {
            "file_path": "alpha",
            "base_name": "alpha",
            "extension": "",
            "document": "first",
        },
        {
            "file_path": "nested/z.custom",
            "base_name": "z",
            "extension": ".custom",
            "document": "last",
        },
    ]


def test_zip_without_utf8_documents_returns_the_typed_empty_contract(
    tmp_path: Path,
) -> None:
    path = tmp_path / "binary.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("figure.png", b"\xff\xfe\x00")

    loaded = load_data_file(path)

    assert isinstance(loaded, pl.DataFrame)
    assert loaded.schema == {
        "file_path": pl.String,
        "base_name": pl.String,
        "extension": pl.String,
        "document": pl.String,
    }
    assert loaded.is_empty()


@pytest.mark.parametrize("unsafe_name", ["../escape.txt", "folder\\escape.txt"])
def test_zip_ingestion_rejects_unsafe_member_paths(
    tmp_path: Path,
    unsafe_name: str,
) -> None:
    path = tmp_path / "unsafe.zip"
    member = zipfile.ZipInfo("placeholder")
    # Bypass ZipInfo's Windows separator normalization to write the raw test path.
    member.orig_filename = unsafe_name
    member.filename = unsafe_name
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(member, "unsafe")

    with pytest.raises(DataFileLoadError):
        load_data_file(path)


def test_zip_ingestion_rejects_collisions_and_special_members(tmp_path: Path) -> None:
    collision = tmp_path / "collision.zip"
    with zipfile.ZipFile(collision, "w") as archive:
        archive.writestr("A.txt", "first")
        archive.writestr("a.txt", "second")

    with pytest.raises(DataFileLoadError):
        load_data_file(collision)

    special = tmp_path / "special.zip"
    member = zipfile.ZipInfo("linked.txt")
    member.create_system = 3
    member.external_attr = (stat.S_IFLNK | 0o777) << 16
    with zipfile.ZipFile(special, "w") as archive:
        archive.writestr(member, "target.txt")

    with pytest.raises(DataFileLoadError):
        load_data_file(special)


def test_zip_ingestion_rejects_excessive_compression_ratio(tmp_path: Path) -> None:
    path = tmp_path / "compressed.zip"
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("document.txt", "a" * 1_000_000)

    with pytest.raises(DataFileLoadError):
        load_data_file(path)


def _patch_central_directory_sizes(
    content: bytes,
    *,
    compressed_size: int,
    file_size: int,
) -> bytes:
    modified = bytearray(content)
    position = 0
    while (position := modified.find(b"PK\x01\x02", position)) != -1:
        struct.pack_into("<I", modified, position + 20, compressed_size)
        struct.pack_into("<I", modified, position + 24, file_size)
        position += 4
    return bytes(modified)


def _set_encrypted_flag(content: bytes) -> bytes:
    modified = bytearray(content)
    for signature, flag_offset in ((b"PK\x03\x04", 6), (b"PK\x01\x02", 8)):
        position = 0
        while (position := modified.find(signature, position)) != -1:
            flags = struct.unpack_from("<H", modified, position + flag_offset)[0]
            struct.pack_into("<H", modified, position + flag_offset, flags | 1)
            position += 4
    return bytes(modified)


def test_zip_ingestion_rejects_encrypted_members(tmp_path: Path) -> None:
    path = tmp_path / "encrypted.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("document.txt", "secret")
    path.write_bytes(_set_encrypted_flag(path.read_bytes()))

    with pytest.raises(DataFileLoadError):
        load_data_file(path)


def test_zip_ingestion_accepts_more_than_five_thousand_members(tmp_path: Path) -> None:
    path = tmp_path / "many.zip"
    with zipfile.ZipFile(path, "w") as archive:
        for index in range(5_001):
            archive.writestr(f"{index}.txt", "")

    result = load_data_file(path)

    assert isinstance(result, pl.DataFrame)
    assert result.height == 5_001


def test_zip_ingestion_accepts_previous_member_and_total_expanded_size_limits(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(zipfile.ZipFile, "read", lambda *_args, **_kwargs: b"x")

    oversized_member = tmp_path / "oversized-member.zip"
    with zipfile.ZipFile(oversized_member, "w") as archive:
        archive.writestr("large.txt", "x")
    oversized_member.write_bytes(
        _patch_central_directory_sizes(
            oversized_member.read_bytes(),
            compressed_size=1 * 1024 * 1024,
            file_size=65 * 1024 * 1024,
        )
    )

    member_result = load_data_file(oversized_member)

    assert isinstance(member_result, pl.DataFrame)
    assert member_result.height == 1

    oversized_total = tmp_path / "oversized-total.zip"
    with zipfile.ZipFile(oversized_total, "w") as archive:
        for index in range(5):
            archive.writestr(f"{index}.txt", "x")
    oversized_total.write_bytes(
        _patch_central_directory_sizes(
            oversized_total.read_bytes(),
            compressed_size=1 * 1024 * 1024,
            file_size=60 * 1024 * 1024,
        )
    )

    total_result = load_data_file(oversized_total)

    assert isinstance(total_result, pl.DataFrame)
    assert total_result.height == 5
