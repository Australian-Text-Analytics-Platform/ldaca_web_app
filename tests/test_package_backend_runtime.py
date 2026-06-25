from __future__ import annotations

import importlib.util
import tomllib
from pathlib import Path

import pytest


def _load_package_backend_runtime_module():
    repo_root = Path(__file__).resolve().parents[1]
    module_path = repo_root / "scripts" / "package_backend_runtime.py"
    spec = importlib.util.spec_from_file_location(
        "package_backend_runtime", module_path
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_create_uv_managed_python_env_sets_runtime_install_dir() -> None:
    module = _load_package_backend_runtime_module()
    managed_install_dir = Path("/tmp/runtime/managed-python")

    env = module.create_uv_managed_python_env(managed_install_dir)

    assert env == {"UV_PYTHON_INSTALL_DIR": str(managed_install_dir)}


def test_sync_runtime_environment_uses_frozen_packaged_sync(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = _load_package_backend_runtime_module()
    calls: list[tuple[list[str], Path | None, dict[str, str] | None]] = []

    def fake_run(cmd, *, cwd=None, capture_output=False, extra_env=None):
        assert capture_output is False
        calls.append((cmd, cwd, extra_env))
        return None

    monkeypatch.setattr(module, "run", fake_run)

    runtime_python_dir = Path("/tmp/runtime")
    managed_python_dir = Path("/tmp/runtime/managed-python")

    module.sync_runtime_environment(
        runtime_python_dir=runtime_python_dir,
        managed_python_dir=managed_python_dir,
    )

    assert calls == [
        (
            [
                "uv",
                "sync",
                "--frozen",
                "--no-dev",
                "--no-editable",
                "--link-mode",
                "copy",
                "--managed-python",
            ],
            module.BACKEND_PROJECT_ROOT,
            {
                "UV_PYTHON_INSTALL_DIR": str(managed_python_dir),
                "UV_PROJECT_ENVIRONMENT": str(runtime_python_dir),
            },
        )
    ]


def test_backend_runtime_lets_uv_venv_manage_python_install() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    script = (repo_root / "scripts" / "package_backend_runtime.py").read_text(
        "utf-8"
    )

    assert '"python", "install"' not in script
    assert '"--managed-python"' in script
    assert '"--clear"' in script
    assert "UV_PYTHON_PREFER_MANAGED" not in script
    assert "UV_PYTHON_DOWNLOADS" not in script
    assert "UV_VENV_CLEAR" not in script
    assert "VIRTUAL_ENV" not in script


def test_frontend_desktop_dev_uses_packaged_runtime_path() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    package_json = __import__("json").loads(
        (repo_root / "frontend" / "package.json").read_text("utf-8")
    )
    scripts = package_json["scripts"]

    assert "--clean" in scripts["package:backend-runtime"]
    assert "package:backend-runtime:dev" not in scripts
    assert "prepare:backend-runtime:dev" not in scripts
    assert scripts["desktop:dev"].startswith("pnpm prepare:backend-runtime")


def test_root_workspace_uses_local_backend_source() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    pyproject = tomllib.loads((repo_root / "pyproject.toml").read_text("utf-8"))

    backend_source = pyproject["tool"]["uv"]["sources"]["ldaca-wordflow"]

    assert backend_source == {"path": "./backend", "editable": True}
