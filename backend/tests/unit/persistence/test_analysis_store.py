"""
Unit tests for analysis_store module.

Tests the core persistence logic without FastAPI dependencies.
"""

from ldaca_web_app_backend.core.analysis_store import AnalysisRecord


class TestAnalysisRecord:
    """Test AnalysisRecord dataclass functionality."""

    def test_to_dict(self):
        """Test AnalysisRecord serialization."""
        record = AnalysisRecord(
            task="test_task",
            saved_at="2024-01-15T12:30:45",
            request={"param": "value"},
            result={"state": "successful", "data": []},
        )

        expected = {
            "task": "test_task",
            "saved_at": "2024-01-15T12:30:45",
            "request": {"param": "value"},
            "result": {"state": "successful", "data": []},
        }

        assert record.to_dict() == expected


class TestSerializationPersistence:
    """Verify analyses stored in metadata persist through serialize/deserialize."""

    def test_analyses_survive_workspace_reload(self, tmp_path, mock_datetime):
        from unittest.mock import patch

        from ldaca_web_app_backend.core.analysis_store import (
            list_analyses,
            save_analysis,
        )
        from ldaca_web_app_backend.core.workspace import workspace_manager

        user_id = "meta_user"
        with patch(
            "ldaca_web_app_backend.core.utils.get_user_workspace_folder",
            return_value=tmp_path / user_id / "user_workspaces",
        ):
            ws = workspace_manager.create_workspace(
                user_id, name="Meta Test", description="Desc"
            )
            wid = ws.get_metadata("id")
            save_analysis(
                user_id,
                wid,
                "token_frequencies",
                {"limit": 5},
                {"state": "successful", "data": []},
            )
            save_analysis(
                user_id,
                wid,
                "topic_modeling",
                {"k": 10},
                {"state": "successful", "topics": []},
            )
            pre_reload = list_analyses(user_id, wid)
            assert {r.task for r in pre_reload} == {
                "token_frequencies",
                "topic_modeling",
            }
            workspace_manager.unload_workspace(user_id, save=True)
            reloaded = workspace_manager.get_workspace(user_id, wid)
            assert reloaded is not None
            post_reload = list_analyses(user_id, wid)
            assert len(post_reload) == 2
            assert {r.task for r in post_reload} == {
                "token_frequencies",
                "topic_modeling",
            }
            assert post_reload[0].saved_at <= post_reload[-1].saved_at
