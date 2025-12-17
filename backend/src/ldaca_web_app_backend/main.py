"""
Enhanced LDaCA Web App API - Main FastAPI Application
Modular, production-ready text analysis platform with multi-user support
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Import API routers
from .api.admin import router as admin_router
from .api.auth import router as auth_router
from .api.config import router as config_router
from .api.feedback import router as feedback_router
from .api.files import router as files_router
from .api.text import router as text_router
from .api.users import router as users_router
from .api.workspaces import router as workspaces_router

# Ensure DocWorkspace classes are extended with API methods (e.g., to_api_graph).
# Importing this module applies the monkey patches on startup.
from .core import docworkspace_api  # noqa: F401
from .db import cleanup_expired_sessions, init_db
from .settings import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    # Startup
    print("Starting LDaCA Web App...")
    print("=" * 50)

    # Ensure DATA_ROOT and data folders exist before DB init
    settings.get_data_root().mkdir(parents=True, exist_ok=True)
    settings.get_user_data_folder().mkdir(parents=True, exist_ok=True)
    settings.get_sample_data_folder().mkdir(parents=True, exist_ok=True)
    print(f"Sample data folder: {settings.get_sample_data_folder()}")
    settings.get_database_backup_folder().mkdir(parents=True, exist_ok=True)

    # Initialize database
    await init_db()
    await cleanup_expired_sessions()

    # Worker pool will start lazily on first task submission
    print("Worker pool configured for lazy initialization")

    print(
        f"API Documentation: http://{settings.server_host}:{settings.backend_port}/api/docs"
    )
    print(f"Health Check: http://{settings.server_host}:{settings.backend_port}/health")

    yield  # Application runs here

    # Shutdown
    print("Shutting down Enhanced LDaCA Web App API...")

    # Shutdown worker pool with timeout to prevent hanging
    try:
        from .core.worker import get_worker_pool

        worker_pool = get_worker_pool()
        if worker_pool.is_running:
            print(
                f"Shutting down worker pool ({worker_pool.active_task_count} active tasks)..."
            )
            worker_pool.shutdown(wait=True, timeout=5.0)
            print("Worker pool shutdown complete")
    except Exception as e:
        print(f"Warning: Error during worker pool shutdown: {e}")

    await cleanup_expired_sessions()


# Create FastAPI application
app = FastAPI(
    title="Enhanced LDaCA Web App API",
    version="3.0.0",
    description="Multi-user text analysis platform with workspace management and DocFrame integration",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# Setup CORS (regex + credentials from settings)
# Allow:
# - http://localhost:* and http://127.0.0.1:* for web dev/production
# - tauri://localhost and https://tauri.localhost for Tauri desktop app (v1 and v2)
# - Allow all origins via regex to ensure no blocking on desktop
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers with /api prefix
app.include_router(auth_router, prefix="/api", tags=["authentication"])
app.include_router(config_router, prefix="/api", tags=["configuration"])
app.include_router(files_router, prefix="/api", tags=["file_management"])
app.include_router(feedback_router, prefix="/api", tags=["feedback"])
app.include_router(text_router, prefix="/api", tags=["text_analysis"])
app.include_router(workspaces_router, prefix="/api", tags=["workspace_management"])
app.include_router(users_router, prefix="/api", tags=["user_management"])
app.include_router(admin_router, prefix="/api", tags=["administration"])


# =============================================================================
# ROOT ENDPOINTS
# =============================================================================


@app.get("/")
async def root():
    """API root endpoint with feature overview"""
    return {
        "message": "Enhanced LDaCA Web App API",
        "version": "3.0.0",
        "description": "Multi-user text analysis platform with workspace management",
        "features": {
            "authentication": "Google OAuth 2.0",
            "workspaces": "Multi-user workspace management with node operations",
            "file_management": "Upload, preview, download with type detection",
            "text_analysis": "DocFrame integration",
            "data_operations": "Filter, slice, transform, aggregate operations",
            "user_isolation": "Per-user data folders and workspace separation",
        },
        "endpoints": {
            "docs": "/api/docs",
            "redoc": "/api/redoc",
            "openapi": "/api/openapi.json",
            "health": "/health",
            "status": "/status",
            "auth": {
                "google": "/api/auth/google",
                "me": "/api/auth/me",
                "logout": "/api/auth/logout",
                "status": "/api/auth/status",
            },
            "files": {
                "list": "/api/files/",
                "upload": "/api/files/upload",
                "download": "/api/files/{filename}",
                "preview": "/api/files/preview",
                "info": "/api/files/{filename}/info",
                "delete": "/api/files/{filename}",
            },
            "workspaces": {
                "list": "/api/workspaces/",
                "create": "/api/workspaces/",
                "get": "/api/workspaces/{workspace_id}",
                "delete": "/api/workspaces/{workspace_id}",
                "nodes": "/api/workspaces/{workspace_id}/nodes",
                "node_data": "/api/workspaces/{workspace_id}/nodes/{node_id}/data",
            },
            "user": {"folders": "/api/user/folders", "storage": "/api/user/storage"},
            "admin": {"users": "/api/admin/users", "cleanup": "/api/admin/cleanup"},
        },
    }


@app.get("/health")
async def health_check():
    """Health check endpoint with system status"""
    return {
        "status": "healthy",
        "version": "3.0.0",
        "system": "Enhanced LDaCA Web App API",
        "database": "connected",
        "features": {
            "docframe": True,
            "docworkspace": True,
        },
        "config": {
            "data_folder": str(settings.get_data_root()),
            "debug_mode": settings.debug,
        },
    }


@app.get("/status")
async def status():
    """Detailed system status endpoint"""
    return {
        "system": "Enhanced LDaCA Web App API",
        "version": "3.0.0",
        "status": "operational",
        "components": {
            "authentication": {
                "status": "[OK] Google OAuth 2.0",
                "description": "Secure user authentication with session management",
            },
            "file_management": {
                "status": "[OK] Multi-format support",
                "description": "Upload, download, preview CSV, JSON, Parquet, Excel files",
            },
            "workspace_management": {
                "status": "[OK] Multi-user isolation",
                "description": "Per-user workspaces with DataFrame node operations",
            },
            "data_operations": {
                "status": "[OK] DataFrame manipulation",
                "description": "Filter, slice, transform, aggregate, join operations",
            },
            "text_analysis": {
                "status": "[OK] DocFrame ready",
                "description": "Advanced text analysis with DocFrame integration",
            },
            "database": {
                "status": "[OK] SQLAlchemy async",
                "description": "Async SQLAlchemy with session management",
            },
        },
        "modules": {
            "auth": "Google OAuth authentication and session management",
            "files": "File upload, download, preview, and management",
            "workspaces": "Multi-user workspace and node management",
            "users": "User folder and storage management",
            "admin": "Administrative functions and monitoring",
        },
    }


if __name__ == "__main__":
    import uvicorn

    print("Starting Enhanced LDaCA Web App API server...")

    uvicorn.run(
        app,
        host=settings.server_host,
        port=settings.backend_port,
        reload=settings.debug,
        log_level="info",
    )
