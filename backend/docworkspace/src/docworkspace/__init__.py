"""docworkspace public API exports after module split.

Provides backward compatibility for original imports while exposing
serialization, analysis, and graph helpers in dedicated submodules.
"""

from .node import Node  # package exposing Node
from .workspace import Workspace  # shim -> workspace.core.Workspace

__version__ = "0.1.0"
__all__ = ["Workspace", "Node"]
