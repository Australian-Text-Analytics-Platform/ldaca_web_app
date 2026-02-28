"""Unit tests for TaskManager storage and current task mapping."""

from uuid import uuid4

from ldaca_web_app_backend.analysis import manager as analysis_manager
from ldaca_web_app_backend.analysis.manager import TaskManager
from ldaca_web_app_backend.analysis.models import BaseAnalysisRequest


def test_task_manager_roundtrip_and_current_mapping() -> None:
    """TaskManager stores tasks by task_id and manages current ids per tab."""
    user_id = str(uuid4())
    manager = TaskManager(user_id)

    request = BaseAnalysisRequest()
    task_id = manager.create_task(request)

    assert task_id is not None
    assert manager.get_task(task_id) is not None

    manager.set_current_task("concordance", task_id)
    assert manager.get_current_task_ids("concordance") == [task_id]

    manager.clear_task(task_id)
    assert manager.get_task(task_id) is None
    assert manager.get_current_task_ids("concordance") == []


def test_task_manager_helpers_available() -> None:
    """TaskManager helper exports should remain available."""
    assert hasattr(analysis_manager, "TaskManager")
    assert hasattr(analysis_manager, "get_task_manager")
