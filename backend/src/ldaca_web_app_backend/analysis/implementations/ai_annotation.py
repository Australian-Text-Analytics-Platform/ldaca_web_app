"""AI annotation analysis request schema module.

Used by:
- ai-annotation routes and worker task request validation

Why:
- Keeps ai-annotation specific input contract centralized.
"""

from typing import Dict, List, Literal, Optional

from pydantic import Field

from ..models import BaseAnalysisRequest


class AiAnnotationClassDef(BaseAnalysisRequest):
    """Class label definition used by AI annotation prompts."""

    name: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)


class AiAnnotationExample(BaseAnalysisRequest):
    """Few-shot example mapping input text to a class label."""

    query: str = Field(..., min_length=1)
    classification: str = Field(..., min_length=1)


class AiAnnotationRequest(BaseAnalysisRequest):
    """Request model for AI annotation analysis."""

    node_ids: List[str] = Field(..., description="List of node IDs to analyze")
    node_columns: Dict[str, str] = Field(
        ..., description="Map of node_id to column name"
    )
    annotation_column: Optional[str] = Field(
        default=None,
        description="Target annotation column name. If provided, results are written to this column; otherwise a new column is created.",
    )

    classes: List[AiAnnotationClassDef] = Field(
        ..., min_length=1, description="Classification labels and descriptions"
    )
    examples: List[AiAnnotationExample] = Field(
        default_factory=list,
        description="Optional few-shot examples",
    )

    technique: Literal["zero_shot", "few_shot", "chain_of_thought"] = "zero_shot"
    modifier: Literal["no_modifier", "self_consistency"] = "no_modifier"

    provider: Literal["openai", "ollama"] = "openai"
    model: str = Field(..., min_length=1)
    api_key: Optional[str] = None
    endpoint: Optional[str] = None

    temperature: float = 1.0
    top_p: float = 1.0
    n_completions: int = 1
    seed: Optional[int] = 42
    reasoning_effort: Optional[str] = None
    enable_reasoning: bool = False
    max_reasoning_chars: int = 150

    page: int = 1
    page_size: int = 20
    sort_by: Optional[str] = None
    descending: bool = True
