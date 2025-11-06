# LDaCA Text Analytics - Desktop Application

This directory contains the Tauri desktop application that bundles the LDaCA backend and frontend into a standalone native application for macOS, Windows, and Linux.

## Architecture

The desktop app consists of:

1. **Frontend**: React app (from `frontend/build`)
2. **Backend**: FastAPI server executable (from `backend/dist/ldaca_web_app_backend`)
3. **Tauri Shell**: Rust-based native wrapper that:
   - Finds an available port (8001-8010)
   - Starts the backend server
   - Opens a native window with the frontend
   - Manages the backend process lifecycle

## Prerequisites

### macOS
```bash
# Install Xcode Command Line Tools
xcode-select --install

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install dependencies
brew install imagemagick  # For icon generation
```

### Linux (Ubuntu/Debian)
```bash
# Install system dependencies
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  imagemagick

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Windows
```powershell
# Install Rust from https://rustup.rs/

# Install Microsoft C++ Build Tools
# Download from: https://visualstudio.microsoft.com/visual-cpp-build-tools/

# Install WebView2 (usually pre-installed on Windows 11)
# Download from: https://developer.microsoft.com/en-us/microsoft-edge/webview2/
```

## Building the Desktop App

### Step 1: Prepare the Backend
```bash
cd backend
bash build_executable.sh --clean
```

This creates: `backend/dist/ldaca_web_app_backend` (or `.exe` on Windows)

### Step 2: Prepare the Frontend
```bash
cd frontend
npm install
npm run build
```

This creates: `frontend/build/`

### Step 3: Generate Icons (Optional)
```bash
cd src-tauri
bash generate-icons.sh
```

This creates all required icon formats from the frontend logo.

### Step 4: Install Tauri CLI
```bash
# From the ldaca_web_app root directory
npm install
```

### Step 5: Build the Desktop App

#### Development Mode (with hot reload)
```bash
npm run tauri:dev
```

This:
- Starts the frontend dev server on port 3000
- Opens the Tauri window
- Automatically reloads on code changes

#### Production Build
```bash
npm run tauri:build
```

This creates platform-specific installers:
- **macOS**: `src-tauri/target/release/bundle/dmg/LDaCA Text Analytics_*.dmg`
- **Windows**: `src-tauri/target/release/bundle/msi/LDaCA Text Analytics_*.msi`
- **Linux**: `src-tauri/target/release/bundle/deb/ldaca-text-analytics_*.deb` or `.AppImage`

### One-Command Build (All Steps)
```bash
# From the ldaca_web_app root directory
npm run prepare:all  # Builds backend + frontend
npm run tauri:build  # Builds desktop app
```

## Port Management

The desktop app automatically finds an available port in the range 8001-8010 for the backend server. This prevents conflicts if multiple instances are running or if those ports are already in use.

The backend URL is dynamically injected into the frontend at runtime via:
```javascript
window.__BACKEND_URL__
```

## Application Structure

```
ldaca_web_app/
├── package.json              # Root package.json with Tauri scripts
├── backend/
│   └── dist/
│       └── ldaca_web_app_backend  # Bundled backend executable
├── frontend/
│   └── build/                # Production frontend build
└── src-tauri/
    ├── Cargo.toml           # Rust dependencies
    ├── tauri.conf.json      # Tauri configuration
    ├── build.rs             # Build script
    ├── src/
    │   ├── main.rs          # Main Rust code (port detection, backend management)
    │   └── lib.rs           # Tauri commands
    ├── icons/               # App icons (generated)
    └── capabilities/
        └── default.json     # Security permissions
```

## Configuration

### `tauri.conf.json` Key Settings

- **`bundle.resources`**: Includes the backend executable in the app bundle
- **`app.security.csp`**: Allows localhost connections to the backend
- **`build.frontendDist`**: Points to the frontend build directory

### Backend Environment Variables

The Tauri app sets these automatically:
- `BACKEND_PORT`: Dynamically assigned port (8001-8010)
- `LDACA_BACKEND_PORT`: Same as above (for compatibility)

You can also set:
- `LDACA_DATA_ROOT`: Custom data directory (defaults to `~/Documents/ldaca`)
- `LDACA_DEBUG`: Enable debug mode (not recommended for production)

## Troubleshooting

### Backend doesn't start
Check logs in the console. Common issues:
- Backend executable not found in bundle
- Port range exhausted (all ports 8001-8010 in use)
- Missing system dependencies

### Frontend can't connect to backend
- Check that `window.__BACKEND_URL__` is set correctly
- Verify CSP settings allow localhost connections
- Ensure backend started successfully (check console logs)

### Build errors

**macOS**:
```bash
# Clear Rust cache
cargo clean

# Clear Tauri cache
rm -rf src-tauri/target
```

**Linux**:
```bash
# Install missing dependencies
sudo apt-get install -y libwebkit2gtk-4.1-dev
```

**Windows**:
```powershell
# Reinstall WebView2
# Download from: https://developer.microsoft.com/en-us/microsoft-edge/webview2/
```

## Distribution

### macOS
- DMG installer: Drag and drop to Applications
- Notarization required for distribution (see Apple Developer docs)

### Windows
- MSI installer: Standard Windows installer
- Code signing recommended for distribution

### Linux
- DEB package: `sudo dpkg -i ldaca-text-analytics_*.deb`
- AppImage: Portable, no installation required

## Security

The app runs with the following security measures:

1. **Content Security Policy**: Restricts network access to localhost only
2. **Process Isolation**: Backend runs in a separate process
3. **Sandboxing**: Tauri provides OS-level sandboxing (where supported)

## Development Tips

### Testing without building
```bash
# Backend only
cd backend
uv run python src/ldaca_web_app_backend/cli.py

# Frontend only
cd frontend
npm start

# Full stack (manual)
# Terminal 1: Start backend
cd backend && uv run python src/ldaca_web_app_backend/cli.py

# Terminal 2: Start frontend
cd frontend && REACT_APP_BACKEND_URL=http://localhost:8001 npm start
```

### Debugging the Tauri app
```bash
# Dev mode with console
npm run tauri:dev

# Check backend logs
# Look for "Backend server started successfully" in the console
```

### Updating the backend
```bash
cd backend
bash build_executable.sh --clean
# Then rebuild the Tauri app
cd ..
npm run tauri:build
```

## Performance

- **Bundle size**: ~200-500 MB (includes Python runtime, dependencies, frontend assets)
- **Startup time**: 2-5 seconds (backend initialization)
- **Memory usage**: ~200-500 MB (backend + frontend + Tauri)

## License

Same as the main LDaCA project.
