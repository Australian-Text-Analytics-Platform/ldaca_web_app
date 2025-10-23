# LDaCA Frontend

React + TypeScript frontend for the LDaCA Web Application.

## Quick Start

### Option 1: Run via npx (Recommended)

```bash
# Run production build with single command
npx ldaca_web_app_frontend
# Frontend will run on http://localhost:3000
# Backend assumed at http://localhost:8001
```

### Option 2: Local Development

```bash
# Install dependencies
npm install

# Run dev server (no .env file needed!)
npm run dev
# Frontend will run on http://localhost:3000
# Backend assumed at http://localhost:8001
```

## Environment Variables

**The frontend does NOT require a .env file** - all variables have sensible defaults.

### Why Two Types of Variables?

Vite distinguishes between:
- **Build-time variables** (`FRONTEND_PORT`) - Only available to Node.js/Vite dev server
- **Runtime variables** (`VITE_*`) - Exposed to browser code (must have `VITE_` prefix)

### Available Variables

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `FRONTEND_PORT` | Build-time | `3000` | Dev server port (Node.js side) |
| `VITE_BACKEND_PORT` | Runtime | `8001` | Backend API port (browser side) |
| `VITE_BACKEND_API_BASE` | Runtime | Auto-detected | Full backend URL override |
| `VITE_GOOGLE_CLIENT_ID` | Runtime | - | Google OAuth (multi-user mode only) |

### Usage Examples

```bash
# Custom frontend port
FRONTEND_PORT=4000 npm run dev

# Custom backend port
VITE_BACKEND_PORT=9000 npm run dev

# Both at once
FRONTEND_PORT=4000 VITE_BACKEND_PORT=9000 npm run dev

# Full backend URL (for remote backend)
VITE_BACKEND_API_BASE=https://api.example.com/api npm run dev
```

### API URL Detection Logic

The frontend automatically detects where the backend is:

1. **Explicit override**: `VITE_BACKEND_API_BASE` (if set)
2. **Custom port**: Uses `VITE_BACKEND_PORT` (default: 8001)
3. **Localhost detection**: On localhost/127.0.0.1, connects to `http://localhost:${VITE_BACKEND_PORT}/api`
4. **JupyterHub/Binder**: Handles proxied paths like `/user/<name>/proxy/8001/`
5. **Production**: Same-origin `/api`

## Development

```bash
# Install dependencies
npm install

# Run dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Type check
npm run type-check

# Lint
npm run lint
```

## Production Build

```bash
npm run build
```

Output goes to `build/` directory. Serve with any static file server:

```bash
# Using Python
python -m http.server 3000 -d build

# Using Node.js serve
npx serve build -p 3000
```

## Architecture

- **React 19** with TypeScript
- **TanStack Query v5** for server state
- **Zustand** for client state
- **XYFlow** for workspace graph visualization
- **Tailwind CSS** + **Radix UI** for styling
- **Vite** for build tooling

## Key Directories

```
src/
├── api/          # API client (axios, query functions)
├── components/   # React components
├── hooks/        # Custom React hooks
├── lib/          # Utilities
├── providers/    # Context providers
├── stores/       # Zustand stores
└── types/        # TypeScript types
```

## Notes

- The frontend expects the backend at `/api` by default
- For local development, it auto-connects to `http://localhost:8001/api`
- No .env file is required for basic development
- All environment variables are optional with sensible defaults
