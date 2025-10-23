# Publishing Guide for ldaca-web-app-frontend

## Overview

The frontend is configured to be runnable via `npx ldaca_web_app_frontend` - similar to how the backend works with `uvx`.

## Package Information

- **Package name**: `ldaca-web-app-frontend`
- **CLI commands**: `ldaca_web_app_frontend` and `ldaca-frontend`
- **Node version**: >=18 recommended

## Local Testing

Test the CLI locally before publishing:

```bash
# Link the package globally
npm link

# Test the command
ldaca_web_app_frontend

# Or with custom ports
FRONTEND_PORT=4000 VITE_BACKEND_PORT=9000 ldaca_web_app_frontend

# Unlink when done
npm unlink -g ldaca-web-app-frontend
```

## Publishing to npm

### 1. Prerequisites

- Create an npm account at https://www.npmjs.com/signup
- Login to npm: `npm login`

### 2. Build and Test

```bash
# Install dependencies
npm install

# Build for production (optional - validates build works)
npm run build

# Test the CLI
npm link
ldaca_web_app_frontend
```

### 3. Publish

```bash
# First time or after version bump
npm publish

# If you get an error about the package name being taken, change the name in package.json
```

## Usage After Publishing

Once published to npm, anyone can run your frontend with:

```bash
# One-time run (similar to npx)
npx ldaca_web_app_frontend

# Or use the short name
npx ldaca-web-app-frontend ldaca-frontend

# With custom ports
FRONTEND_PORT=4000 VITE_BACKEND_PORT=9000 npx ldaca_web_app_frontend

# Install globally
npm install -g ldaca-web-app-frontend
ldaca_web_app_frontend
```

## Environment Configuration

Users can set environment variables when running:

```bash
# Frontend port (default: 3000)
FRONTEND_PORT=4000 npx ldaca_web_app_frontend

# Backend port (default: 8001)
VITE_BACKEND_PORT=9000 npx ldaca_web_app_frontend

# Both together
FRONTEND_PORT=4000 VITE_BACKEND_PORT=9000 npx ldaca_web_app_frontend

# Full backend URL override
VITE_BACKEND_API_BASE=https://api.example.com/api npx ldaca_web_app_frontend

# Google OAuth (for multi-user mode)
VITE_GOOGLE_CLIENT_ID=your-client-id npx ldaca_web_app_frontend
```

## Version Management

To publish a new version:

1. Update version in `package.json`
2. Commit changes: `git commit -am "Bump version to x.y.z"`
3. Create git tag: `git tag vx.y.z`
4. Publish: `npm publish`
5. Push tags: `git push --tags`

## Complete Workflow Example

Running both backend and frontend together:

```bash
# Terminal 1: Start backend
BACKEND_PORT=9000 uvx ldaca_web_app_backend

# Terminal 2: Start frontend
FRONTEND_PORT=4000 VITE_BACKEND_PORT=9000 npx ldaca_web_app_frontend
```

Or use the default ports:

```bash
# Terminal 1: Backend on 8001
uvx ldaca_web_app_backend

# Terminal 2: Frontend on 3000
npx ldaca_web_app_frontend
```

## Notes

- The CLI automatically installs dependencies and starts the Vite dev server
- All environment variables are optional with sensible defaults
- Frontend expects backend at `http://localhost:8001/api` by default
- The package includes all source code and builds on-demand

## Alternative: Serve Pre-built Static Files

If you want users to just serve static files without dev server:

```bash
# Build first
npm run build

# Then serve with any static server
npx serve build -p 3000
```

For this use case, you might want to create a separate CLI command that serves the `build/` directory.
