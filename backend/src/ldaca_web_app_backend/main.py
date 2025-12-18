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


def _configure_nltk_data_path() -> None:
    """Configure NLTK data path for bundled runtime, with proper Windows path handling."""
    print("[main] Starting NLTK data path configuration...", flush=True)
    try:
        import nltk
        print("[main] NLTK imported successfully", flush=True)
        
        # Check if running in bundled desktop app
        backend_runtime = os.environ.get("LDACA_BACKEND_RUNTIME")
        print(f"[main] LDACA_BACKEND_RUNTIME={backend_runtime}", flush=True)
        if not backend_runtime:
            print("[main] Not running in bundled app, skipping NLTK path config", flush=True)
            return
        
        try:
            runtime_path = Path(backend_runtime)
            print(f"[main] Runtime path: {runtime_path}", flush=True)
            
            # Look for nltk_data in the bundled Python directory
            possible_locations = [
                runtime_path / "python" / "nltk_data",
                runtime_path / "nltk_data",
            ]
            print(f"[main] Checking {len(possible_locations)} possible NLTK data locations", flush=True)
            
            for nltk_data_dir in possible_locations:
                try:
                    print(f"[main] Checking: {nltk_data_dir}", flush=True)
                    if not nltk_data_dir.exists():
                        print(f"[main] Does not exist: {nltk_data_dir}", flush=True)
                        continue
                    print(f"[main] Found: {nltk_data_dir}", flush=True)
                    
                    # Convert to string path - avoid absolute() on Windows as it can be slow
                    abs_path = str(nltk_data_dir)
                    
                    # On Windows, normalize the path and remove UNC prefix
                    if sys.platform == "win32":
                        print(f"[main] Normalizing path for Windows: {abs_path}", flush=True)
                        # Remove UNC prefix (\\?\) which causes issues with NLTK
                        if abs_path.startswith("\\\\?\\"):
                            abs_path = abs_path[4:]
                            print(f"[main] Removed UNC prefix: {abs_path}", flush=True)
                        abs_path = os.path.normpath(abs_path)
                        print(f"[main] Normalized to: {abs_path}", flush=True)
                    
                    # Prepend to NLTK data path (highest priority)
                    if abs_path not in nltk.data.path:
                        print(f"[main] Adding to nltk.data.path: {abs_path}", flush=True)
                        nltk.data.path.insert(0, abs_path)
                        print(f"[main] SUCCESS: Configured NLTK data path: {abs_path}", flush=True)
                    else:
                        print(f"[main] Path already in nltk.data.path: {abs_path}", flush=True)
                    break
                except Exception as e:
                    # If this location fails, try the next one
                    import traceback
                    print(f"[main] WARNING: Failed to configure {nltk_data_dir}: {e}", flush=True)
                    print(f"[main] Traceback: {traceback.format_exc()}", flush=True)
                    continue
            else:
                print("[main] WARNING: No bundled nltk_data found, will use system defaults", flush=True)
        
        except Exception as e:
            import traceback
            print(f"[main] WARNING: Error accessing runtime path: {e}", flush=True)
            print(f"[main] Traceback: {traceback.format_exc()}", flush=True)
        
    except ImportError as e:
        # NLTK not available, skip configuration
        print(f"[main] NLTK not available: {e}", flush=True)
        pass
    except Exception as e:
        # Catch any other errors to prevent startup failure
        import traceback
        print(f"[main] WARNING: Unexpected error configuring NLTK data path: {e}", flush=True)
        print(f"[main] Traceback: {traceback.format_exc()}", flush=True)
    
    print("[main] NLTK data path configuration complete", flush=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
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
            import sys
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
                        safe_data = data.encode('ascii', 'replace').decode('ascii')
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
    print("="*70, flush=True)
    print("[main] Starting LDaCA Web App...", flush=True)
    print(f"[main] Platform: {sys.platform}", flush=True)
    print(f"[main] Python version: {sys.version}", flush=True)
    print("="*70, flush=True)
    
    # Configure NLTK data path for bundled runtime
    print("[main] Step 1: Configuring NLTK data path", flush=True)
    _configure_nltk_data_path()
    print("[main] Step 1 complete", flush=True)

    # Ensure DATA_ROOT and data folders exist before DB init
    print("[main] Step 2: Creating data folders", flush=True)
    settings.get_data_root().mkdir(parents=True, exist_ok=True)
    settings.get_user_data_folder().mkdir(parents=True, exist_ok=True)
    settings.get_sample_data_folder().mkdir(parents=True, exist_ok=True)
    print(f"[main] Sample data folder: {settings.get_sample_data_folder()}", flush=True)
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

    print("="*70, flush=True)
    print(f"[main] SUCCESS: Backend startup complete!", flush=True)
    print(
        f"[main] API Documentation: http://{settings.server_host}:{settings.backend_port}/api/docs"
    )
    print(f"[main] Health Check: http://{settings.server_host}:{settings.backend_port}/health", flush=True)
    print("="*70, flush=True)

    yield  # Application runs here

    # Shutdown
    print("[main] Shutting down Enhanced LDaCA Web App API...", flush=True)
    
    # Close log file if it was opened
    if log_file:
        try:
            log_file.close()
        except Exception:
            pass

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
