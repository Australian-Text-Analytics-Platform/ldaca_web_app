"""Installed tokenizer catalogue route."""

from __future__ import annotations

from fastapi import APIRouter

from polars_text import TOKENIZER_MODELS

from ..models.tokenizer import TokenizerModelResource
from .responses import api_errors
from .security import CurrentSessionSecurityDep

router = APIRouter(
    prefix="/tokenizer-models",
    tags=["tokenizers"],
    responses=api_errors(401),
)


@router.get(
    "",
    response_model=list[TokenizerModelResource],
    responses=api_errors(500),
)
async def list_tokenizer_models(
    _principal: CurrentSessionSecurityDep,
) -> list[TokenizerModelResource]:
    return [
        TokenizerModelResource(
            id=model.model_id,
            label=model.label,
            languages=list(model.languages),
        )
        for model in TOKENIZER_MODELS
    ]


__all__ = ["router"]
