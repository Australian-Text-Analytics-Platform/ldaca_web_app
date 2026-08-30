"""Tests for the Arrow IPC file-preview endpoints."""

from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile
import json

import polars as pl


def _preview_schema(client, path: str) -> pl.Schema:
    response = client.get(
        "/api/user-files/preview/schema",
        params={"path": path},
    )
    assert response.status_code == 200, response.text
    return pl.read_ipc_stream(BytesIO(response.content)).schema


def _write_stub_xlsx(path: Path) -> None:
    """Write a structurally valid ZIP container for mocked Excel-reader tests."""

    with ZipFile(path, "w") as archive:
        archive.writestr(
            "xl/workbook.xml",
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>',
        )


def test_csv_preview_supported_types_and_preview(files_test_client, tmp_path):
    """Test CSV file preview with pagination"""
    # Arrange: create CSV in user data
    user_root = tmp_path / "users" / "root" / "files"
    csv_path = user_root / "sample.csv"
    pl.DataFrame({"a": [1, 2, 3], "b": ["x", "y", "z"]}).write_csv(csv_path)

    # Act
    resp = files_test_client.get(
        "/api/user-files/preview",
        params={"path": "sample.csv", "page": 1, "page_size": 2},
    )

    # Assert
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith(
        "application/vnd.apache.arrow.stream"
    )
    assert resp.headers["x-wordflow-has-next"] == "true"
    frame = pl.read_ipc_stream(BytesIO(resp.content))
    assert frame.to_dict(as_series=False) == {"a": ["1", "2"], "b": ["x", "y"]}


def test_delimited_preview_pages_and_schema_preserve_raw_text(
    files_test_client,
    tmp_path,
) -> None:
    """Early and deep CSV/TSV pages follow the raw-value preview policy."""
    user_root = tmp_path / "users" / "root" / "files"
    rows = [(f"{value:03d}", str(value)) for value in range(102)]
    for extension, separator in (("csv", ","), ("tsv", "\t")):
        path = user_root / f"raw.{extension}"
        path.write_text(
            f"identifier{separator}value\n"
            + "".join(f"{identifier}{separator}{value}\n" for identifier, value in rows),
            encoding="utf-8",
        )

        early = files_test_client.get(
            "/api/user-files/preview",
            params={"path": path.name, "page": 1, "page_size": 10},
        )
        deep = files_test_client.get(
            "/api/user-files/preview",
            params={"path": path.name, "page": 11, "page_size": 10},
        )

        assert early.status_code == 200, early.text
        assert deep.status_code == 200, deep.text
        assert pl.read_ipc_stream(BytesIO(early.content)).to_dicts()[0] == {
            "identifier": "000",
            "value": "0",
        }
        assert pl.read_ipc_stream(BytesIO(deep.content)).to_dicts() == [
            {"identifier": "100", "value": "100"},
            {"identifier": "101", "value": "101"},
        ]
        assert _preview_schema(files_test_client, path.name) == pl.Schema(
            {"identifier": pl.String, "value": pl.String}
        )


def test_json_family_preview_pages_and_schema_use_full_inference(
    files_test_client,
    tmp_path,
) -> None:
    user_root = tmp_path / "users" / "root" / "files"
    rows = [{"value": value} for value in range(101)] + [{"value": "late text"}]
    for extension in ("json", "jsonl", "ndjson"):
        path = user_root / f"mixed.{extension}"
        if extension == "json":
            path.write_text(json.dumps(rows), encoding="utf-8")
        else:
            path.write_text(
                "\n".join(json.dumps(row) for row in rows) + "\n",
                encoding="utf-8",
            )

        response = files_test_client.get(
            "/api/user-files/preview",
            params={"path": path.name, "page": 1, "page_size": 200},
        )

        assert response.status_code == 200, response.text
        frame = pl.read_ipc_stream(BytesIO(response.content))
        assert frame.schema == {"value": pl.String}
        assert frame["value"].tail(1).item() == "late text"
        assert _preview_schema(files_test_client, path.name) == frame.schema


def test_preview_parser_failures_return_safe_invalid_input(
    files_test_client,
    tmp_path,
) -> None:
    user_root = tmp_path / "users" / "root" / "files"
    malformed = {
        "invalid.csv": b"value\nvalid\n\xff\n",
        "invalid.json": b'[{"value": 1},',
        "invalid.jsonl": b'{"value": 1}\n{"value":\n',
        "invalid.ndjson": b'{"value": 1}\n{"value":\n',
    }
    for filename, content in malformed.items():
        (user_root / filename).write_bytes(content)

        page = files_test_client.get(
            "/api/user-files/preview",
            params={"path": filename, "page": 1, "page_size": 10},
        )
        schema = files_test_client.get(
            "/api/user-files/preview/schema",
            params={"path": filename},
        )

        assert page.status_code == 400, page.text
        assert page.json()["code"] == "invalid_input"
        assert page.json()["message"] == "File preview could not be generated"
        if filename.endswith((".json", ".jsonl", ".ndjson")):
            assert schema.status_code == 400, schema.text
            assert schema.json()["code"] == "invalid_input"


def test_zip_preview_uses_the_canonical_document_table(files_test_client, tmp_path):
    """ZIP previews expose the same rows that Source Data Block ingestion uses."""

    user_root = tmp_path / "users" / "root" / "files"
    zip_path = user_root / "archive.zip"
    from zipfile import ZipFile

    with ZipFile(zip_path, "w") as zf:
        zf.writestr("a.txt", "hello")
        zf.writestr("b.txt", "world")

    resp = files_test_client.get(
        "/api/user-files/preview",
        params={"path": "archive.zip", "page": 1, "page_size": 10},
    )

    assert resp.status_code == 200
    frame = pl.read_ipc_stream(BytesIO(resp.content))
    assert frame.to_dicts() == [
        {
            "file_path": "a.txt",
            "base_name": "a",
            "extension": ".txt",
            "document": "hello",
        },
        {
            "file_path": "b.txt",
            "base_name": "b",
            "extension": ".txt",
            "document": "world",
        },
    ]


def test_text_preview_returns_single_cell(files_test_client, tmp_path):
    """Plain text files should produce a 1x1 preview table."""

    user_root = tmp_path / "users" / "root" / "files"
    text_path = user_root / "example.txt"
    text_path.write_text("Plain text document.", encoding="utf-8")

    resp = files_test_client.get(
        "/api/user-files/preview",
        params={"path": "example.txt", "page": 1, "page_size": 5},
    )

    assert resp.status_code == 200
    frame = pl.read_ipc_stream(BytesIO(resp.content))
    assert frame.to_dicts() == [{"text": "Plain text document."}]
    assert resp.headers["x-wordflow-has-next"] == "false"


def test_excel_preview_returns_sheet_names_for_selector(files_test_client, tmp_path):
    """Excel preview should expose sheet names so Add File can offer a selector."""

    user_root = tmp_path / "users" / "root" / "files"
    excel_path = user_root / "with_sheet_names.xlsx"
    _write_stub_xlsx(excel_path)

    base_df = pl.DataFrame({"col_a": [1, 2], "col_b": ["x", "y"]})

    def fake_read_excel(file_path, sheet_id=None, sheet_name=None):
        if sheet_name is not None:
            return base_df
        if sheet_id == 0:
            return base_df
        if sheet_id is None:
            return base_df
        raise AssertionError("Unexpected read_excel call signature")

    class FakeReader:
        sheet_names = ["Sheet1", "Sheet2"]

    class FakeFastExcel:
        @staticmethod
        def read_excel(_source):
            return FakeReader()

    with (
        patch("ldaca_wordflow.services.file_preview.fastexcel", FakeFastExcel),
        patch(
            "ldaca_wordflow.services.file_preview.pl.read_excel",
            side_effect=fake_read_excel,
        ),
    ):
        sheets_response = files_test_client.get(
            "/api/user-files/worksheets",
            params={"path": "with_sheet_names.xlsx"},
        )
        resp = files_test_client.get(
            "/api/user-files/preview",
            params={"path": "with_sheet_names.xlsx", "page": 1, "page_size": 1},
        )

    assert sheets_response.status_code == 200
    assert sheets_response.json() == {
        "sheets": ["Sheet1", "Sheet2"],
        "default_sheet": "Sheet1",
    }
    assert resp.status_code == 200
    frame = pl.read_ipc_stream(BytesIO(resp.content))
    assert frame.to_dict(as_series=False) == {"col_a": [1], "col_b": ["x"]}
