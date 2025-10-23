# Publishing Guide for ldaca-web-app-backend

## Overview
This package is now configured to be runnable via `uvx` (Python's equivalent to `npx`).

## Package Information
- **Package name**: `ldaca-web-app-backend`
- **CLI command**: `ldaca-backend`
- **Python version**: >=3.12

## Local Testing

Test the CLI locally before publishing:

```bash
# Using uv run (within the project)
uv run ldaca-backend

# Or install locally and test
uv pip install -e .
ldaca-backend
```

## Publishing to PyPI

### 1. Prerequisites

- Create a PyPI account at https://pypi.org/account/register/
- Create an API token at https://pypi.org/manage/account/token/
- Install twine: `uv pip install twine`

### 2. Build the Package

**Note**: This project is part of a uv workspace. Build from the workspace root:

```bash
# From anywhere in the workspace
uv build --package ldaca-web-app-backend

# Or from the backend directory
cd ldaca_web_app/backend
uv build --package ldaca-web-app-backend
```

This creates distribution files in the `dist/` directory at the workspace root (`LDaCA-Text-Analytics-Tools/dist/`).

### 3. Upload to TestPyPI (Recommended First)

Test your package on TestPyPI before publishing to the real PyPI:

```bash
# Upload to TestPyPI (from workspace root where dist/ is)
cd /path/to/LDaCA-Text-Analytics-Tools
uv run twine upload --repository testpypi dist/ldaca_web_app_backend-*

# Test installation from TestPyPI
uvx --index-url https://test.pypi.org/simple/ ldaca-web-app-backend
```

### 4. Upload to PyPI (Production)

Once tested, upload to the real PyPI:

```bash
# Upload from workspace root where dist/ folder is located
cd /path/to/LDaCA-Text-Analytics-Tools
uv run twine upload dist/ldaca_web_app_backend-*
```

## Usage After Publishing

Once published to PyPI, anyone can run your backend with:

```bash
# One-time run (similar to npx)
uvx ldaca_web_app_backend

# Alternative: using the short name
uvx --from ldaca-web-app-backend ldaca-backend

# Or install globally
uv tool install ldaca-web-app-backend
ldaca_web_app_backend
# or
ldaca-backend
```

**Note**: The package provides two executables: `ldaca_web_app_backend` and `ldaca-backend` (both run the same CLI).

## Environment Configuration

Users need to set environment variables before running:

```bash
# Optional: Change data location (defaults to ~/Documents/ldaca)
export DATA_ROOT=/path/to/data

# For multi-user mode
export MULTI_USER=true
export GOOGLE_CLIENT_ID=your-google-client-id
export SECRET_KEY=your-secret-key

# Then run
uvx ldaca-web-app-backend
```

## Version Management

To publish a new version:

1. Update version in `ldaca_web_app/backend/pyproject.toml`
2. Rebuild: `uv build --package ldaca-web-app-backend`
3. Upload: `cd /path/to/LDaCA-Text-Analytics-Tools && uv run twine upload dist/ldaca_web_app_backend-*`

## Notes

- **docframe** and **docworkspace** dependencies: Make sure these are also published to PyPI, or users won't be able to install your package
- The CLI automatically creates the data directory on first run
- Default data location: `~/Documents/ldaca`
- Default server: `http://0.0.0.0:8001`

## Alternative: Private Distribution

If you don't want to publish to PyPI, you can distribute the wheel file directly:

```bash
# Build
uv build --package ldaca-web-app-backend

# The .whl file is in the workspace root dist/ folder
# Share it, and users can install with:
uvx /path/to/ldaca_web_app_backend-0.1.0-py3-none-any.whl
```

## Frontend: running the dev server with a configurable port

The frontend uses Vite. You can configure the dev server port with the `FRONTEND_PORT` environment variable.

Examples:

```bash
# Run with default port (3000)
cd ldaca_web_app/frontend
npm run dev

# Run on a custom port
FRONTEND_PORT=4000 npm run dev

# Or using npx (if you publish the frontend as a package with a `start` script):
FRONTEND_PORT=4000 npx ldaca-web-app-frontend
```

The Vite configuration now reads `process.env.FRONTEND_PORT` and falls back to `3000` when not set.
