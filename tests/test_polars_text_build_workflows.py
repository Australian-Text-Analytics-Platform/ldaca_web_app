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
        assert "maturin-version: v1.14.1" in text
        assert "sccache: true" in text
        assert "RUSTC_WRAPPER: sccache" not in text
        assert "mozilla-actions/sccache-action" not in text
        assert "--locked" in text


def test_desktop_workflows_use_sccache_for_rust_builds() -> None:
    for workflow in [
        REPO_ROOT / ".github" / "workflows" / "desktop-macos.yml",
        REPO_ROOT / ".github" / "workflows" / "desktop-windows.yml",
    ]:
        text = _read(workflow)
        assert "RUSTC_WRAPPER: sccache" in text
        assert "SCCACHE_GHA_ENABLED" in text
        assert "mozilla-actions/sccache-action" in text
        assert "sccache --show-stats" in text


def test_stage_backend_runtime_windows_dll_copy_uses_resolved_managed_python_dir() -> None:
    script = _read(REPO_ROOT / "frontend" / "scripts" / "stage-backend-runtime.mjs")

    assert "path.join(cpythonDir, dll)" not in script
    assert "path.join(managedCpythonDir, dll)" in script
