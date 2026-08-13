"""Atomic Analysis Artifact publication tests."""

from pathlib import Path

import pytest

from ldaca_wordflow.services import analysis_artifacts
from ldaca_wordflow.shared.json_data import JsonData


def _analysis_output(tmp_path: Path) -> tuple[Path, Path]:
    analysis_dir = tmp_path / "analysis"
    output_dir = analysis_dir / ".execution" / "output"
    output_dir.mkdir(parents=True)
    artifact = output_dir / "result.parquet"
    artifact.write_bytes(b"parquet")
    return analysis_dir, artifact


def test_publication_rewrites_declared_paths_after_validation(tmp_path: Path) -> None:
    analysis_dir, artifact = _analysis_output(tmp_path)
    payload: dict[str, JsonData] = {"artifact": artifact.name}

    publication = analysis_artifacts._publish_result(
        analysis_dir,
        payload,
        [(('artifact',), artifact.name)],
    )

    assert publication.payload == {
        "artifact": {
            "name": "result.parquet",
            "media_type": "application/vnd.apache.parquet",
        }
    }
    assert publication.artifacts[0].relative_path == "artifacts/result.parquet"
    assert (analysis_dir / "artifacts" / artifact.name).read_bytes() == b"parquet"


def test_publication_removes_renamed_output_when_parent_sync_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    analysis_dir, artifact = _analysis_output(tmp_path)
    real_fsync_directory = analysis_artifacts.fsync_directory

    def fail_after_rename(path: Path) -> None:
        if path == analysis_dir and (analysis_dir / "artifacts").exists():
            raise OSError("sync failed")
        real_fsync_directory(path)

    monkeypatch.setattr(analysis_artifacts, "fsync_directory", fail_after_rename)
    payload: dict[str, JsonData] = {"artifact": artifact.name}

    with pytest.raises(OSError, match="sync failed"):
        analysis_artifacts._publish_result(
            analysis_dir,
            payload,
            [(('artifact',), artifact.name)],
        )

    assert not (analysis_dir / "artifacts").exists()
