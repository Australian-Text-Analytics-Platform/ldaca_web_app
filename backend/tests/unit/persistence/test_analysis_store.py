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


class TestInMemoryPersistence:
    """Verify analyses are session-only and excluded from serialization."""

    def test_analyses_do_not_survive_workspace_reload(self, tmp_path, mock_datetime):
        from unittest.mock import patch

        from ldaca_web_app_backend.core.analysis_store import (
            list_analyses,
            save_analysis,
        )
        from ldaca_web_app_backend.core.workspace import workspace_manager

        user_id = "meta_user"
        with patch(
            "ldaca_web_app_backend.core.workspace.get_user_workspace_folder",
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
                {"token_limit": 5},
                {"state": "successful", "data": []},
            )
            pre_reload = list_analyses(user_id, wid)
            assert [r.task for r in pre_reload] == ["token_frequencies"]

            workspace_manager.unload_workspace(user_id, save=True)
            reloaded = workspace_manager.get_workspace(user_id, wid)
            assert reloaded is not None
            post_reload = list_analyses(user_id, wid)
            assert post_reload == []

    def test_serialized_workspace_omits_analysis_state(self, tmp_path, mock_datetime):
        from unittest.mock import patch

        from ldaca_web_app_backend.core.analysis_store import save_analysis
        from ldaca_web_app_backend.core.workspace import workspace_manager

        user_id = "ser_user"
        with patch(
            "ldaca_web_app_backend.core.workspace.get_user_workspace_folder",
            return_value=tmp_path / user_id / "user_workspaces",
        ):
            ws = workspace_manager.create_workspace(
                user_id, name="Serialize Test", description="Desc"
            )
            wid = ws.get_metadata("id")
            save_analysis(
                user_id,
                wid,
                "token_frequencies",
                {"token_limit": 5},
                {"state": "successful", "data": []},
            )
            workspace_manager.unload_workspace(user_id, save=True)
            workspace_manager.get_workspace(user_id, wid)
            workspace_file = (
                tmp_path / user_id / "user_workspaces" / f"workspace_{wid}.json"
            )
            assert workspace_file.exists()
            content = workspace_file.read_text()
            assert "token_frequencies" not in content
