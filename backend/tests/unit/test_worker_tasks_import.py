import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

from ldaca_web_app_backend.core import worker_tasks_import


def test_run_ldaca_import_task_uses_data_root_cache_and_restores_cwd(
    tmp_path,
    monkeypatch,
):
    user_data_dir = tmp_path / "users"
    cache_dir = tmp_path / "ldaca_cache"
    original_cwd = Path.cwd()
    observed_cwds: list[Path] = []

    class FakeDataFrame:
        def to_parquet(self, path: str) -> None:
            Path(path).write_bytes(b"parquet")

    class FakeTabulator:
        def __init__(self, url: str) -> None:
            assert url == "https://example.org/dataset.zip"
            observed_cwds.append(Path.cwd())

        def get_name(self) -> str:
            observed_cwds.append(Path.cwd())
            return "Corpus Name"

        def get_corpus_info(self) -> str:
            observed_cwds.append(Path.cwd())
            return "# Corpus info"

        def get_text(self) -> FakeDataFrame:
            observed_cwds.append(Path.cwd())
            return FakeDataFrame()

    fake_package = ModuleType("ldacatabulator")
    fake_tabulator_module = ModuleType("ldacatabulator.tabulator")
    fake_tabulator_module.LDaCATabulator = FakeTabulator

    monkeypatch.setitem(sys.modules, "ldacatabulator", fake_package)
    monkeypatch.setitem(sys.modules, "ldacatabulator.tabulator", fake_tabulator_module)
    monkeypatch.setattr(
        worker_tasks_import,
        "settings",
        SimpleNamespace(get_data_root=lambda: tmp_path),
        raising=False,
    )
    monkeypatch.setattr(
        "ldaca_web_app_backend.core.utils.get_user_data_folder",
        lambda _user_id: user_data_dir,
    )

    result = worker_tasks_import.run_ldaca_import_task(
        configure_worker_environment=lambda: None,
        user_id="test-user",
        workspace_id="test-workspace",
        url="https://example.org/dataset.zip",
    )

    assert observed_cwds == [cache_dir, cache_dir, cache_dir, cache_dir]
    assert cache_dir.is_dir()
    assert Path.cwd() == original_cwd
    assert result["message"] == "Successfully imported Corpus Name"
    assert (user_data_dir / "LDaCA" / "Corpus_Name" / "Corpus_Name.parquet").exists()
