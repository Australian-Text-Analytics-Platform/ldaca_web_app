"""Supervised fresh-process execution shared by background resource adapters."""

from __future__ import annotations

import multiprocessing as mp
import os
import queue
import time
import traceback
from collections.abc import Awaitable, Callable, Hashable, Mapping
from dataclasses import dataclass
from functools import partial
from multiprocessing.process import BaseProcess
from multiprocessing.queues import Queue
from typing import Any, Protocol

import anyio
from anyio.to_thread import run_sync as run_sync_in_worker_thread

from ..infrastructure.storage.safe_paths import logical_tree_usage

ProgressReporter = Callable[[object], Awaitable[None]]


class PipeConnection(Protocol):
    def send(self, obj: object) -> None: ...

    def recv(self) -> Any: ...

    def poll(self, timeout: float = 0.0) -> bool: ...

    def close(self) -> None: ...


def poll_result_connection(
    connection: PipeConnection,
    timeout: float = 0.0,
) -> bool:
    """Treat a closed Windows named pipe as an empty result channel."""

    try:
        return connection.poll(timeout)
    except BrokenPipeError:
        return False


class SupervisedProcessError(RuntimeError):
    """A child failed or exited without a valid result envelope."""


class SupervisedProcessStartError(SupervisedProcessError):
    """The operating system could not launch one reserved child process."""


class SupervisedProcessCancelled(RuntimeError):
    """Execution was suppressed or terminated by explicit cancellation."""


@dataclass(slots=True)
class _LaunchEntry:
    process: BaseProcess | None = None
    cancellation_requested: bool = False


def _run_process(
    function: Callable[..., object],
    kwargs: Mapping[str, object],
    progress_queue: Queue[Any],
    result_connection: PipeConnection,
    max_storage_bytes: int,
) -> None:
    """Run one picklable worker and return one validated outer envelope."""

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


class SupervisedProcessRunner[K: Hashable]:
    """Own launch reservations, process handles, IPC, and forced shutdown."""

    def __init__(self, resource_name: str) -> None:
        self._resource_name = resource_name
        self._context = mp.get_context("spawn")
        self._entries: dict[K, _LaunchEntry] = {}
        self._lock = anyio.Lock()
        self._closed = False

    async def reserve(self, key: K) -> None:
        async with self._lock:
            if self._closed:
                raise RuntimeError(f"{self._resource_name} process runner is closed")
            if key in self._entries:
                raise ValueError(f"{self._resource_name} already has a launch entry")
            self._entries[key] = _LaunchEntry()

    async def discard_reservation(self, key: K) -> None:
        async with self._lock:
            entry = self._entries.get(key)
            if entry is not None and entry.process is None:
                self._entries.pop(key, None)

    async def execute(
        self,
        key: K,
        function: Callable[..., object],
        kwargs: Mapping[str, object],
        report_progress: ProgressReporter,
        *,
        storage_roots: tuple[str, ...],
        max_storage_bytes: int,
        max_storage_files: int,
    ) -> object:
        await self.reserve(key)
        return await self.execute_reserved(
            key,
            function,
            kwargs,
            report_progress,
            storage_roots=storage_roots,
            max_storage_bytes=max_storage_bytes,
            max_storage_files=max_storage_files,
        )

    async def execute_reserved(
        self,
        key: K,
        function: Callable[..., object],
        kwargs: Mapping[str, object],
        report_progress: ProgressReporter,
        *,
        storage_roots: tuple[str, ...],
        max_storage_bytes: int,
        max_storage_files: int,
    ) -> object:
        progress_queue = self._context.Queue()
        result_parent, result_child = self._context.Pipe(duplex=False)
        process = self._context.Process(
            target=_run_process,
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
                entry = self._entries.get(key)
                if entry is None:
                    raise RuntimeError(
                        f"{self._resource_name} launch entry is unavailable"
                    )
                if self._closed or entry.cancellation_requested:
                    raise SupervisedProcessCancelled(
                        f"{self._resource_name} launch was cancelled"
                    )
                try:
                    await run_sync_in_worker_thread(
                        process.start,
                        abandon_on_cancel=False,
                    )
                except Exception as exc:
                    raise SupervisedProcessStartError(
                        f"{self._resource_name} process could not start"
                    ) from exc
                started = True
                result_child.close()
                entry.process = process
            return await self._receive_result(
                key,
                process,
                progress_queue,
                result_parent,
                report_progress,
                storage_roots=storage_roots,
                max_storage_bytes=max_storage_bytes,
                max_storage_files=max_storage_files,
            )
        except BaseException:
            if started:
                await self._terminate(process)
            raise
        finally:
            async with self._lock:
                self._entries.pop(key, None)
            result_parent.close()
            if not started:
                result_child.close()
            await self._close_queue(progress_queue)

    async def cancel(self, key: K) -> None:
        async with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return
            entry.cancellation_requested = True
            process = entry.process
        if process is not None:
            await self._terminate(process)

    async def close(self, deadline: float) -> None:
        async with self._lock:
            if self._closed:
                return
            self._closed = True
            entries = list(self._entries.values())
            for entry in entries:
                entry.cancellation_requested = True
            processes = [
                entry.process for entry in entries if entry.process is not None
            ]
        async with anyio.create_task_group() as task_group:
            for process in processes:
                task_group.start_soon(self._terminate, process, deadline)

    async def _receive_result(
        self,
        key: K,
        process: BaseProcess,
        progress_queue: Queue[Any],
        result_parent: PipeConnection,
        report_progress: ProgressReporter,
        *,
        storage_roots: tuple[str, ...],
        max_storage_bytes: int,
        max_storage_files: int,
    ) -> object:
        last_storage_check = 0.0
        while True:
            now = time.monotonic()
            if now - last_storage_check >= 0.1:
                used_bytes, used_files = await run_sync_in_worker_thread(
                    logical_tree_usage,
                    storage_roots,
                    max_storage_bytes,
                    max_storage_files,
                    abandon_on_cancel=False,
                )
                if used_bytes > max_storage_bytes or used_files > max_storage_files:
                    await self._terminate(process)
                    raise SupervisedProcessError(
                        f"{self._resource_name} exceeded its private storage budget"
                    )
                last_storage_check = now

            if await run_sync_in_worker_thread(
                poll_result_connection,
                result_parent,
                0.05,
                abandon_on_cancel=False,
            ):
                try:
                    envelope = await run_sync_in_worker_thread(
                        result_parent.recv,
                        abandon_on_cancel=False,
                    )
                except EOFError as exc:
                    if await self._cancellation_requested(key):
                        raise SupervisedProcessCancelled(
                            f"{self._resource_name} process cancellation was confirmed"
                        ) from exc
                    raise SupervisedProcessError(
                        f"{self._resource_name} closed its result channel"
                    ) from exc
                if not await self._join(process, timeout=1.0):
                    await self._terminate(process)
                await self._drain_progress(progress_queue, report_progress)
                return self._validate_envelope(envelope)

            await self._forward_one_progress(progress_queue, report_progress)
            if not process.is_alive():
                await self._join(process, timeout=1.0)
                await self._drain_progress(progress_queue, report_progress)
                if poll_result_connection(result_parent):
                    continue
                if await self._cancellation_requested(key):
                    raise SupervisedProcessCancelled(
                        f"{self._resource_name} process cancellation was confirmed"
                    )
                raise SupervisedProcessError(
                    f"{self._resource_name} exited without a result "
                    f"(exit code {process.exitcode})"
                )

    def _validate_envelope(self, envelope: object) -> object:
        if not isinstance(envelope, tuple) or not envelope:
            raise SupervisedProcessError(
                f"{self._resource_name} returned an invalid envelope"
        )
        if envelope[0] == "ok" and len(envelope) == 2:
            return envelope[1]
        if envelope[0] == "error" and len(envelope) == 3:
            traceback_lines = envelope[2]
            if not isinstance(traceback_lines, list) or not all(
                isinstance(line, str) for line in traceback_lines
            ):
                raise SupervisedProcessError(
                    f"{self._resource_name} returned an invalid envelope"
                )
            raise SupervisedProcessError(
                f"{envelope[1]}\n{''.join(str(line) for line in traceback_lines)}"
            )
        raise SupervisedProcessError(
            f"{self._resource_name} returned an invalid envelope"
        )

    async def _cancellation_requested(self, key: K) -> bool:
        async with self._lock:
            entry = self._entries.get(key)
            return entry is not None and entry.cancellation_requested

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
                raise RuntimeError(
                    f"{self._resource_name} process did not terminate"
                )
            if not await self._join(process, timeout=kill_timeout):
                raise RuntimeError(f"{self._resource_name} process did not terminate")

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


__all__ = [
    "PipeConnection",
    "ProgressReporter",
    "SupervisedProcessCancelled",
    "SupervisedProcessError",
    "SupervisedProcessRunner",
    "SupervisedProcessStartError",
    "poll_result_connection",
]
