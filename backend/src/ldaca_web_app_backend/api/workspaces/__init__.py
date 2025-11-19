"""Unified workspaces API package.

Exports a single FastAPI `router` that combines core workspace endpoints
(`base.py`) and modular analysis endpoints under `analyses/`.
"""

from fastapi import APIRouter

from ...core.workspace import (
    workspace_manager,
)  # re-export for test patches expecting api.workspaces.workspace_manager
from . import base, files, lifecycle, nodes, tasks
from .analyses import (
    concordance,
    quotation,
    sequential_analysis,
    token_frequencies,
    topic_modeling,
)

# Aggregate routers. Subrouters already define their own prefixes.
router = APIRouter()
router.include_router(lifecycle.router)
router.include_router(nodes.router)
router.include_router(files.router)
router.include_router(tasks.router)
router.include_router(base.router)
router.include_router(token_frequencies.router)
router.include_router(sequential_analysis.router)
router.include_router(quotation.router)
router.include_router(concordance.router)
router.include_router(topic_modeling.router)

__all__ = ["router", "workspace_manager"]
