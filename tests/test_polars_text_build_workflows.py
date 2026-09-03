from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
POLARS_TEXT = REPO_ROOT / "polars-text"


def _read(path: Path) -> str:
    return path.read_text("utf-8")


def test_polars_text_makefile_exposes_feature_sliced_local_targets() -> None:
    makefile = _read(POLARS_TEXT / "Makefile")

    assert "JOBS ?=" in makefile
    assert "JOBS_ARG :=" in makefile
    assert "-j $(JOBS)" not in makefile
    for target in [
        "check-basic:",
        "check-tokenization:",
        "check-embedding:",
        "check-topic:",
        "build-basic:",
        "build-tokenization:",
        "build-embedding:",
        "build-topic:",
    ]:
        assert target in makefile
    assert "maturin develop --no-default-features --features tokenization" in makefile
    assert "maturin develop --no-default-features --features topic-modeling" in makefile


def test_polars_text_dev_profile_keeps_debug_artifacts_small() -> None:
    cargo_toml = _read(POLARS_TEXT / "Cargo.toml")

    assert "[profile.dev]" in cargo_toml
    assert 'debug = 0' in cargo_toml


def test_polars_text_release_workflow_is_not_duplicate_pr_ci() -> None:
    release_yml = _read(POLARS_TEXT / ".github" / "workflows" / "release.yml")

    on_block = release_yml.split("concurrency:", 1)[0]
    assert "pull_request:" not in on_block


def test_polars_text_maturin_workflows_pin_maturin_and_use_action_sccache() -> None:
    for workflow in [
        POLARS_TEXT / ".github" / "workflows" / "ci.yml",
        POLARS_TEXT / ".github" / "workflows" / "release.yml",
    ]:
        text = _read(workflow)
        assert "maturin-version: v1.15.0" in text
        assert "sccache: ${{ runner.os != 'Windows' }}" in text
        assert "RUSTC_WRAPPER: sccache" not in text
        assert "mozilla-actions/sccache-action" not in text
        assert "--locked" in text


def test_desktop_build_uses_one_source_aware_cache_simple_workflow() -> None:
    workflows = REPO_ROOT / ".github" / "workflows"
    desktop = _read(workflows / "desktop-build.yml")
    release = _read(workflows / "desktop-release.yml")

    assert not (workflows / "desktop-macos.yml").exists()
    assert not (workflows / "desktop-windows.yml").exists()
    assert "platform:" in desktop
    assert "windows-latest" in desktop
    assert "macos-latest" in desktop
    assert "pnpm prepare:backend-runtime" in desktop
    assert "pnpm tauri:build" in desktop
    assert "bundle/dmg/*.dmg" in desktop
    assert "Validate backend package" not in desktop
    assert "uv run ruff" not in desktop
    assert "uv run ty" not in desktop
    assert "uv run pytest" not in desktop
    assert "sccache" not in desktop.lower()
    assert "actions/cache" not in desktop
    assert "desktop-build.yml" in release
    assert "matrix.platform" in release
    assert "desktop-macos.yml" not in release
    assert "desktop-windows.yml" not in release
    assert '"${RELEASE_TAG}^{commit}"' in release
    assert '"$checked_out_sha" != "$release_sha"' in release


def test_wordflow_release_workflows_are_manual_only() -> None:
    workflows = REPO_ROOT / ".github" / "workflows"
    for filename in ["pypi-release.yml", "desktop-release.yml"]:
        on_block = _read(workflows / filename).split("concurrency:", 1)[0]
        assert "workflow_dispatch:" in on_block
        assert "push:" not in on_block

    backend_release = _read(workflows / "pypi-release.yml")
    assert "- pypi" in backend_release
    assert "inputs.publish_target == 'pypi'" in backend_release
    assert '[[ "$GITHUB_REF" == refs/tags/v* ]]' in backend_release


def test_stage_backend_runtime_windows_dll_copy_uses_manifest_python_home() -> None:
    script = _read(REPO_ROOT / "frontend" / "scripts" / "stage-backend-runtime.mjs")

    assert "findManagedCpythonDir" not in script
    assert "path.join(layout.python_home, dll)" in script
    assert "pyvenv.cfg" not in script
