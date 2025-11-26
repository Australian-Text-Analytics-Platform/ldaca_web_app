import csv

import pytest
from ldaca_web_app_backend.api.workspaces.analyses.token_frequencies import (
    DEFAULT_TOKEN_LIMIT,
    MAX_SERVER_TOKEN_LIMIT,
    SERVER_LIMIT_MULTIPLIER,
)
from ldaca_web_app_backend.core.utils import get_user_data_folder


def _write_token_csv(folder, filename, start, end):
    file_path = folder / filename
    with open(file_path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["document"])
        for i in range(start, end):
            writer.writerow([f"token{i}"])
    return file_path


@pytest.mark.anyio
async def test_token_frequencies_full_table_and_metadata(
    authenticated_client,
    workspace_id,
    test_user,
):
    user_folder = get_user_data_folder(test_user["id"])
    user_folder.mkdir(parents=True, exist_ok=True)

    file_a = _write_token_csv(user_folder, "node_a.csv", 0, 600)
    file_b = _write_token_csv(user_folder, "node_b.csv", 300, 900)

    node_ids: list[str] = []
    for csv_file in (file_a, file_b):
        resp = await authenticated_client.post(
            f"/api/workspaces/{workspace_id}/nodes",
            params={"filename": csv_file.name},
        )
        assert resp.status_code == 200, resp.text
        node_ids.append(resp.json()["id"])

    payload = {
        "node_ids": node_ids,
        "node_columns": {node_ids[0]: "document", node_ids[1]: "document"},
        "stop_words": ["the", "and"],
    }

    response = await authenticated_client.post(
        f"/api/workspaces/{workspace_id}/token-frequencies",
        json=payload,
    )
    assert response.status_code == 200, response.text
    data = response.json()

    assert data["state"] == "successful"
    assert data.get("token_limit") == DEFAULT_TOKEN_LIMIT
    assert data.get("analysis_params", {}).get("token_limit") == DEFAULT_TOKEN_LIMIT
    expected_server_limit = min(
        max(DEFAULT_TOKEN_LIMIT * SERVER_LIMIT_MULTIPLIER, DEFAULT_TOKEN_LIMIT),
        MAX_SERVER_TOKEN_LIMIT,
    )
    assert data.get("analysis_params", {}).get("server_limit") == expected_server_limit
    assert data.get("stop_words") == ["the", "and"]
    assert data.get("metadata", {}).get("stop_words") == ["the", "and"]
    assert data.get("metadata", {}).get("server_limit") == expected_server_limit
    assert data.get("metadata", {}).get("token_limit") == DEFAULT_TOKEN_LIMIT

    assert "data" in data and isinstance(data["data"], dict)
    for node_id, node_result in data["data"].items():
        meta = node_result.get("metadata")
        assert meta is not None, f"metadata missing for node result {node_id}"
        assert meta["applied_server_limit"] is None
        assert meta["token_limit"] == DEFAULT_TOKEN_LIMIT
        assert meta["total_tokens_before_limit"] >= expected_server_limit
        assert meta.get("total_tokens_returned") == meta["total_tokens_before_limit"]
        assert meta["truncated"] is False
        assert meta["node_id"] == node_id
        assert meta.get("display_name")
        assert len(node_result.get("data", [])) == meta["total_tokens_before_limit"]

    stats = data.get("statistics")
    assert stats is not None and len(stats) > 0

    node_display_names = data.get("metadata", {}).get("node_display_names")
    assert isinstance(node_display_names, dict)
    for original_id in node_ids:
        assert original_id in node_display_names

    first_node_result = next(iter(data["data"].values()))
    sample_token = first_node_result["data"][0]["token"]
    assert sample_token.startswith("token")
