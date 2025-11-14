"""
Command-line interface for LDaCA Web App Backend.
"""

import atexit
import signal
import sys


def main():
    """Main entry point for the CLI."""
    import uvicorn
    from ldaca_web_app_backend.settings import settings

    # Setup cleanup handlers for child processes
    def cleanup_child_processes():
        """Clean up any child processes on shutdown."""
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
        """Handle shutdown signals."""
        print(f"\nReceived signal {signum}, shutting down gracefully...")
        cleanup_child_processes()
        sys.exit(0)

    # Register signal handlers for graceful shutdown
    signal.signal(signal.SIGINT, signal_handler)  # Ctrl+C
    signal.signal(signal.SIGTERM, signal_handler)  # Kill signal
    if hasattr(signal, "SIGQUIT"):
        signal.signal(signal.SIGQUIT, signal_handler)  # Quit signal (Unix only)

    # Register cleanup to run on normal exit too
    atexit.register(cleanup_child_processes)

    # Ensure data root exists
    data_root = settings.get_data_root()
    data_root.mkdir(parents=True, exist_ok=True)

    print("Starting LDaCA Web App Backend")
    print(f"Data folder: {data_root}")
    print(f"Server: http://{settings.server_host}:{settings.backend_port}")
    print(f"Multi-user mode: {settings.multi_user}")
    print()

    # Detect if running from PyInstaller bundle
    # PyInstaller sets sys.frozen = True and creates sys._MEIPASS
    is_frozen = getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS")

    # Never use reload in frozen executables - it causes port conflicts
    # and doesn't work properly with bundled code
    use_reload = settings.debug and not is_frozen

    # Import the app object directly to run uvicorn in the same process
    # Running with a string path causes uvicorn to spawn a subprocess,
    # which makes it harder to kill when Tauri terminates the parent
    from ldaca_web_app_backend.main import app as fastapi_app

    # Run the FastAPI app in-process (not as subprocess)
    uvicorn.run(
        fastapi_app,  # Pass app object directly, not string path
        host=settings.server_host,
        port=settings.backend_port,
        reload=use_reload,
        log_level="info",
    )


if __name__ == "__main__":
    # Critical: multiprocessing guard for PyInstaller frozen executables
    # When using multiprocessing with 'spawn' method, child processes
    # re-execute the main script. We must prevent them from starting
    # additional uvicorn servers.
    import multiprocessing as mp

    mp.freeze_support()  # Required for Windows frozen executables

    # Only run the server in the main process, not in worker children
    # Worker processes will have names like 'Process-1', 'Process-2', etc.
    # The main process has name 'MainProcess'
    if mp.current_process().name == "MainProcess":
        main()
    # Child processes will exit here without starting uvicorn
    # Child processes will exit here without starting uvicorn
