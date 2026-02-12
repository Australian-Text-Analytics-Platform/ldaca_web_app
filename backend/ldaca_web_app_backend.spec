# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec file for LDaCA Web App Backend
Creates a standalone executable that bundles the FastAPI server
"""

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

# Get the backend root directory
backend_root = Path.cwd()
src_path = backend_root / 'src'

# Define the main application entry point
block_cipher = None

# Collect all data files and resources
datas = [
    # Packaged resources (sample data, configs, stopwords)
    (
        str(src_path / 'ldaca_web_app_backend' / 'resources'),
        'ldaca_web_app_backend/resources',
    ),
]

# Hidden imports that PyInstaller might miss
# These are dynamically imported or loaded at runtime
api_modules = collect_submodules('ldaca_web_app_backend.api')
core_modules = collect_submodules('ldaca_web_app_backend.core')

base_hiddenimports = [
    # Uvicorn internals loaded lazily by FastAPI
    'uvicorn.logging',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',

    # Authentication dependencies
    'fastapi_users.authentication',
    'fastapi_users.db',
    'google.auth.transport.requests',
    'google.oauth2.id_token',

    # Docworkspace integration
    'docworkspace',
    'docworkspace.workspace',
    'docworkspace.node',
    
    # Database driver for SQLAlchemy async sqlite (loaded via URL string)
    'aiosqlite',
    'sqlalchemy.dialects.sqlite.aiosqlite',

    # Process utilities used for cleanup in CLI
    'psutil',

    # Standard library helpers referenced dynamically
    'email.mime.multipart',
    'email.mime.text',
    'email.mime.base',
]

hiddenimports = sorted(set(base_hiddenimports + api_modules + core_modules))

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

# EXE: Create the executable (one-directory mode)
exe = EXE(
    pyz,
    a.scripts,
    [],
    [],
    [],
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
    exclude_binaries=True,
)

# COLLECT: bundle the Python runtime, libraries, and resources alongside the executable
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='ldaca_web_app_backend_bundle',
)
