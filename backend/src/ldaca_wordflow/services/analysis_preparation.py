"""Prepare immutable process inputs for Workspace-owned root Analyses."""

from __future__ import annotations

import shutil
from collections.abc import Callable
from functools import partial
from pathlib import Path

import anyio
from anyio.to_thread import run_sync as run_sync_in_worker_thread

from ..domain.workspace import AnalysisRecord, analysis_snapshot_input_ids
from ..infrastructure.storage.input_snapshots import create_worker_input_snapshot
from ..settings import Settings
from .analysis_execution_types import AnalysisInvocation
from .analysis_preparation_registry import (
    AnalysisPreparationContext,
    prepare_analysis_worker_input,
)
from .workspace import WorkspaceLease


class AnalysisExecutionPreparer:
    """Build one process invocation while the Workspace gate is held."""

    def __init__(
        self,
        settings: Settings,
        *,
        limiter: anyio.CapacityLimiter,
        cache_root: Callable[[str], Path],
    ) -> None:
        self._settings = settings
        self._limiter = limiter
        self._cache_root = cache_root

    async def prepare(
        self,
        lease: WorkspaceLease,
        record: AnalysisRecord,
        credential: str | None,
        *,
        user_id: str,
    ) -> AnalysisInvocation:
        """Snapshot selected Data Blocks and return only private immutable inputs."""

        analysis_id = str(record.id)
        workspace = lease.workspace
        node_ids = list(analysis_snapshot_input_ids(record.request))
        execution_dir = lease.path / "analyses" / analysis_id / ".execution"
        snapshot_dir = execution_dir / "input"
        artifact_dir = execution_dir / "output"
        scratch_dir = execution_dir / "scratch"
        try:
            await run_sync_in_worker_thread(
                partial(
                    create_worker_input_snapshot,
                    workspace_id=workspace.id,
                    node_ids=node_ids,
                    workspace=workspace,
                    workspace_data_dir=lease.path / "data",
                    snapshot_dir=snapshot_dir,
                    max_snapshot_bytes=self._settings.max_analysis_storage_bytes,
                ),
                abandon_on_cancel=False,
                limiter=self._limiter,
            )
            worker_input = prepare_analysis_worker_input(
                AnalysisPreparationContext(
                    record=record,
                    user_id=user_id,
                    workspace=workspace,
                    workspace_path=lease.path,
                    snapshot_dir=snapshot_dir,
                    artifact_dir=artifact_dir,
                    scratch_dir=scratch_dir,
                    credential=credential,
                    settings=self._settings,
                    cache_root=self._cache_root(user_id),
                )
            )
            return AnalysisInvocation(
                input=worker_input,
                storage_roots=(str(execution_dir),),
                max_storage_bytes=self._settings.max_analysis_storage_bytes,
                max_storage_files=self._settings.max_analysis_storage_files,
            )
        except BaseException:
            with anyio.CancelScope(shield=True):
                await run_sync_in_worker_thread(
                    _remove_execution_staging,
                    execution_dir,
                    abandon_on_cancel=False,
                    limiter=self._limiter,
                )
            raise


def _remove_execution_staging(path: Path) -> None:
    try:
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
        elif path.exists() or path.is_symlink():
            path.unlink()
    except FileNotFoundError:
        return


__all__ = ["AnalysisExecutionPreparer"]
