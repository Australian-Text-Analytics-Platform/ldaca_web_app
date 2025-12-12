# LDaCA Web App

Multi-platform text analytics application with web and desktop support.

## Project Structure

This project uses **npm workspaces** to manage multiple packages:

```text
ldaca_web_app/
├── package.json              # Root workspace (Tauri CLI, orchestration)
├── frontend/                 # React frontend workspace
│   ├── package.json          # Frontend dependencies
│   └── src/
├── backend/                  # Python FastAPI backend
│   └── pyproject.toml
└── src-tauri/                # Rust desktop wrapper
    └── Cargo.toml
```

## Quick Start

```bash
# Install all dependencies (root + frontend workspaces)
npm install

# Start frontend dev server (web only)
npm run dev

# Start desktop app in development mode
npm run desktop:dev

# Build desktop installer
npm run desktop:build
```

See [QUICKSTART.md](./QUICKSTART.md) for detailed instructions.

## Documentation

- [Workspace Setup](./WORKSPACE.md) - npm workspaces guide
- [Quick Start](./QUICKSTART.md) - Getting started guide
- [Backend Documentation](./backend/README.md)
- [Frontend Documentation](./frontend/README.md)

## TODO

- [x] Ensure analysis tabs that register background tasks also remove the corresponding task rows from the Task Center when the user clears results.
- [x] Persist and surface `metadata.task_id` on async analysis responses so the frontend can cancel/clear tasks precisely by **task id**.
