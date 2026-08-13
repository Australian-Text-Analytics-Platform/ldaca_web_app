"""Command-line interface for LDaCA Wordflow.

Usage:
    uvx ldaca-wordflow                  # Launch full app (backend + frontend)
    uvx ldaca-wordflow --backend        # Launch backend only
    uvx ldaca-wordflow --port 9000      # Custom port

The package entry point parses operator choices, loads one immutable settings
snapshot, configures process logging/watchdog behavior, and starts the server.
"""

from __future__ import annotations

import argparse


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse the installed `ldaca-wordflow` command arguments."""

    parser = argparse.ArgumentParser(
        prog="ldaca-wordflow",
        description="LDaCA Text Analytics Web Application",
    )
    parser.add_argument(
        "--backend",
        action="store_true",
        help="Launch only the backend server",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        help="Port to serve on (default: 8001)",
    )
    parser.add_argument(
        "--host",
        type=str,
        default=None,
        help="Host to bind to (default: 127.0.0.1 in single-user mode)",
    )
    parser.add_argument(
        "--multi-user",
        action="store_true",
        help=(
            "Enable multi-user mode with OAuth/OIDC login. "
            "Requires GOOGLE_CLIENT_ID, or the complete CILogon client/secret/redirect "
            "configuration, in the environment."
        ),
    )
    parser.add_argument(
        "--startup-file",
        type=str,
        default=None,
        help=argparse.SUPPRESS,
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    """Load process configuration and dispatch the selected server profile."""
    args = _parse_args(argv)

    from ._logging import setup_logging
    from .infrastructure.process_watchdog import start_parent_watchdog
    from .settings import load_settings

    cli_settings = (
        load_settings(multi_user=True) if args.multi_user else load_settings()
    )
    setup_logging(
        level=cli_settings.log_level,
        log_file=cli_settings.log_file,
        data_root=cli_settings.get_data_root(),
    )
    start_parent_watchdog()

    serve_frontend = not args.backend

    from .server_launcher import run_server

    run_server(
        serve_frontend=serve_frontend,
        port=args.port,
        host=args.host,
        settings=cli_settings,
        startup_file=args.startup_file,
    )


if __name__ == "__main__":
    # Multiprocessing guard for PyInstaller frozen executables: on Windows the
    # module is re-imported in worker processes; freeze_support() returns only
    # in the main process, so the call below is a no-op for children.
    import multiprocessing as mp

    mp.freeze_support()
    if mp.current_process().name == "MainProcess":
        main()
