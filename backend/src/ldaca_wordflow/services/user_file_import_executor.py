"""Fresh-process execution owned only by Data Portal User File Imports."""

from __future__ import annotations

import multiprocessing as mp
import os
import queue
import time
import traceback
from collections.abc import Awaitable, Callable, Mapping
from functools import partial
from multiprocessing.process import BaseProcess
from multiprocessing.queues import Queue
from pathlib import Path
from typing import Any, Protocol, TypeVar, cast

import anyio
from anyio.to_thread import run_sync as run_sync_in_worker_thread

from .user_file_import_execution_types import UserFileImportKey

T = TypeVar("T")
ProgressReporter = Callable[[object], Awaitable[None]]


class _PipeConnection(Protocol):
    def send(self, obj: object) -> None: ...

    def recv(self) -> Any: ...

    def poll(self, timeout: float = 0.0) -> bool: ...

    def close(self) -> None: ...


class UserFileImportProcessError(RuntimeError):
    """A Data Portal child failed or exited without a valid result."""


def _run_import_process[T](
    function: Callable[..., T],
    kwargs: Mapping[str, object],
    progress_queue: Queue[Any],
    result_connection: _PipeConnection,
    max_storage_bytes: int,
) -> None:
    try:
        if os.name != "nt":
            try:
                import resource

                resource.setrlimit(
                    resource.RLIMIT_FSIZE,
                    (max_storage_bytes, max_storage_bytes),
                )
            except ImportError, OSError, ValueError:
                pass
        result = function(**dict(kwargs), progress_queue=progress_queue)
        result_connection.send(("ok", result))
    except BaseException as exc:
        result_connection.send(
            ("error", type(exc).__name__, traceback.format_tb(exc.__traceback__))
        )
    finally:
        result_connection.close()


class UserFileImportProcessExecutor:
    """Own one direct child-process handle per running portal import."""

    def __init__(self) -> None:
        self._context = mp.get_context("spawn")
        self._processes: dict[UserFileImportKey, BaseProcess] = {}
        self._lock = anyio.Lock()
        self._closed = False

    async def execute(
        self,
        key: UserFileImportKey,
        function: Callable[..., T],
        kwargs: Mapping[str, object],
        report_progress: ProgressReporter,
        *,
        storage_roots: tuple[str, ...],
        max_storage_bytes: int,
        max_storage_files: int,
    ) -> T:
        progress_queue = self._context.Queue()
        result_parent, result_child = self._context.Pipe(duplex=False)
        process = self._context.Process(
            target=_run_import_process,
            args=(
                function,
                dict(kwargs),
                progress_queue,
                result_child,
                max_storage_bytes,
            ),
            daemon=False,
        )
        started = False
        try:
            async with self._lock:
                if self._closed:
                    raise RuntimeError("User File Import executor is closed")
                if key in self._processes:
                    raise ValueError("User File Import already owns a process")
                await run_sync_in_worker_thread(
                    process.start,
                    abandon_on_cancel=False,
                )
                started = True
                result_child.close()
                self._processes[key] = process
            return await self._receive_result(
                process,
                progress_queue,
                result_parent,
                report_progress,
                storage_roots,
                max_storage_bytes,
                max_storage_files,
            )
        except BaseException:
            if started:
                await self._terminate(process)
            raise
        finally:
            async with self._lock:
                self._processes.pop(key, None)
            result_parent.close()
            if not started:
                result_child.close()
            await self._close_queue(progress_queue)

    async def close(self, deadline: float) -> None:
        """Reject launches and terminate every child by one shared deadline."""

        async with self._lock:
            if self._closed:
                return
            self._closed = True
            processes = list(self._processes.values())
        async with anyio.create_task_group() as task_group:
            for process in processes:
                task_group.start_soon(self._terminate, process, deadline)

    async def _receive_result(
        self,
        process: BaseProcess,
        progress_queue: Queue[Any],
        result_parent: _PipeConnection,
        report_progress: ProgressReporter,
        storage_roots: tuple[str, ...],
        max_storage_bytes: int,
        max_storage_files: int,
    ) -> T:
        last_storage_check = 0.0
        while True:
            now = time.monotonic()
            if now - last_storage_check >= 0.1:
                used_bytes, used_files = await run_sync_in_worker_thread(
                    _storage_usage,
                    storage_roots,
                    abandon_on_cancel=False,
                )
                if used_bytes > max_storage_bytes or used_files > max_storage_files:
                    await self._terminate(process)
                    raise UserFileImportProcessError(
                        "Data Portal import exceeded its private storage limit"
                    )
                last_storage_check = now
            if await run_sync_in_worker_thread(
                result_parent.poll,
                0.05,
                abandon_on_cancel=False,
            ):
                try:
                    envelope = await run_sync_in_worker_thread(
                        result_parent.recv,
                        abandon_on_cancel=False,
                    )
                except EOFError as exc:
                    raise UserFileImportProcessError(
                        "Data Portal import closed its result channel"
                    ) from exc
                if not await self._join(process, timeout=1.0):
                    await self._terminate(process)
                await self._drain_progress(progress_queue, report_progress)
                if not isinstance(envelope, tuple) or not envelope:
                    raise UserFileImportProcessError(
                        "Data Portal import returned an invalid envelope"
                    )
                if envelope[0] == "ok" and len(envelope) == 2:
                    return cast(T, envelope[1])
                if envelope[0] == "error" and len(envelope) == 3:
                    raise UserFileImportProcessError(
                        f"{envelope[1]}\n{''.join(envelope[2])}"
                    )
                raise UserFileImportProcessError(
                    "Data Portal import returned an invalid envelope"
                )

            await self._forward_one_progress(progress_queue, report_progress)
            if not process.is_alive():
                await self._join(process, timeout=1.0)
                await self._drain_progress(progress_queue, report_progress)
                if result_parent.poll():
                    continue
                raise UserFileImportProcessError(
                    f"Data Portal import exited without a result "
                    f"(exit code {process.exitcode})"
                )

    async def _forward_one_progress(
        self,
        progress_queue: Queue[Any],
        report_progress: ProgressReporter,
    ) -> None:
        try:
            payload = await run_sync_in_worker_thread(
                partial(progress_queue.get, True, 0.01),
                abandon_on_cancel=False,
            )
        except queue.Empty:
            return
        await report_progress(payload)

    async def _drain_progress(
        self,
        progress_queue: Queue[Any],
        report_progress: ProgressReporter,
    ) -> None:
        """Forward every report flushed by a child before accepting its result."""

        while True:
            try:
                payload = await run_sync_in_worker_thread(
                    partial(progress_queue.get, False),
                    abandon_on_cancel=False,
                )
            except queue.Empty:
                return
            await report_progress(payload)

    async def _terminate(
        self,
        process: BaseProcess,
        deadline: float | None = None,
    ) -> None:
        with anyio.CancelScope(shield=True):
            if not process.is_alive():
                await self._join(process, timeout=1.0)
                return
            process.terminate()
            terminate_timeout = (
                5.0
                if deadline is None
                else max(0.0, deadline - anyio.current_time())
            )
            if terminate_timeout > 0 and await self._join(
                process,
                timeout=terminate_timeout,
            ):
                return
            process.kill()
            kill_timeout = (
                2.0
                if deadline is None
                else max(0.0, deadline - anyio.current_time())
            )
            if kill_timeout == 0:
                if await self._join(process, timeout=0.0):
                    return
                raise RuntimeError("Data Portal import process did not terminate")
            if not await self._join(process, timeout=kill_timeout):
                raise RuntimeError("Data Portal import process did not terminate")

    async def _join(self, process: BaseProcess, *, timeout: float) -> bool:
        await run_sync_in_worker_thread(
            process.join,
            timeout,
            abandon_on_cancel=False,
        )
        return not process.is_alive()

    async def _close_queue(self, progress_queue: Queue[Any]) -> None:
        await run_sync_in_worker_thread(progress_queue.close, abandon_on_cancel=False)
        await run_sync_in_worker_thread(
            progress_queue.join_thread,
            abandon_on_cancel=False,
        )


def _storage_usage(roots: tuple[str, ...]) -> tuple[int, int]:
    total_bytes = 0
    total_files = 0
    seen: set[Path] = set()
    for raw_root in roots:
        root = Path(raw_root)
        if not root.exists() or root.is_symlink():
            continue
        for current_root, directory_names, file_names in os.walk(
            root,
            topdown=True,
            followlinks=False,
        ):
            current = Path(current_root)
            directory_names[:] = [
                name for name in directory_names if not (current / name).is_symlink()
            ]
            for name in file_names:
                candidate = current / name
                if candidate.is_symlink():
                    continue
                try:
                    resolved = candidate.resolve(strict=True)
                    metadata = resolved.stat()
                except FileNotFoundError:
                    continue
                if resolved in seen:
                    continue
                seen.add(resolved)
                total_bytes += metadata.st_size
                total_files += 1
    return total_bytes, total_files


__all__ = [
    "UserFileImportProcessError",
    "UserFileImportProcessExecutor",
]
