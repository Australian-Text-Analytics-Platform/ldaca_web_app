import pytest
from ldaca_web_app_backend.analysis.manager import get_task_manager
from ldaca_web_app_backend.analysis.models import AnalysisStatus, AnalysisTask
from ldaca_web_app_backend.analysis.results import GenericAnalysisResult


@pytest.mark.asyncio
async def test_clear_topic_modeling_results_success(authenticated_client, workspace_id):
    response = await authenticated_client.delete("/api/workspaces/topic-modeling")

    assert response.status_code == 200
    assert response.json() == {
        "state": "successful",
        "message": "Topic modeling analysis results have been cleared.",
    }


@pytest.mark.asyncio
async def test_topic_modeling_result_returns_payload(
    authenticated_client, workspace_id
):
    user_id = "test"
    task_id = "topic-task-1"

    task_manager = get_task_manager(user_id)
    payload = {
        "topics": [
            {
                "id": 0,
                "label": "topic",
                "representative_words": ["alpha", "beta", "gamma"],
                "size": [1],
                "total_size": 1,
                "x": 0.0,
                "y": 0.0,
            }
        ],
        "corpus_sizes": [1],
        "meta": {"native": True},
    }
    task_manager.save_task(
        AnalysisTask(
            task_id=task_id,
            user_id=user_id,
            workspace_id=workspace_id,
            request={"analysis_type": "topic_modeling"},
            status=AnalysisStatus.COMPLETED,
            result=GenericAnalysisResult(payload),
        )
    )

    response = await authenticated_client.get(
        f"/api/workspaces/topic-modeling/tasks/{task_id}/result"
    )

    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "successful"
    assert body["data"]["topics"][0]["label"] == "topic"
    assert body["data"]["topics"][0]["representative_words"] == [
        "alpha",
        "beta",
        "gamma",
    ]
