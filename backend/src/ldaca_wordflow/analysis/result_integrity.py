"""Framework-independent integrity checks for persisted Analysis Results."""

from __future__ import annotations

import stat
import uuid
from collections.abc import Mapping
from pathlib import Path

from ..domain.workspace import AnalysisRecord, AnalysisState
from ..infrastructure.storage.safe_paths import is_link_or_reparse
from ..models.analysis_results import ANALYSIS_STORED_RESULT_MODELS


def validate_analysis_result_integrity(
    workspace_root: Path,
    record: AnalysisRecord,
    available_node_ids: set[uuid.UUID] | None = None,
) -> None:
    """Require Result models, identities, and owned Artifact bytes to agree."""

    if record.state is not AnalysisState.SUCCEEDED:
        return
    if record.result_payload is None:
        raise ValueError("Successful Analysis is missing its Result")
    stored_model = ANALYSIS_STORED_RESULT_MODELS.get(record.request.kind)
    if stored_model is None:
        raise ValueError("Analysis kind has no stored Result contract")
    stored = stored_model.model_validate(record.result_payload)
    stored_payload = stored.model_dump(mode="json")

    raw_output_ids = stored_payload.get("output_node_ids")
    if raw_output_ids is not None and raw_output_ids != [
        str(node_id) for node_id in record.output_node_ids
    ]:
        raise ValueError("Analysis output Data Block identities do not agree")
    if available_node_ids is not None and any(
        node_id not in available_node_ids for node_id in record.output_node_ids
    ):
        raise ValueError("Analysis output Data Block is unavailable")

    semantic_artifacts = _semantic_artifact_identities(stored_payload)
    declared_artifacts = {
        (artifact.name, artifact.media_type) for artifact in record.artifact_references
    }
    if semantic_artifacts != declared_artifacts:
        raise ValueError("Analysis Result and Artifact identities do not agree")

    analysis_root = workspace_root / "analyses" / str(record.id)
    artifacts_root = analysis_root / "artifacts"
    resolved_declared: set[Path] = set()
    for artifact in record.artifact_references:
        relative = Path(artifact.relative_path)
        if (
            relative.is_absolute()
            or len(relative.parts) < 2
            or relative.parts[0] != "artifacts"
            or any(part in {"", ".", ".."} for part in relative.parts)
        ):
            raise ValueError("Analysis Artifact path is invalid")
        resolved = _regular_file_without_links(analysis_root, relative)
        expected_media_type = _artifact_media_type(resolved)
        if artifact.media_type != expected_media_type:
            raise ValueError("Analysis Artifact media type is invalid")
        resolved_declared.add(resolved)

    resolved_files = _owned_artifact_files(artifacts_root)
    if resolved_files != resolved_declared:
        raise ValueError("Analysis Artifact declarations and files do not agree")


def _semantic_artifact_identities(value: object) -> set[tuple[str, str | None]]:
    identities: set[tuple[str, str | None]] = set()
    if isinstance(value, Mapping):
        if set(value) == {"name", "media_type"}:
            name = value["name"]
            media_type = value["media_type"]
            if not isinstance(name, str) or not (
                media_type is None or isinstance(media_type, str)
            ):
                raise ValueError("Stored Artifact identity is invalid")
            identities.add((name, media_type))
        else:
            for child in value.values():
                identities.update(_semantic_artifact_identities(child))
    elif isinstance(value, list):
        for child in value:
            identities.update(_semantic_artifact_identities(child))
    return identities


def _regular_file_without_links(root: Path, relative: Path) -> Path:
    resolved_root = root.resolve(strict=True)
    current = resolved_root
    for part in relative.parts:
        current /= part
        metadata = current.lstat()
        if is_link_or_reparse(metadata):
            raise ValueError("Analysis Artifact path contains a link")
    if not stat.S_ISREG(current.lstat().st_mode):
        raise ValueError("Analysis Artifact is not a regular file")
    resolved = current.resolve(strict=True)
    resolved.relative_to(resolved_root)
    return resolved


def _owned_artifact_files(root: Path) -> set[Path]:
    if not root.exists():
        return set()
    metadata = root.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or root.is_symlink():
        raise ValueError("Analysis Artifact owner is invalid")
    files: set[Path] = set()
    for candidate in root.rglob("*"):
        candidate_metadata = candidate.lstat()
        if is_link_or_reparse(candidate_metadata):
            raise ValueError("Analysis Artifact tree contains a link")
        if stat.S_ISREG(candidate_metadata.st_mode):
            files.add(candidate.resolve(strict=True))
        elif not stat.S_ISDIR(candidate_metadata.st_mode):
            raise ValueError("Analysis Artifact tree contains a special file")
    return files


def _artifact_media_type(path: Path) -> str:
    return {
        ".arrows": "application/vnd.apache.arrow.stream",
        ".parquet": "application/vnd.apache.parquet",
        ".json": "application/json",
        ".csv": "text/csv",
        ".zip": "application/zip",
    }.get(path.suffix.casefold(), "application/octet-stream")


__all__ = ["validate_analysis_result_integrity"]
