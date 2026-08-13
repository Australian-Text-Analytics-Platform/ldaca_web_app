"""End-to-end contracts for single-file and bundled Data Block export."""

from __future__ import annotations

import io
import zipfile

import polars as pl
from fastapi.testclient import TestClient


def _create_workspace(client: TestClient) -> str:
    workspace = client.post("/api/workspaces", json={"name": "Export Workspace"})
    assert workspace.status_code == 201
    workspace_id = workspace.json()["id"]
    opened = client.put(f"/api/workspaces/{workspace_id}/open")
    assert opened.status_code == 200
    return workspace_id


def _create_node(
    client: TestClient,
    workspace_id: str,
    *,
    file_path: str,
    name: str,
) -> str:
    uploaded = client.post(
        "/api/user-files/uploads",
        params={"path": file_path},
        content=b"text,count\nhello,1\nworld,2\n",
        headers={"Content-Type": "application/octet-stream"},
    )
    assert uploaded.status_code == 201
    created = client.post(
        f"/api/workspaces/{workspace_id}/nodes",
        json={"kind": "file", "file_path": file_path, "name": name},
    )
    assert created.status_code == 201
    return created.json()["id"]


def _read_export(format_name: str, content: bytes) -> pl.DataFrame:
    source = io.BytesIO(content)
    if format_name == "csv":
        return pl.read_csv(source)
    if format_name == "json":
        return pl.read_json(source)
    if format_name == "ndjson":
        return pl.read_ndjson(source)
    if format_name == "parquet":
        return pl.read_parquet(source)
    return pl.read_ipc(source)


def test_single_data_block_export_returns_the_requested_file_format(
    files_test_client: TestClient,
) -> None:
    workspace_id = _create_workspace(files_test_client)
    node_id = _create_node(
        files_test_client,
        workspace_id,
        file_path="single.csv",
        name="Single data",
    )
    formats = {
        "csv": (".csv", "text/csv"),
        "json": (".json", "application/json"),
        "ndjson": (".ndjson", "application/x-ndjson"),
        "parquet": (".parquet", "application/vnd.apache.parquet"),
        "ipc": (".arrow", "application/vnd.apache.arrow.file"),
    }

    for format_name, (extension, media_type) in formats.items():
        response = files_test_client.post(
            f"/api/workspaces/{workspace_id}/nodes/exports",
            json={"node_ids": [node_id], "format": format_name},
        )

        assert response.status_code == 200, response.text
        assert response.headers["content-type"].startswith(media_type)
        assert extension in response.headers["content-disposition"]
        assert _read_export(format_name, response.content).to_dicts() == [
            {"text": "hello", "count": 1},
            {"text": "world", "count": 2},
        ]


def test_multiple_data_blocks_export_as_one_backend_built_zip(
    files_test_client: TestClient,
) -> None:
    workspace_id = _create_workspace(files_test_client)
    first_id = _create_node(
        files_test_client,
        workspace_id,
        file_path="first.csv",
        name="Same Name",
    )
    second_id = _create_node(
        files_test_client,
        workspace_id,
        file_path="second.csv",
        name="Same Name",
    )

    response = files_test_client.post(
        f"/api/workspaces/{workspace_id}/nodes/exports",
        json={"node_ids": [second_id, first_id], "format": "parquet"},
    )

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    assert "Export_Workspace_data_blocks.zip" in response.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert archive.namelist() == ["Same_Name.parquet", "Same_Name_2.parquet"]
        for name in archive.namelist():
            assert pl.read_parquet(io.BytesIO(archive.read(name))).shape == (2, 2)


def test_data_block_export_rejects_invalid_selection(
    files_test_client: TestClient,
) -> None:
    workspace_id = _create_workspace(files_test_client)
    node_id = _create_node(
        files_test_client,
        workspace_id,
        file_path="valid.csv",
        name="Valid",
    )

    duplicate = files_test_client.post(
        f"/api/workspaces/{workspace_id}/nodes/exports",
        json={"node_ids": [node_id, node_id], "format": "csv"},
    )
    missing = files_test_client.post(
        f"/api/workspaces/{workspace_id}/nodes/exports",
        json={"node_ids": ["00000000-0000-0000-0000-000000000000"], "format": "csv"},
    )

    assert duplicate.status_code == 422
    assert missing.status_code == 404
