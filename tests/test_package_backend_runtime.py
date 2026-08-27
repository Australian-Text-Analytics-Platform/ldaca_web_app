from __future__ import annotations

import importlib.util
import json
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


def test_sync_runtime_environment_uses_locked_source_aware_sync(
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
    cargo_target_dir = Path("/tmp/cargo-target")

    module.sync_runtime_environment(
        runtime_python_dir=runtime_python_dir,
        managed_python_dir=managed_python_dir,
        cargo_target_dir=cargo_target_dir,
    )

    assert calls == [
        (
            [
                "uv",
                "sync",
                "--locked",
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
                "CARGO_TARGET_DIR": str(cargo_target_dir),
            },
        )
    ]
    assert "--no-sources" not in calls[0][0]


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


def test_packaged_runtime_removes_macos_metadata_files(tmp_path: Path) -> None:
    module = _load_package_backend_runtime_module()
    runtime_root = tmp_path / "runtime"
    nested = runtime_root / "python" / "site-packages" / "package"
    nested.mkdir(parents=True)
    (nested / "content.js").write_text("content", encoding="utf-8")
    (nested / "._content.js").write_bytes(b"metadata")
    (runtime_root / ".DS_Store").write_bytes(b"metadata")

    removed = module.remove_macos_metadata_files(runtime_root)

    assert removed == 2
    assert (nested / "content.js").read_text(encoding="utf-8") == "content"
    assert not (nested / "._content.js").exists()
    assert not (runtime_root / ".DS_Store").exists()


def test_runtime_manifest_owns_a_relative_relocatable_layout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    module = _load_package_backend_runtime_module()
    runtime_root = tmp_path / "build" / "backend-runtime"
    python_home = runtime_root / "managed-python" / "cpython-3.14-test"
    python_bin = python_home / "bin" / "python3"
    site_packages = runtime_root / "python" / "lib" / "python3.14" / "site-packages"
    (python_home / "lib" / "python3.14" / "encodings").mkdir(parents=True)
    python_bin.parent.mkdir(parents=True, exist_ok=True)
    python_bin.touch()
    site_packages.mkdir(parents=True)

    class InterpreterResult:
        stdout = json.dumps(
            {
                "version": "3.14.0",
                "free_threaded": False,
                "platform": __import__("sys").platform,
                "machine": __import__("platform").machine().lower(),
            }
        )

    monkeypatch.setattr(module, "run", lambda *args, **kwargs: InterpreterResult())

    module.write_runtime_manifest(
        output_dir=runtime_root,
        python_bin=python_bin,
        python_version="3.14",
    )

    manifest = json.loads((runtime_root / "runtime-manifest.json").read_text())
    assert manifest["schema_version"] == 2
    assert manifest["python_selector"] == "3.14"
    assert manifest["python_version"] == "3.14.0"
    assert manifest["python_free_threaded"] is False
    assert manifest["python_executable"] == (
        "managed-python/cpython-3.14-test/bin/python3"
    )
    assert manifest["python_home"] == "managed-python/cpython-3.14-test"
    assert manifest["site_packages"] == "python/lib/python3.14/site-packages"
    assert not any(str(tmp_path) in str(value) for value in manifest.values())

    relocated_root = tmp_path / "relocated" / "backend-runtime"
    relocated_root.parent.mkdir()
    __import__("shutil").copytree(runtime_root, relocated_root)
    relocated_manifest = json.loads(
        (relocated_root / "runtime-manifest.json").read_text()
    )
    for key in ["python_executable", "python_home", "site_packages"]:
        assert (relocated_root / relocated_manifest[key]).exists()


def test_relative_runtime_path_rejects_build_machine_paths(tmp_path: Path) -> None:
    module = _load_package_backend_runtime_module()
    runtime_root = tmp_path / "runtime"
    runtime_root.mkdir()
    outside = tmp_path / "outside" / "python"
    outside.parent.mkdir()
    outside.touch()

    with pytest.raises(RuntimeError, match="outside runtime root"):
        module.relative_runtime_path(outside, runtime_root)


def test_frontend_desktop_dev_uses_packaged_runtime_path() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    package_json = __import__("json").loads(
        (repo_root / "frontend" / "package.json").read_text("utf-8")
    )
    scripts = package_json["scripts"]

    assert scripts["prepare:backend-runtime"] == (
        "node ../scripts/prepare-backend-runtime.mjs"
    )
    assert scripts["dev:desktop"].startswith("pnpm prepare:backend-runtime")
    assert scripts["desktop:build:mac"] == (
        "pnpm prepare:backend-runtime && CI=true tauri build --bundles app,dmg"
    )
    assert not any(name.startswith("package:backend-runtime") for name in scripts)


def test_root_workspace_uses_local_backend_source() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    pyproject = tomllib.loads((repo_root / "pyproject.toml").read_text("utf-8"))

    backend_source = pyproject["tool"]["uv"]["sources"]["ldaca-wordflow"]

    assert backend_source == {"path": "./backend", "editable": True}
