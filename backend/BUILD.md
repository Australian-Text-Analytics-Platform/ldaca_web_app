# Building the LDaCA Backend Executable

This directory contains the configuration for building a standalone executable of the LDaCA Web App Backend using PyInstaller.

## Prerequisites

- Python 3.12+
- uv package manager
- PyInstaller (included in dev dependencies)

## Quick Start

### 1. Install dependencies

```bash
cd ldaca_web_app/backend
uv sync --dev
```

### 2. Build the executable

```bash
bash build_executable.sh
```

Or with a clean build:

```bash
bash build_executable.sh --clean
```

### 3. Run the executable

```bash
./dist/ldaca_web_app_backend_bundle/ldaca_web_app_backend
```

The executable will:

- Create a `data` folder in the current working directory
- Start the FastAPI server on `http://localhost:8001` (configurable via environment variables)
- Print server info and configuration to the console

## Configuration

The executable respects the same environment variables as the Python version:

- `LDACA_DATA_ROOT`: Path to data directory (default: `./data`)
- `LDACA_BACKEND_PORT`: Server port (default: `8001`)
- `LDACA_SERVER_HOST`: Server host (default: `0.0.0.0`)
- `LDACA_DEBUG`: Enable debug mode (default: `false`)
- `LDACA_MULTI_USER`: Enable multi-user mode (default: `false`)

Example:

```bash
export LDACA_BACKEND_PORT=8080
export LDACA_DATA_ROOT=/path/to/data
./dist/ldaca_web_app_backend_bundle/ldaca_web_app_backend
```

## Files

- **`ldaca_web_app_backend.spec`**: PyInstaller specification file
  - Defines the entry point (`cli.py`)
  - Lists hidden imports (modules loaded dynamically)
  - Includes data files (sample data)
  - Configures exclusions (test modules, dev tools)

- **`build_executable.sh`**: Build script
  - Checks dependencies
  - Runs PyInstaller with the spec file
  - Provides build status and instructions

- **`BUILD.md`**: This file

## Build Output

After a successful build:

```text
backend/
├── build/              # Temporary build files
│   └── ldaca_web_app_backend/
├── dist/               # Final bundles
│   ├── ldaca_web_app_backend_bundle/            # ← PyInstaller one-dir bundle (recommended)
│   │   ├── ldaca_web_app_backend                #     Executable entry point
│   │   ├── ldaca_web_app_backend-<target triple> #     Copy used by Tauri sidecar (e.g. -aarch64-apple-darwin)
│   │   └── ...                                   #     Python runtime + dependencies
│   └── ldaca_web_app_backend_bundle-<target>/   # Optional per-target copy for debugging
├── ldaca_web_app_backend.spec  # PyInstaller config
└── build_executable.sh # Build script
```

## Troubleshooting

### Import errors at runtime

If the executable fails with "ModuleNotFoundError", add the missing module to `hiddenimports` in `ldaca_web_app_backend.spec`.

Example:

```python
hiddenimports = [
    # ... existing imports ...
    'missing_module_name',
]
```

Then rebuild:

```bash
bash build_executable.sh --clean
```

### Missing data files

If sample data or config files are not found, add them to `datas` in `ldaca_web_app_backend.spec`:

```python
datas = [
    # ... existing datas ...
    ('src/path/to/data', 'destination/path'),
]
```

### Large executable size

The executable bundles:

- Python runtime
- All dependencies (FastAPI, Polars, NLTK, etc.)
- Sample data files

Expected size: 200-500 MB (depending on dependencies)

To reduce size:

1. Remove unused dependencies from `pyproject.toml`
2. Exclude large libraries in the spec file if not needed
3. Consider using `--onedir` mode instead of `--onefile` (faster startup, easier debugging)

## Testing the Executable

### Basic smoke test

```bash
# Start the server
./dist/ldaca_web_app_backend_bundle/ldaca_web_app_backend &

# Wait for startup
sleep 5

# Test the health endpoint
curl http://localhost:8001/health

# Stop the server
kill %1
```

### Full test

Use the frontend to connect to the executable backend and verify all features work.

## Distribution

The executable is self-contained and can be distributed as-is. Users do not need Python or any dependencies installed.

### macOS Distribution Notes

On macOS, if distributing to other users, they may see a security warning. To fix:

```bash
xattr -cr ./dist/ldaca_web_app_backend_bundle
```

Or have users run:

```bash
xattr -d com.apple.quarantine ./dist/ldaca_web_app_backend_bundle
```

### Linux Distribution

The executable is compiled for the specific architecture (x86_64, ARM64, etc.). For multi-platform support, build on each target platform.

## Maintenance

When updating dependencies or adding new modules:

1. Update `pyproject.toml` dependencies
2. Run `uv sync`
3. Test with `uvx ldaca_web_app_backend`
4. Update `ldaca_web_app_backend.spec` if new dynamic imports are added
5. Rebuild and test the executable

## Alternative: Docker

For server deployments, consider using Docker instead of the executable:

```bash
# From the backend directory
docker build -t ldaca-backend .
docker run -p 8001:8001 -v $(pwd)/data:/app/data ldaca-backend
```

Docker provides better isolation and easier dependency management.
