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


def test_sync_runtime_environment_uses_frozen_non_editable_sync(
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
    env = {"UV_LINK_MODE": "copy"}

    module.sync_runtime_environment(
        runtime_python_dir=runtime_python_dir,
        uv_packaging_env=env,
    )

    assert calls == [
        (
            [
                "uv",
                "sync",
                "--frozen",
                "--no-dev",
                "--no-editable",
            ],
            module.BACKEND_PROJECT_ROOT,
            {
                "UV_LINK_MODE": "copy",
                "UV_PROJECT_ENVIRONMENT": str(runtime_python_dir),
                "VIRTUAL_ENV": str(runtime_python_dir),
            },
        )
    ]


def test_root_workspace_uses_local_backend_source() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    pyproject = tomllib.loads((repo_root / "pyproject.toml").read_text("utf-8"))

    backend_source = pyproject["tool"]["uv"]["sources"]["ldaca-wordflow"]

    assert backend_source == {"path": "./backend", "editable": True}
