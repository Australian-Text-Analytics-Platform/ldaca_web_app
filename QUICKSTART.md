# Quick Start Guide - Desktop App

## Prerequisites Check

```bash
# Check if Rust is installed
cargo --version

# Check if npm is installed  
npm --version

# Check if backend is built
ls backend/dist/ldaca_web_app_backend*

# Check if frontend is built
ls frontend/build/index.html
```

## Step 1: Install Dependencies (npm Workspaces)

This project uses **npm workspaces** to manage dependencies for both the root and frontend:

```bash
# From the ldaca_web_app directory - installs all workspace dependencies
npm install
```

This single command installs:
- Root dependencies (Tauri CLI)
- Frontend workspace dependencies (React, Vite, etc.)

## Step 2: Try Development Mode

### Option A: Frontend Only (Web)

```bash
# Start frontend dev server on port 3000
npm run dev
```

### Option B: Desktop App (Recommended)

```bash
# Build frontend + launch desktop app with hot reload
npm run desktop:dev
```

This will:
1. Build the frontend
2. Launch the Tauri window
3. Auto-start the backend

## Step 3: Build Production App

```bash
# Build everything and create desktop installer
npm run desktop:build
```

Or step by step:

```bash
# 1. Build backend and frontend
npm run prepare:all

# 2. Build desktop app
npm run tauri:build
```

The installer will be in:
- macOS: `src-tauri/target/release/bundle/dmg/`
- Windows: `src-tauri/target/release/bundle/msi/`
- Linux: `src-tauri/target/release/bundle/deb/` or `appimage/`

## Workspace Commands Reference

All commands should be run from the **root directory** (`ldaca_web_app/`):

```bash
# Frontend development
npm run dev                    # Start frontend dev server
npm run build                  # Build frontend for production
npm run test                   # Run frontend tests

# Desktop development  
npm run desktop:dev            # Build frontend + start desktop (dev)
npm run desktop:build          # Build everything + create installer

# Workspace-specific commands
npm run -w frontend <script>   # Run any frontend script
npm run -w frontend dev        # Alternative way to start frontend
npm run -w frontend lint       # Lint frontend code

# Build preparation
npm run prepare:backend        # Build Python backend
npm run prepare:frontend       # Build React frontend
npm run prepare:all            # Build both

# Utilities
npm run clean                  # Clean all build artifacts
npm ls --workspaces           # List workspace dependencies
```

## Troubleshooting

### "Backend executable not found"

Build the backend first:
```bash
cd backend
bash build_executable.sh --clean
```

### "Frontend build not found"

Build the frontend first:
```bash
cd frontend
npm install
npm run build
```

### "Cannot find module '@tauri-apps/cli'"

Install npm dependencies:
```bash
npm install
```

### Port already in use

The app will automatically try ports 8001-8010. If all are in use, close some applications and try again.

## Full Build Script

```bash
#!/usr/bin/env bash
# Build everything from scratch

cd "$(dirname "$0")"

# Build backend
echo "Building backend..."
cd backend
bash build_executable.sh --clean
cd ..

# Build frontend
echo "Building frontend..."
cd frontend
npm install
npm run build
cd ..

# Build desktop app
echo "Building desktop app..."
npm install
npm run tauri:build

echo "✅ Build complete!"
echo "Installer location:"
if [ "$(uname)" == "Darwin" ]; then
    echo "  src-tauri/target/release/bundle/dmg/"
elif [ "$(expr substr $(uname -s) 1 5)" == "Linux" ]; then
    echo "  src-tauri/target/release/bundle/deb/"
else
    echo "  src-tauri/target/release/bundle/msi/"
fi
```

Save this as `build-all.sh` and run:
```bash
chmod +x build-all.sh
./build-all.sh
```
