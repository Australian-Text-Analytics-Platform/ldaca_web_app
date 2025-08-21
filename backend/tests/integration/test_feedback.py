"""Integration tests for feedback endpoint.

We don't hit real Airtable (env likely unset during tests). Expect graceful success.
"""


class TestFeedbackEndpoint:
    def test_submit_feedback_minimal(self, test_client):
        resp = test_client.post(
            "/api/feedback/submit",
            json={"subject": "Test Subject", "comments": "Some comment"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert (
            "feedback" in data["message"].lower()
            or "submitted" in data["message"].lower()
        )

    def test_submit_feedback_requires_subject(self, test_client):
        resp = test_client.post(
            "/api/feedback/submit", json={"subject": " ", "comments": "x"}
        )
        assert resp.status_code == 400

    def test_submit_feedback_requires_comments(self, test_client):
        resp = test_client.post(
            "/api/feedback/submit", json={"subject": "Hi", "comments": "   "}
        )
        assert resp.status_code == 400
