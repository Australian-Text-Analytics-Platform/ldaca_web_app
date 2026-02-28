import os
from datetime import datetime
from pathlib import Path

import polars as pl
from docworkspace import Workspace
from ldaca_web_app_backend.api.workspaces.utils import stage_dataframe_as_lazy
from ldaca_web_app_backend.core import utils as core_utils
from ldaca_web_app_backend.core.utils import generate_workspace_id
from ldaca_web_app_backend.core.workspace import WorkspaceManager


def test_stage_dataframe_as_lazy_scans_relative_path(tmp_path, monkeypatch):
    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir(parents=True, exist_ok=True)

    data = pl.DataFrame({"a": [1, 2]})
    captured = {}

    def fake_scan_parquet(path):
        captured["path"] = Path(path)
        captured["cwd"] = Path.cwd()
        return data.lazy()

    monkeypatch.setattr(pl, "scan_parquet", fake_scan_parquet)

    lazy = stage_dataframe_as_lazy(data, workspace_dir, node_name="demo")

    expected = Path("data") / "demo.parquet"
    assert captured["path"] == expected
    assert captured["cwd"] == workspace_dir
    assert hasattr(lazy, "collect")
    assert (workspace_dir / expected).exists()


def test_workspace_manager_sets_cwd_on_create(tmp_path, monkeypatch):
    original_cwd = Path.cwd()
    try:
        monkeypatch.setattr(core_utils.settings, "multi_user", True, raising=False)
        monkeypatch.setattr(
            core_utils.settings, "user_data_folder", "users", raising=False
        )
        monkeypatch.setattr(core_utils.settings, "data_root", tmp_path, raising=False)

        manager = WorkspaceManager()
        ws = Workspace(name="Workspace")
        ws.id = generate_workspace_id()
        ws.modified_at = datetime.now().isoformat()
        target_dir = manager._resolve_workspace_dir(
            user_id="test",
            workspace_id=ws.id,
            workspace_name=ws.name,
        )
        manager._attach_workspace_dir(ws, target_dir)
        ws.save(target_dir)
        manager._set_cached_path("test", ws.id, target_dir)
        manager.set_current_workspace("test", ws.id)
        workspace_dir = manager.get_workspace_dir("test", ws.id)
        assert workspace_dir is not None
        assert Path.cwd() == workspace_dir
    finally:
        os.chdir(original_cwd)
