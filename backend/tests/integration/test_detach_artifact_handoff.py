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
async def test_detach_task_restores_node_payload_into_workspace_before_persist(
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

    expected_df = pl.DataFrame({
        "text": ["alpha beta"],
        "CONC_matched_text": ["alpha"],
    })
    detached_node = Node(
        data=expected_df.lazy(),
        name="source_node_concordance",
        workspace=None,
        operation="concordance_detach",
        parents=[parent_node.id],
        document="text",
    )
    workspace_dir = workspace_manager.get_workspace_dir(user_id, workspace_id)
    assert workspace_dir is not None
    node_payload = detached_node.to_dict(base_dir=workspace_dir)

    assert detached_node.workspace is None
    assert detached_node.parents == [parent_node.id]
    assert (workspace_dir / node_payload["data_path"]).exists()

    future = Future()
    future.set_result({
        "state": "successful",
        "result": {
            "node_payload": node_payload,
        },
    })
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

    current_workspace = workspace_manager.get_current_workspace(user_id)
    assert current_workspace is not None
    detached_node = current_workspace.get_node_by_name("source_node_concordance")
    assert detached_node is not None
    assert detached_node.document == "text"
    assert detached_node.data.collect().equals(expected_df)

    with (workspace_dir / "metadata.json").open("r", encoding="utf-8") as fh:
        persisted = __import__("json").load(fh)
    detached_entry = next(
        entry
        for entry in persisted["nodes"]
        if entry["node_metadata"]["id"] == detached_node.id
    )
    assert detached_entry["data_path"] == f"data/{detached_node.id}.plbin"
    persisted_file = workspace_dir / detached_entry["data_path"]
    assert persisted_file.exists()
    restored = pl.LazyFrame.deserialize(persisted_file.open("rb"), format="binary")
    assert restored.collect().equals(expected_df)

    assert workspace_manager.unload_workspace(user_id, workspace_id, save=True) is True

    assert workspace_manager.set_current_workspace(user_id, workspace_id) is True
    reloaded_workspace = workspace_manager.get_current_workspace(user_id)
    assert reloaded_workspace is not None
    reloaded_detached_node = reloaded_workspace.get_node_by_name(
        "source_node_concordance"
    )
    assert reloaded_detached_node is not None
    assert reloaded_detached_node.document == "text"
    assert reloaded_detached_node.data.collect().equals(expected_df)
