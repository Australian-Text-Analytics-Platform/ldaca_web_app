"""Private process-local identities for User File Import execution."""

from dataclasses import dataclass


class UserFileImportSchedulingStopped(RuntimeError):
    """The process-local scheduler no longer accepts durable imports."""


@dataclass(frozen=True, slots=True)
class UserFileImportKey:
    user_id: str
    import_id: str


__all__ = ["UserFileImportKey", "UserFileImportSchedulingStopped"]
