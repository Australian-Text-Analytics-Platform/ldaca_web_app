"""Public exports for the node package.

Operations are provided as instance methods on ``Node`` while persistence is
handled by the dedicated ``docworkspace.node.io`` module.
"""

from .core import Node
from .io import dumps, from_dict, loads, to_dict

__all__ = ["Node", "to_dict", "from_dict", "dumps", "loads"]
