"""Public exports for node package.

Operations are now provided purely as instance methods on ``Node``:
        node.filter(...), node.select(...), node.join(...)
The former functional helpers have been removed to reduce duplication.
"""

from .core import Node

__all__ = ["Node"]
