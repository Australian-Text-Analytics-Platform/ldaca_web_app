# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec file for LDaCA Web App Backend
Creates a standalone executable that bundles the FastAPI server
"""

import sys
from pathlib import Path

# Get the backend root directory
backend_root = Path.cwd()
src_path = backend_root / 'src'

# Define the main application entry point
block_cipher = None

# Collect all data files and resources
datas = [
    # Sample data files
    (str(src_path / 'ldaca_web_app_backend' / 'sample_data'), 'ldaca_web_app_backend/sample_data'),
]

# Hidden imports that PyInstaller might miss
# These are dynamically imported or loaded at runtime
hiddenimports = [
    # FastAPI and dependencies
    'uvicorn',
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    
    # FastAPI routers - explicitly include all API modules
    'ldaca_web_app_backend.api.admin',
    'ldaca_web_app_backend.api.auth',
    'ldaca_web_app_backend.api.feedback',
    'ldaca_web_app_backend.api.files',
    'ldaca_web_app_backend.api.text',
    'ldaca_web_app_backend.api.users',
    'ldaca_web_app_backend.api.workspaces',
    'ldaca_web_app_backend.api.workspaces.workspace',
    'ldaca_web_app_backend.api.workspaces.node_ops',
    
    # Core modules
    'ldaca_web_app_backend.core',
    'ldaca_web_app_backend.core.docworkspace_api',
    'ldaca_web_app_backend.core.background_tasks',
    'ldaca_web_app_backend.db',
    'ldaca_web_app_backend.models',
    'ldaca_web_app_backend.settings',
    
    # SQLAlchemy and database
    'sqlalchemy',
    'sqlalchemy.ext.asyncio',
    'aiosqlite',
    
    # Pydantic
    'pydantic',
    'pydantic_settings',
    
    # Authentication
    'fastapi_users',
    'fastapi_users.db',
    'google.auth',
    'google_auth_oauthlib',
    
    # Data processing - docframe and docworkspace
    'docframe',
    'docframe.core',
    'docframe.text',
    'docworkspace',
    'docworkspace.workspace',
    'docworkspace.node',
    
    # Polars and data libraries
    'polars',
    'polars.io',
    'pyarrow',
    'pyarrow.parquet',
    
    # NLP libraries
    'nltk',
    'nltk.corpus',
    'nltk.tokenize',
    
    # Other dependencies
    'xlsxwriter',
    'pyairtable',
    'trio',
    'multipart',
    
    # Standard library modules that might be missed
    'email.mime.multipart',
    'email.mime.text',
    'email.mime.base',
]

# Analysis: scan the source code for dependencies
a = Analysis(
    ['src/ldaca_web_app_backend/cli.py'],  # Entry point script
    pathex=[str(src_path)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Exclude test modules
        'pytest',
        'pytest_asyncio',
        '_pytest',
        # Exclude Jupyter (runtime only)
        'jupyter',
        'notebook',
        'ipykernel',
        # Exclude only heavy interactive / test tooling. Do not exclude setuptools/pip/wheel as
        # PyInstaller's setuptools hook needs to inspect/alias vendored modules and can fail
        # if those names are pre-declared as excluded.
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

# PYZ: Create a compressed archive of Python bytecode
pyz = PYZ(
    a.pure,
    a.zipped_data,
    cipher=block_cipher,
)

# EXE: Create the executable
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='ldaca_web_app_backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,  # Keep console for server logging
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
