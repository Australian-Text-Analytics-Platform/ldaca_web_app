"""Data Portal import adapter for shared fresh-process supervision."""

from __future__ import annotations

from .supervised_process import (
    ProgressReporter,
    SupervisedProcessError,
    SupervisedProcessRunner,
)
from .user_file_import_execution_types import UserFileImportKey
from ..workers.data_portal import data_portal_import_process
from ..workers.invocations import DataPortalImportInput

UserFileImportProcessError = SupervisedProcessError


class UserFileImportProcessExecutor:
    """Bind retained import keys and typed owner outcomes to shared supervision."""

    def __init__(self) -> None:
        self._runner = SupervisedProcessRunner[UserFileImportKey](
            "Data Portal import"
        )

    async def execute(
        self,
        key: UserFileImportKey,
        invocation: DataPortalImportInput,
        report_progress: ProgressReporter,
        *,
        storage_roots: tuple[str, ...],
        max_storage_bytes: int,
        max_storage_files: int,
    ) -> object:
        return await self._runner.execute(
            key,
            data_portal_import_process,
            {"invocation": invocation},
            report_progress,
            storage_roots=storage_roots,
            max_storage_bytes=max_storage_bytes,
            max_storage_files=max_storage_files,
        )
    async def close(self, deadline: float) -> None:
        await self._runner.close(deadline)


__all__ = [
    "UserFileImportProcessError",
    "UserFileImportProcessExecutor",
]
