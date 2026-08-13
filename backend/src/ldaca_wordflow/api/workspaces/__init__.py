"""Compose the Workspace resource routers exposed by the backend API."""

from fastapi import APIRouter

from . import analyses, archives, lifecycle, nodes, sql, tabs

router = APIRouter()
router.include_router(lifecycle.router)
router.include_router(archives.router)
router.include_router(analyses.router)
router.include_router(sql.router)
router.include_router(nodes.router)
router.include_router(tabs.router)

__all__ = ["router"]
