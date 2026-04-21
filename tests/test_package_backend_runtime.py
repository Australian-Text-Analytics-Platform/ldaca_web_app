from __future__ import annotations

import importlib.util
import shutil
import tomllib
from pathlib import Path
from typing import Any

import pytest


def _load_module() -> Any:
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


def test_stage_backend_source_copies_required_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    module = _load_module()
    repo_root = Path(module.PROJECT_ROOT)

    frontend_archive = (
        repo_root
        / "backend"
        / "src"
        / "ldaca_web_app"
        / "resources"
        / "frontend"
        / "build.tar.gz"
    )
    if not frontend_archive.is_file():
        pytest.skip(
            "frontend build archive is not present; run deploy_frontend_to_backend first"
        )

    dst = tmp_path / "bundle" / "backend-src"
    module.stage_backend_source(dst)

    assert (dst / "pyproject.toml").is_file()
    assert (dst / "uv.lock").is_file()
    assert (dst / "backend" / "pyproject.toml").is_file()
    assert (dst / "backend" / "src" / "ldaca_web_app" / "__init__.py").is_file()
    # The pre-built frontend archive must travel with the source tree.
    assert (
        dst
        / "backend"
        / "src"
        / "ldaca_web_app"
        / "resources"
        / "frontend"
        / "build.tar.gz"
    ).is_file()
    # Exclusions: tests, caches, and the extracted build directory must not ship.
    assert not (dst / "backend" / "tests").exists()


def test_uv_target_triple_matches_host_conventions() -> None:
    module = _load_module()
    triple = module._uv_target_triple()
    # A well-formed triple always has at least two dash-separated segments.
    assert triple.count("-") >= 2


def test_root_workspace_uses_local_backend_source() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    pyproject = tomllib.loads((repo_root / "pyproject.toml").read_text("utf-8"))

    backend_source = pyproject["tool"]["uv"]["sources"]["ldaca-web-app"]
    assert backend_source == {"path": "./backend"}


def test_stage_backend_source_requires_frontend_archive(tmp_path: Path) -> None:
    """Fail loudly when the caller forgot to build the frontend."""

    module = _load_module()
    # Redirect PROJECT_ROOT to a fake layout missing the archive to trigger the error.
    fake_root = tmp_path / "repo"
    (fake_root / "backend" / "src" / "ldaca_web_app" / "resources" / "frontend").mkdir(
        parents=True
    )
    (fake_root / "backend" / "pyproject.toml").write_text("", encoding="utf-8")
    (fake_root / "pyproject.toml").write_text("", encoding="utf-8")
    (fake_root / "uv.lock").write_text("", encoding="utf-8")

    original_root = module.PROJECT_ROOT
    module.PROJECT_ROOT = fake_root
    try:
        with pytest.raises(RuntimeError, match="Frontend archive missing"):
            module.stage_backend_source(tmp_path / "dst")
    finally:
        module.PROJECT_ROOT = original_root
        shutil.rmtree(fake_root, ignore_errors=True)
