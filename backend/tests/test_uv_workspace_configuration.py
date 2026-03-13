from __future__ import annotations

import tomllib
from pathlib import Path


def _load_toml(path: Path) -> dict:
    with path.open("rb") as fh:
        return tomllib.load(fh)


def test_python_uv_workspace_is_rooted_in_repository_directory() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    root_config = _load_toml(repo_root / "pyproject.toml")
    backend_config = _load_toml(repo_root / "backend" / "pyproject.toml")

    root_workspace = root_config["tool"]["uv"]["workspace"]

    assert root_workspace["members"] == [
        "backend",
        "docworkspace",
        "ldaca-tabulator",
        "polars-text",
    ]
    assert "workspace" not in backend_config.get("tool", {}).get("uv", {})


def test_backend_workspace_declares_local_python_member_sources() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    backend_config = _load_toml(repo_root / "backend" / "pyproject.toml")
    backend_sources = backend_config["tool"]["uv"]["sources"]

    assert backend_sources["docworkspace"] == {"workspace": True}
    assert backend_sources["ldaca-loader"] == {"workspace": True}
    assert backend_sources["polars-text"] == {"workspace": True}
