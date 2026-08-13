"""Process-owned logging configuration for the Wordflow backend."""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from .infrastructure.storage.durable_fs import mkdir_durable

PACKAGE_LOGGER_NAME = "ldaca_wordflow"
_OWNED_HANDLER_NAME = "wordflow-bootstrap"
LogLevelName = Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
_LOG_LEVELS: dict[LogLevelName, int] = {
    "DEBUG": logging.DEBUG,
    "INFO": logging.INFO,
    "WARNING": logging.WARNING,
    "ERROR": logging.ERROR,
    "CRITICAL": logging.CRITICAL,
}


class _StructuredFormatter(logging.Formatter):
    """Emit one machine-readable JSON object per log record."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info and record.exc_info[0] is not None:
            payload["exception"] = self.formatException(record.exc_info)
        if record.stack_info:
            payload["stack_info"] = self.formatStack(record.stack_info)
        return json.dumps(payload, default=str)


class _ConsoleFormatter(logging.Formatter):
    def __init__(self) -> None:
        super().__init__(
            fmt="%(asctime)s %(levelname)-8s [%(name)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )


def _mark_owned(handler: logging.Handler) -> None:
    handler.set_name(_OWNED_HANDLER_NAME)


def _is_owned(handler: logging.Handler) -> bool:
    return handler.get_name() == _OWNED_HANDLER_NAME


def setup_logging(
    *,
    level: LogLevelName | int = "INFO",
    log_file: str | None = None,
    data_root: Path | None = None,
) -> None:
    """Replace this package's process-owned console and optional file handlers."""

    numeric_level = level if isinstance(level, int) else _LOG_LEVELS[level]
    package_logger = logging.getLogger(PACKAGE_LOGGER_NAME)
    package_logger.setLevel(numeric_level)
    package_logger.propagate = False

    for handler in list(package_logger.handlers):
        if _is_owned(handler):
            package_logger.removeHandler(handler)
            handler.close()

    console_handler = logging.StreamHandler(sys.stderr)
    console_handler.setLevel(numeric_level)
    console_handler.setFormatter(_ConsoleFormatter())
    _mark_owned(console_handler)
    package_logger.addHandler(console_handler)

    if log_file is not None:
        if data_root is None:
            raise ValueError("data_root is required when log_file is configured")
        log_path = data_root / log_file
        mkdir_durable(log_path.parent)
        file_handler = logging.FileHandler(log_path, encoding="utf-8")
        file_handler.setLevel(numeric_level)
        file_handler.setFormatter(_StructuredFormatter())
        _mark_owned(file_handler)
        package_logger.addHandler(file_handler)

    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(name).setLevel(numeric_level)


__all__ = ["PACKAGE_LOGGER_NAME", "setup_logging"]
