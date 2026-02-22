from pathlib import Path

import polars as pl
import pytest
from ldaca_web_app_backend.core.utils import get_user_data_folder


@pytest.mark.anyio
async def test_clone_node_creates_suffixes(test_client):
    create_ws = await test_client.post(
        "/api/workspaces/",
        json={"name": "Copy Workspace", "description": ""},
    )
    assert create_ws.status_code == 200
    workspace_id = create_ws.json()["id"]

    user_data_dir = get_user_data_folder("test")
    user_data_dir.mkdir(parents=True, exist_ok=True)
    sample_path = user_data_dir / "sample.csv"
    pl.DataFrame({"a": [1, 2]}).write_csv(sample_path)

    add_node = await test_client.post(
        "/api/workspaces/nodes",
        params={"filename": sample_path.name},
    )
    assert add_node.status_code == 200
    payload = add_node.json()
    node_id = payload.get("id") or payload.get("node_id")
    assert node_id
    original_name = payload.get("name") or "sample"

    clone_one = await test_client.post(f"/api/workspaces/nodes/{node_id}/clone")
    assert clone_one.status_code == 200
    cloned_payload = clone_one.json()
    assert cloned_payload.get("name") == f"{original_name}_clone"

    clone_two = await test_client.post(f"/api/workspaces/nodes/{node_id}/clone")
    assert clone_two.status_code == 200
    cloned_payload_two = clone_two.json()
    assert cloned_payload_two.get("name") == f"{original_name}_clone_2"
