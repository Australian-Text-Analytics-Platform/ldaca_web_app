"""Explicit construction and launcher entrypoints for LDaCA Wordflow."""

from __future__ import annotations

import os

# This must be set before Polars is imported. Data Blocks may contain Arrow
# extension types owned by Wordflow or by foreign producers; loading an
# unregistered extension as its storage dtype would silently discard that
# semantic identity before Parquet, SQL, and IPC can preserve it.
os.environ["POLARS_UNKNOWN_EXTENSION_TYPE_BEHAVIOR"] = "load_as_extension"

from .main import create_app
from .server_launcher import run_server, start_async_server

__all__ = ["create_app", "run_server", "start_async_server"]
