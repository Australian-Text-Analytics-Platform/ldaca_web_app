"""Terminate the packaged backend when its desktop parent disappears.

Tauri spawns the backend Python process with `LDACA_PARENT_PID` set to the
Tauri PID. This module starts a daemon thread that polls the parent and
exits the backend if the parent goes away — covering cases where neither
Tauri's CloseRequested nor ExitRequested handler fires (force-quit, crash,
kill -9 of the desktop process, etc.).

The detection is deliberately conservative: a single failed probe is NOT
enough to declare the parent dead. We require N consecutive negative
probes, because OpenProcess on Windows can return NULL transiently for
benign reasons (startup races, integrity-level handshake delays, ctypes
HANDLE-truncation quirks). Killing a healthy backend on a flaky probe is
worse than waiting an extra few seconds to notice a real parent death.

Only the packaged desktop launch sets the parent PID. Other launch profiles
leave the environment variable absent, so starting the watchdog is a no-op.
"""

from __future__ import annotations

import logging
import os
import sys
import threading
import time

logger = logging.getLogger(__name__)

_PARENT_PID_ENV = "LDACA_PARENT_PID"
_DEFAULT_INTERVAL_SECONDS = 2.0
# Require this many consecutive "parent missing" probes before suicide.
# At the default 2s interval that's ~6 seconds of confirmed absence.
_DEFAULT_FAILURE_THRESHOLD = 3


def _make_windows_probe():
    """Build a Windows OpenProcess/GetExitCodeProcess probe with proper types.

    HANDLE is a 64-bit pointer on 64-bit Windows; ctypes' default `c_int`
    return type can truncate it. Setting `restype = c_void_p` avoids that
    so we never mistake a valid handle for NULL.
    """
    if sys.platform != "win32":
        raise RuntimeError("The Windows parent probe requires Windows")

    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    open_process = kernel32.OpenProcess
    open_process.restype = wintypes.HANDLE
    open_process.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]

    get_exit_code = kernel32.GetExitCodeProcess
    get_exit_code.restype = wintypes.BOOL
    get_exit_code.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]

    close_handle = kernel32.CloseHandle
    close_handle.restype = wintypes.BOOL
    close_handle.argtypes = [wintypes.HANDLE]

    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    STILL_ACTIVE = 259

    def _probe(pid: int) -> bool | None:
        """Return True if alive, False if confirmed dead, None if undetermined.

        None means "we couldn't tell" — caller should not count it as a
        negative probe.
        """
        handle = open_process(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            err = ctypes.get_last_error()
            # ERROR_INVALID_PARAMETER (87) is what we get when the pid simply
            # doesn't exist — that's the only signal we trust as "dead".
            # Anything else (ACCESS_DENIED 5, etc.) is "couldn't tell" and we
            # leave the call inconclusive.
            if err == 87:
                return False
            logger.debug(
                "OpenProcess(%d) failed with WinError %d; treating as inconclusive.",
                pid,
                err,
            )
            return None
        try:
            exit_code = wintypes.DWORD()
            if get_exit_code(handle, ctypes.byref(exit_code)):
                return exit_code.value == STILL_ACTIVE
            return None
        finally:
            close_handle(handle)

    return _probe


def _make_unix_probe():
    """Build the POSIX existence probe used by the desktop watchdog."""

    def _probe(pid: int) -> bool | None:
        """Return whether the PID exists without sending it a signal."""

        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            # Pid exists but owned by another user; treat as alive.
            return True

    return _probe


def _terminate_self() -> None:
    """Kill any subprocess descendants then hard-exit this process.

    ``os._exit`` is intentional here: the supervising desktop process is gone,
    so no caller remains to coordinate an ordinary graceful shutdown.
    """
    try:
        import psutil

        me = psutil.Process(os.getpid())
        children = me.children(recursive=True)
        for child in children:
            try:
                child.kill()
            except psutil.NoSuchProcess, psutil.AccessDenied:
                pass
    except Exception as exc:
        # Cleanup is best-effort; never block the suicide on it.
        logger.debug("Watchdog child cleanup failed: %s", exc)

    os._exit(0)


def start_parent_watchdog(
    interval_seconds: float = _DEFAULT_INTERVAL_SECONDS,
    failure_threshold: int = _DEFAULT_FAILURE_THRESHOLD,
) -> None:
    """Spawn the watchdog daemon thread if a parent pid was passed in env."""

    if interval_seconds <= 0:
        raise ValueError("Parent watchdog interval must be positive")
    if failure_threshold < 1:
        raise ValueError("Parent watchdog failure threshold must be positive")

    raw = os.environ.get(_PARENT_PID_ENV)
    if not raw:
        return
    try:
        parent_pid = int(raw.strip())
    except ValueError as exc:
        raise ValueError(f"{_PARENT_PID_ENV} must be a positive integer") from exc
    if parent_pid <= 0:
        raise ValueError(f"{_PARENT_PID_ENV} must be a positive integer")

    probe = _make_windows_probe() if sys.platform == "win32" else _make_unix_probe()

    def _run() -> None:
        logger.info(
            "Parent watchdog active (parent_pid=%d, interval=%.1fs, threshold=%d).",
            parent_pid,
            interval_seconds,
            failure_threshold,
        )
        consecutive_misses = 0
        while True:
            result = probe(parent_pid)
            if result is True:
                consecutive_misses = 0
            elif result is False:
                consecutive_misses += 1
                logger.info(
                    "Parent watchdog probe %d/%d reports parent_pid=%d missing.",
                    consecutive_misses,
                    failure_threshold,
                    parent_pid,
                )
                if consecutive_misses >= failure_threshold:
                    logger.warning(
                        "Parent process %d confirmed gone after %d consecutive misses; backend self-terminating.",
                        parent_pid,
                        consecutive_misses,
                    )
                    _terminate_self()
                    return
            # result is None (inconclusive) — don't change the counter.
            time.sleep(interval_seconds)

    threading.Thread(target=_run, name="ldaca-parent-watchdog", daemon=True).start()
