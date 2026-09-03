"""Exclusive Workspace open, close, and referential deletion coordination."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
import uuid

import anyio

from .analysis_execution import AnalysisExecutionRuntime
from .analyses import AnalysisService
from .workspace import WorkspaceRecord, WorkspaceService


@dataclass(slots=True)
class _UserLifecycleGate:
    lock: anyio.Lock
    users: int = 0


class WorkspaceLifecycleService:
    """Coordinate explicit Workspace lifecycle with private Analysis execution."""

    def __init__(
        self,
        workspaces: WorkspaceService,
        analyses: AnalysisExecutionRuntime,
        analysis_service: AnalysisService,
    ) -> None:
        self._workspaces = workspaces
        self._analyses = analyses
        self._analysis_service = analysis_service
        self._gate_registry_lock = anyio.Lock()
        self._user_gates: dict[str, _UserLifecycleGate] = {}

    async def open(
        self,
        user_id: str,
        workspace_id: uuid.UUID,
    ) -> WorkspaceRecord:
        """Make the target the user's sole open Workspace.

        Target validation precedes any sibling transition. Once switching has
        begun, failures are left visible through the authoritative runtime
        states rather than being hidden behind an in-memory rollback.
        """

        async with self._user_gate(user_id):
            async with self._workspaces.reserve_open(user_id, workspace_id):
                target = await self._workspaces.get_workspace(user_id, workspace_id)
                siblings = await self._workspaces.list_workspaces(user_id)
                for sibling in siblings:
                    if (
                        not isinstance(sibling, WorkspaceRecord)
                        or sibling.id == workspace_id
                        or sibling.runtime_state != "open"
                    ):
                        continue
                    await self._workspaces.request_close(
                        user_id,
                        sibling.id,
                        self._analyses.has_workspace_work,
                    )
                opened = await self._workspaces.open_workspace(user_id, workspace_id)
                if target.runtime_state == "closed":
                    await self._analysis_service.finalize_interrupted_analyses(
                        user_id,
                        workspace_id,
                    )
                    opened = await self._workspaces.open_workspace(user_id, workspace_id)
                return opened

    async def request_close(
        self,
        user_id: str,
        workspace_id: uuid.UUID,
    ) -> WorkspaceRecord | None:
        """Return a closing resource, or ``None`` after immediate closure."""

        async with self._user_gate(user_id):
            return await self._workspaces.request_close(
                user_id,
                workspace_id,
                self._analyses.has_workspace_work,
            )

    async def delete(
        self,
        user_id: str,
        workspace_id: uuid.UUID,
    ) -> None:
        """Stop Workspace-owned execution and atomically remove the Workspace."""

        async with self._user_gate(user_id):
            async with self._workspaces.deletion_context(user_id, workspace_id):
                await self._analyses.cancel_workspace(user_id, workspace_id)

    @asynccontextmanager
    async def _user_gate(self, user_id: str) -> AsyncIterator[None]:
        async with self._gate_registry_lock:
            gate = self._user_gates.get(user_id)
            if gate is None:
                gate = _UserLifecycleGate(anyio.Lock())
                self._user_gates[user_id] = gate
            gate.users += 1
        try:
            async with gate.lock:
                yield
        finally:
            async with self._gate_registry_lock:
                gate.users -= 1
                if gate.users == 0:
                    self._user_gates.pop(user_id, None)


__all__ = ["WorkspaceLifecycleService"]
