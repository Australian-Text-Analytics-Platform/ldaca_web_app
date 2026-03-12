from concurrent.futures import Future
from unittest.mock import AsyncMock

import polars as pl
import pytest
from docworkspace import Node

from ldaca_web_app_backend.core.worker_task_manager import (
    TaskInfo,
    TaskStatus,
    WorkerTaskManager,
)
from ldaca_web_app_backend.core.workspace import workspace_manager


@pytest.mark.asyncio
async def test_detach_task_copies_artifact_into_workspace_data_before_persist(
    authenticated_client, workspace_id
):
    user_id = "test"
    workspace = workspace_manager.get_current_workspace(user_id)
    assert workspace is not None

    parent_node = Node(
        data=pl.DataFrame({"text": ["alpha beta", "beta gamma"]}).lazy(),
        name="source_node",
        workspace=workspace,
        operation="test_add",
    )
    parent_node.document = "text"

    artifact_dir = workspace_manager.ensure_workspace_artifacts_dir(user_id, workspace_id)
    assert artifact_dir is not None
    artifact_path = artifact_dir / "concordance_detach_test.parquet"
    expected_df = pl.DataFrame(
        {
            "text": ["alpha beta"],
            "CONC_matched_text": ["alpha"],
        }
    )
    expected_df.write_parquet(artifact_path)

    future = Future()
    future.set_result(
        {
            "state": "successful",
            "result": {
                "parquet_path": str(artifact_path),
                "new_node_name": "source_node_concordance",
                "parent_node_id": parent_node.id,
                "document_column": "text",
            },
        }
    )
    task_info = TaskInfo(
        id="task-detach-handoff",
        future=future,
        task_type="concordance_detach",
        user_id=user_id,
        workspace_id=workspace_id,
    )

    manager = WorkerTaskManager()
    manager.emit = AsyncMock()

    await manager._monitor_task_completion(task_info, user_id, workspace_id)

    assert task_info.status == TaskStatus.SUCCESSFUL
    assert not artifact_path.exists()

    workspace_dir = workspace_manager.get_workspace_dir(user_id, workspace_id)
    assert workspace_dir is not None
    persisted_parquet_files = sorted((workspace_dir / "data").glob("*.parquet"))
    assert persisted_parquet_files
    assert all(path.parent == workspace_dir / "data" for path in persisted_parquet_files)

    current_workspace = workspace_manager.get_current_workspace(user_id)
    assert current_workspace is not None
    detached_node = current_workspace.get_node_by_name("source_node_concordance")
    assert detached_node is not None
    assert detached_node.document == "text"
    assert detached_node.data.collect().equals(expected_df)

    assert workspace_manager.unload_workspace(user_id, workspace_id, save=True) is True
    assert not artifact_dir.exists()

    assert workspace_manager.set_current_workspace(user_id, workspace_id) is True
    reloaded_workspace = workspace_manager.get_current_workspace(user_id)
    assert reloaded_workspace is not None
    reloaded_detached_node = reloaded_workspace.get_node_by_name("source_node_concordance")
    assert reloaded_detached_node is not None
    assert reloaded_detached_node.document == "text"
    assert reloaded_detached_node.data.collect().equals(expected_df)
