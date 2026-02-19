"""Public package exports for backend app entrypoints.

Used by:
- desktop/runtime launchers and external embedding contexts

Why:
- Provides stable import surface for app object and startup helpers.
"""

from .core.workspace import workspace_manager
from .deploy import start_backend, start_frontend
from .main import app

__all__ = ["app", "workspace_manager", "start_backend", "start_frontend"]
