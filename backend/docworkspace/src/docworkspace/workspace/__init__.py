"""Workspace subpackage public exports.

Exports the :class:`Workspace` core class plus helper free functions for
analysis and graph views so internal relative imports
(`from .workspace import Workspace`) keep working after the split.
"""

from .analysis import graph_json  # noqa: F401
from .analysis import info_json  # noqa: F401
from .core import Workspace  # noqa: F401

__all__ = [
    "Workspace",
    "info_json",
    "graph_json",
]
