"""Installed tokenizer catalogue route."""

from __future__ import annotations

from typing import cast

from fastapi import APIRouter

from polars_text.models import predefined_model_records

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
            id=cast(str, record["model"]),
            label=cast(str, record["label"]),
            languages=cast(list[str], record["languages"]),
        )
        for record in predefined_model_records()
    ]


__all__ = ["router"]
