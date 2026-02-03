"""Workspace subpackage public exports.

Exports the :class:`Workspace` core class plus helper free functions for
serialization, analysis, and graph views so internal relative imports
(`from .workspace import Workspace`) keep working after the split.
"""

from .analysis import info, summary  # noqa: F401
from .core import Workspace  # noqa: F401
from .graph_views import graph, visualize_graph  # noqa: F401
from .io import deserialize_workspace, serialize_workspace  # noqa: F401

__all__ = [
    "Workspace",
    "serialize_workspace",
    "deserialize_workspace",
    "summary",
    "info",
    "graph",
    "visualize_graph",
]
