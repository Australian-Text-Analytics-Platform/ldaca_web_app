"""Analysis result base classes."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict


class BaseAnalysisResult(ABC):
    """Abstract base class for analysis results."""

    @abstractmethod
    def to_json(self, **kwargs: Any) -> Dict[str, Any]:
        """Convert result to JSON response, potentially handling pagination."""
        pass


class GenericAnalysisResult(BaseAnalysisResult):
    """Simple result wrapper for generic dictionary results."""

    def __init__(self, data: Dict[str, Any]):
        self.data = data

    def to_json(self, **kwargs: Any) -> Dict[str, Any]:
        return self.data
