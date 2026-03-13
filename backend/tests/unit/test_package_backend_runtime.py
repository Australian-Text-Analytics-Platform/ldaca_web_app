from __future__ import annotations

import importlib.util
from pathlib import Path


def _load_package_backend_runtime_module():
    repo_root = Path(__file__).resolve().parents[3]
    module_path = repo_root / "backend" / "scripts" / "package_backend_runtime.py"
    spec = importlib.util.spec_from_file_location(
        "package_backend_runtime", module_path
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_get_workspace_packages_discovers_root_level_python_members() -> None:
    module = _load_package_backend_runtime_module()
    repo_root = Path(__file__).resolve().parents[3]

    packages = module.get_workspace_packages(repo_root)
    package_map = {name: path.resolve() for name, path in packages}

    assert package_map["docworkspace"] == (repo_root / "docworkspace").resolve()
    assert package_map["ldaca-loader"] == (repo_root / "ldaca-tabulator").resolve()
    assert package_map["polars-text"] == (repo_root / "polars-text").resolve()
