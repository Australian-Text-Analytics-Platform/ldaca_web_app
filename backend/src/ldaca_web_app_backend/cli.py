"""
Command-line interface for LDaCA Web App Backend.
"""

import atexit
import signal
import sys


def main():
    """Start backend server from packaged/CLI runtime entrypoint.

    Used by:
    - `if __name__ == "__main__"` execution path in packaged and local CLI runs

    Why:
    - Coordinates startup logging, signal handling, and uvicorn app launch.

    Refactor note:
    - Function is large and handles logging/process/signal/server concerns;
        splitting into focused helpers would improve maintainability.
    """
    # Setup file logging immediately for packaged app debugging
    import os
    from datetime import datetime
    from pathlib import Path

    log_file = None
    try:
        backend_runtime = os.environ.get("LDACA_BACKEND_RUNTIME")
        if backend_runtime:
            log_dir = Path(backend_runtime) / "logs"
            log_dir.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            log_file_path = log_dir / f"cli_startup_{timestamp}.log"
            log_file = open(
                log_file_path, "w", encoding="utf-8", buffering=1
            )  # Line buffered

            # Redirect stdout/stderr to both console and file
            class TeeOutput:
                def __init__(self, file_obj, original):
                    self.file = file_obj
                    self.original = original

                def write(self, data):
                    try:
                        self.original.write(data)
                        self.original.flush()
                    except UnicodeEncodeError:
                        # Windows console may not support all Unicode characters
                        # Replace problematic characters with ASCII equivalents
                        safe_data = data.encode("ascii", "replace").decode("ascii")
                        self.original.write(safe_data)
                        self.original.flush()
                    if self.file:
                        self.file.write(data)
                        self.file.flush()

                def flush(self):
                    self.original.flush()
                    if self.file:
                        self.file.flush()

                def isatty(self):
                    # Return False for file output (no TTY colors)
                    return False

            sys.stdout = TeeOutput(log_file, sys.__stdout__)
            sys.stderr = TeeOutput(log_file, sys.__stderr__)
            print(f"[cli] Log file created: {log_file_path}", flush=True)
    except Exception as e:
        print(f"[cli] Failed to setup CLI logging: {e}", flush=True)

    print("[cli] CLI main() called", flush=True)
    import uvicorn

    print("[cli] uvicorn imported", flush=True)
    from ldaca_web_app_backend.settings import settings

    print("[cli] settings imported", flush=True)

    # Setup cleanup handlers for child processes
    def cleanup_child_processes():
        """Terminate worker pool and child processes during shutdown.

        Used by:
        - signal handlers and `atexit` cleanup registration

        Why:
        - Prevents orphaned workers when desktop shell exits.
        """
        try:
            # Shutdown worker pool if it exists
            from ldaca_web_app_backend.core.worker import get_worker_pool

            worker_pool = get_worker_pool()
            if worker_pool.is_running:
                print("Cleanup: Shutting down worker pool...")
                worker_pool.shutdown(wait=False)  # Don't wait during signal handler
        except Exception as e:
            print(f"Warning: Error during worker pool cleanup: {e}")

        # Kill any remaining child processes
        try:
            import os

            current_pid = os.getpid()
            # Get all children of this process
            try:
                import psutil

                parent = psutil.Process(current_pid)
                children = parent.children(recursive=True)
                if children:
                    print(f"Cleanup: Terminating {len(children)} child processes...")
                    for child in children:
                        try:
                            child.terminate()
                        except psutil.NoSuchProcess:
                            pass
                    # Give them a moment to terminate gracefully
                    gone, alive = psutil.wait_procs(children, timeout=1)
                    # Force kill any that didn't terminate
                    for child in alive:
                        try:
                            print(f"Cleanup: Force killing process {child.pid}")
                            child.kill()
                        except psutil.NoSuchProcess:
                            pass
            except ImportError:
                # psutil not available, try basic cleanup
                print("Warning: psutil not available for comprehensive process cleanup")
        except Exception as e:
            print(f"Warning: Error during child process cleanup: {e}")

    def signal_handler(signum, frame):
        """Handle termination signals with graceful cleanup.

        Used by:
        - SIGINT/SIGTERM/SIGQUIT registrations

        Why:
        - Ensures worker cleanup runs before process exit.
        """
        print(f"\nReceived signal {signum}, shutting down gracefully...")
        cleanup_child_processes()
        sys.exit(0)

    # Register signal handlers for graceful shutdown
    print("[cli] Registering signal handlers", flush=True)
    signal.signal(signal.SIGINT, signal_handler)  # Ctrl+C
    signal.signal(signal.SIGTERM, signal_handler)  # Kill signal
    if hasattr(signal, "SIGQUIT"):
        signal.signal(signal.SIGQUIT, signal_handler)  # Quit signal (Unix only)

    # Register cleanup to run on normal exit too
    atexit.register(cleanup_child_processes)
    print("[cli] Signal handlers registered", flush=True)

    # Ensure data root exists
    print("[cli] Getting data root", flush=True)
    data_root = settings.get_data_root()
    print(f"[cli] Creating data root: {data_root}", flush=True)
    data_root.mkdir(parents=True, exist_ok=True)
    print("[cli] Data root created", flush=True)

    print("[cli] Starting LDaCA Web App Backend", flush=True)
    print(f"[cli] Data folder: {data_root}", flush=True)
    print(
        f"[cli] Server: http://{settings.server_host}:{settings.backend_port}",
        flush=True,
    )
    print(f"[cli] Multi-user mode: {settings.multi_user}", flush=True)
    print(flush=True)

    # Detect if running from PyInstaller bundle
    # PyInstaller sets sys.frozen = True and creates sys._MEIPASS
    is_frozen = getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS")
    print(f"[cli] Is frozen: {is_frozen}", flush=True)
    print(f"[cli] Debug mode: {settings.debug}", flush=True)

    # Never use reload in frozen executables - it causes port conflicts
    # and doesn't work properly with bundled code
    use_reload = settings.debug and not is_frozen
    print(f"[cli] Use reload: {use_reload}", flush=True)

    # Import the app object directly to run uvicorn in the same process
    # Running with a string path causes uvicorn to spawn a subprocess,
    # which makes it harder to kill when Tauri terminates the parent
    print("[cli] Importing FastAPI app", flush=True)
    from ldaca_web_app_backend.main import app as fastapi_app

    print("[cli] FastAPI app imported successfully", flush=True)

    # Run the FastAPI app in-process (not as subprocess)
    print(
        f"[cli] Starting uvicorn on {settings.server_host}:{settings.backend_port}",
        flush=True,
    )
    print("[cli] Calling uvicorn.run()...", flush=True)
    try:
        uvicorn.run(
            fastapi_app,  # Pass app object directly, not string path
            host=settings.server_host,
            port=settings.backend_port,
            reload=use_reload,
            log_level="info",
        )
        print("[cli] uvicorn.run() returned (server stopped)", flush=True)
    except Exception as e:
        print(f"[cli] ERROR in uvicorn.run(): {e}", flush=True)
        import traceback

        print(f"[cli] Traceback: {traceback.format_exc()}", flush=True)
        raise


if __name__ == "__main__":
    # Critical: multiprocessing guard for PyInstaller frozen executables
    # When using multiprocessing with 'spawn' method, child processes
    # re-execute the main script. We must prevent them from starting
    # additional uvicorn servers.
    import multiprocessing as mp

    print("[cli] __main__ block executed", flush=True)
    mp.freeze_support()  # Required for Windows frozen executables
    print(f"[cli] Current process: {mp.current_process().name}", flush=True)

    # Only run the server in the main process, not in worker children
    # Worker processes will have names like 'Process-1', 'Process-2', etc.
    # The main process has name 'MainProcess'
    if mp.current_process().name == "MainProcess":
        print("[cli] Running in MainProcess, starting server", flush=True)
        main()
    else:
        print(
            f"[cli] Running in child process ({mp.current_process().name}), skipping server startup",
            flush=True,
        )
    # Child processes will exit here without starting uvicorn
