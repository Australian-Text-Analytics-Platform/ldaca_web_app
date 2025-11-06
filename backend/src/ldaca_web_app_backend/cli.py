"""
Command-line interface for LDaCA Web App Backend.
"""


def main():
    """Main entry point for the CLI."""
    import sys

    import uvicorn
    from ldaca_web_app_backend.settings import settings

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

    # Run the FastAPI app
    uvicorn.run(
        "ldaca_web_app_backend.main:app",
        host=settings.server_host,
        port=settings.backend_port,
        reload=use_reload,
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
