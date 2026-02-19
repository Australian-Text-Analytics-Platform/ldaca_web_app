"""Analysis result base classes."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict


class BaseAnalysisResult(ABC):
    """Abstract base class for analysis results."""

    @abstractmethod
    def to_json(self, **kwargs: Any) -> Dict[str, Any]:
        """Convert result to API-ready JSON payload.

        Used by:
        - analysis routes when returning stored task results

        Why:
        - Keeps response serialization polymorphic across result types.
        """
        pass


class GenericAnalysisResult(BaseAnalysisResult):
    """Simple result wrapper for generic dictionary results."""

    def __init__(self, data: Dict[str, Any]):
        self.data = data

    def to_json(self, **kwargs: Any) -> Dict[str, Any]:
        """Return wrapped dictionary payload without transformation.

        Used by:
        - worker result persistence for generic analysis outputs

        Why:
        - Provides a lightweight default result adapter.
        """
        return self.data
