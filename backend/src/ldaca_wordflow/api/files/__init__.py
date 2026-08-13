"""Aggregate the canonical User File resource routes."""

from fastapi import APIRouter

from ..responses import api_errors
from . import crud, preview

router = APIRouter(tags=["user-files"])
router.include_router(
    crud.router,
    prefix="/user-files",
    responses=api_errors(401),
)
router.include_router(
    preview.router,
    prefix="/user-files",
    responses=api_errors(401),
)
