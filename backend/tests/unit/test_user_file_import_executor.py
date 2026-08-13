"""Owned-process safety for Data Portal User File Imports."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import anyio
import pytest

from ldaca_wordflow.services.user_file_import_execution_types import (
    UserFileImportKey,
)
from ldaca_wordflow.services.user_file_import_executor import (
    UserFileImportProcessExecutor,
)


def _report_then_write(
    *,
    destination: str,
    progress_queue: Any,
) -> dict[str, object]:
    progress_queue.put({"fraction": 0.5, "message": "Halfway"})
    time.sleep(0.5)
    Path(destination).write_text("orphaned", encoding="utf-8")
    return {"complete": True}


async def test_progress_failure_terminates_the_owned_process(tmp_path: Path) -> None:
    executor = UserFileImportProcessExecutor()
    destination = tmp_path / "orphan.txt"

    async def reject_progress(_payload: object) -> None:
        raise ValueError("invalid progress")

    with pytest.raises(ValueError, match="invalid progress"):
        await executor.execute(
            UserFileImportKey("alice", "import"),
            _report_then_write,
            {"destination": str(destination)},
            reject_progress,
            storage_roots=(str(tmp_path),),
            max_storage_bytes=1024,
            max_storage_files=10,
        )

    await anyio.sleep(0.6)
    assert not destination.exists()
