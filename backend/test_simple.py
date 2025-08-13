"""Simple test to verify the fix without pytest complexity"""


def test_simple_auth(test_client):
    """Simple function-based test"""
    response = test_client.get("/api/auth/")
    assert response.status_code == 200
    data = response.json()
    assert data["user"]["id"] == "test"
    print("✅ Simple test passed!")
