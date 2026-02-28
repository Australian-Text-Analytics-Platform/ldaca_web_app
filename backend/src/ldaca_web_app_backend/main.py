"""
Enhanced LDaCA Web App API - Main FastAPI Application
Modular, production-ready text analysis platform with multi-user support
"""

import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Import API routers
from .api.admin import router as admin_router
from .api.auth import router as auth_router
from .api.config import router as config_router
from .api.feedback import router as feedback_router
from .api.files import router as files_router
from .api.tasks import router as tasks_router
from .api.text import router as text_router
from .api.workspaces import router as workspaces_router

# Ensure DocWorkspace API conversion utilities are available at startup.
# Note: this import no longer auto-applies monkey patches; extension hooks are
# explicit in `core.docworkspace_data_types`.
from .core import docworkspace_data_types  # noqa: F401
from .db import cleanup_expired_sessions, init_db
from .settings import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage startup/shutdown lifecycle for backend runtime dependencies.

    Used by:
    - FastAPI app lifecycle hooks

    Why:
    - Initializes data folders/DB/session cleanup and performs safe worker shutdown.
    """
    # Setup file logging for packaged app (especially Windows)
    log_file = None
    try:
        from datetime import datetime

        # Log to a file in the runtime directory for debugging packaged apps
        backend_runtime = os.environ.get("LDACA_BACKEND_RUNTIME")
        if backend_runtime:
            log_dir = Path(backend_runtime) / "logs"
            log_dir.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            log_file_path = log_dir / f"backend_startup_{timestamp}.log"
            log_file = open(log_file_path, "w", encoding="utf-8")

            # Redirect stdout and stderr to both console and file
            class TeeOutput:
                def __init__(self, file_obj, original):
                    self.file = file_obj
                    self.original = original

                def write(self, data):
                    try:
                        self.original.write(data)
                        self.original.flush()
                    except UnicodeEncodeError:
                        # Windows console may not support all Unicode characters
                        # Replace problematic characters with ASCII equivalents
                        safe_data = data.encode("ascii", "replace").decode("ascii")
                        self.original.write(safe_data)
                        self.original.flush()
                    if self.file:
                        self.file.write(data)
                        self.file.flush()

                def flush(self):
                    self.original.flush()
                    if self.file:
                        self.file.flush()

                def isatty(self):
                    # Return False for file output (no TTY colors)
                    return False

            sys.stdout = TeeOutput(log_file, sys.__stdout__)
            sys.stderr = TeeOutput(log_file, sys.__stderr__)
            print(f"[main] Log file created: {log_file_path}", flush=True)
    except Exception as e:
        print(f"[main] Failed to setup file logging: {e}", flush=True)

    # Startup
    print("=" * 70, flush=True)
    print("[main] Starting LDaCA Web App...", flush=True)
    print(f"[main] Platform: {sys.platform}", flush=True)
    print(f"[main] Python version: {sys.version}", flush=True)
    print("=" * 70, flush=True)

    print("[main] Step 1: Preparing runtime", flush=True)
    print("[main] Step 1 complete", flush=True)

    # Ensure DATA_ROOT and data folders exist before DB init
    print("[main] Step 2: Creating data folders", flush=True)
    settings.get_data_root().mkdir(parents=True, exist_ok=True)
    settings.get_user_data_folder().mkdir(parents=True, exist_ok=True)
    sample_override = settings.get_sample_data_folder()
    if sample_override:
        sample_override.mkdir(parents=True, exist_ok=True)
        print(f"[main] Sample data folder: {sample_override}", flush=True)
    else:
        print("[main] Sample data folder: packaged resources", flush=True)
    settings.get_database_backup_folder().mkdir(parents=True, exist_ok=True)
    print("[main] Step 2 complete", flush=True)

    # Initialize database
    print("[main] Step 3: Initializing database", flush=True)
    await init_db()
    print("[main] Step 3a: Database initialized", flush=True)
    await cleanup_expired_sessions()
    print("[main] Step 3 complete", flush=True)

    # Worker pool will start lazily on first task submission
    print("[main] Step 4: Configuring worker pool", flush=True)
    print("[main] Worker pool configured for lazy initialization", flush=True)
    print("[main] Step 4 complete", flush=True)

    print("=" * 70, flush=True)
    print("[main] SUCCESS: Backend startup complete!", flush=True)
    print(
        f"[main] API Documentation: http://{settings.server_host}:{settings.backend_port}/api/docs"
    )
    print(
        f"[main] Health Check: http://{settings.server_host}:{settings.backend_port}/health",
        flush=True,
    )
    print("=" * 70, flush=True)

    yield  # Application runs here

    # Shutdown
    print("[main] Shutting down Enhanced LDaCA Web App API...", flush=True)

    # Close log file if it was opened
    if log_file:
        try:
            log_file.close()
        except Exception as exc:
            print(f"[main] Failed to close startup log file cleanly: {exc}", flush=True)

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
    description="Multi-user text analysis platform with workspace management and polars-text integration",
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
app.include_router(tasks_router, prefix="/api", tags=["task_streaming"])
app.include_router(feedback_router, prefix="/api", tags=["feedback"])
app.include_router(text_router, prefix="/api", tags=["text_analysis"])
app.include_router(workspaces_router, prefix="/api", tags=["workspace_management"])
app.include_router(admin_router, prefix="/api", tags=["administration"])


# =============================================================================
# ROOT ENDPOINTS
# =============================================================================


@app.get("/")
async def root():
    """Return API feature/index metadata.

    Used by:
    - browser/manual root checks and basic service discovery

    Why:
    - Provides a human-readable entrypoint summary for backend capabilities.
    """
    return {
        "message": "Enhanced LDaCA Web App API",
        "version": "3.0.0",
        "description": "Multi-user text analysis platform with workspace management",
        "features": {
            "authentication": "Google OAuth 2.0",
            "workspaces": "Multi-user workspace management with node operations",
            "file_management": "Upload, preview, download with type detection",
            "text_analysis": "polars-text integration",
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
                "create": "/api/workspaces/",
                "current": "/api/workspaces/current",
                "info": "/api/workspaces/info",
                "delete": "/api/workspaces/delete",
                "nodes": "/api/workspaces/nodes",
                "node_data": "/api/workspaces/nodes/{node_id}/data",
                "save": "/api/workspaces/save",
                "save_as": "/api/workspaces/save-as",
                "unload": "/api/workspaces/unload",
            },
            "admin": {"users": "/api/admin/users", "cleanup": "/api/admin/cleanup"},
        },
    }


@app.get("/health")
async def health_check():
    """Return lightweight health status for liveness probes.

    Used by:
    - deployment health checks and uptime monitors

    Why:
    - Gives a fast no-auth probe endpoint for runtime readiness checks.
    """
    return {
        "status": "healthy",
        "version": "3.0.0",
        "system": "Enhanced LDaCA Web App API",
        "database": "connected",
        "features": {
            "polars-text": True,
            "docworkspace": True,
        },
        "config": {
            "data_folder": str(settings.get_data_root()),
            "debug_mode": settings.debug,
        },
    }


@app.get("/status")
async def status():
    """Return detailed component/module status information.

    Used by:
    - diagnostics pages and manual troubleshooting

    Why:
    - Exposes richer operational metadata than `/health`.
    """
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
                "status": "[OK] polars-text ready",
                "description": "Advanced text analysis with polars-text integration",
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
