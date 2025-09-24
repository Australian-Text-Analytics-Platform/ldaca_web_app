import pytest
from fastapi.testclient import TestClient
from ldaca_web_app_backend.main import app


@pytest.fixture
def client():
    return TestClient(app)


def auth_headers():
    # Test utilities in repo may provide an auth bypass header; mimic existing tests pattern.
    return {"x-user-id": "test-user"}


def create_workspace(client):
    resp = client.post("/workspaces", headers=auth_headers(), json={"name": "ws1"})
    assert resp.status_code == 200
    wid = resp.json()["data"]["workspace_id"]
    return wid


def add_node(client, wid, name, documents):
    # Create a docframe-like node by uploading a simple list of documents
    resp = client.post(
        f"/workspaces/{wid}/nodes/create/text-list",
        headers=auth_headers(),
        json={"name": name, "documents": documents},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]["node_id"]


def test_token_frequencies_truncation_and_metadata(client):
    wid = create_workspace(client)

    # Build two corpora with many repeated tokens to inflate vocab
    docs_a = ["token" + str(i) for i in range(0, 600)]  # 600 unique tokens
    docs_b = ["token" + str(i) for i in range(300, 900)]  # 600 unique, 300 overlap

    node_a = add_node(client, wid, "A", docs_a)
    node_b = add_node(client, wid, "B", docs_b)

    # Request with small UI limit to test server expansion logic (limit * 5)
    payload = {
        "node_ids": [node_a, node_b],
        "node_columns": {},
        "stop_words": ["the", "and"],  # Should be ignored server side
        "limit": 10,
    }
    resp = client.post(
        f"/workspaces/{wid}/token-frequencies", headers=auth_headers(), json=payload
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["state"] == "successful"
    assert "data" in data
    # Expect truncation: server_cap = min(10 * 5, 5000) = 50
    for node_name, node_result in data["data"].items():
        meta = node_result.get("metadata")
        assert meta is not None, "metadata missing for node result"
        assert meta["applied_server_limit"] == 50
        assert meta["total_tokens_before_limit"] >= 50
        assert len(node_result["data"]) <= 50
        # Should have truncated because vocab > 50
        assert meta["truncated"] is True

    # Ensure statistics present (since 2 nodes) and not empty
    stats = data.get("statistics")
    assert stats is not None and len(stats) > 0

    # Ensure stop words were NOT removed (we purposely used tokens that are not stop words; check presence of a sample token)
    sample_token = data["data"][list(data["data"].keys())[0]]["data"][0]["token"]
    assert sample_token.startswith("token")
