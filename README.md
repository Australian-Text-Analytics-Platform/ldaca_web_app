# LDaCA Web App

Multi-platform text analytics application with web and desktop support.

## Project Structure

This project uses **npm workspaces** to manage multiple packages:

```
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
- [ ] Now because topic modeling registers a background task in the task center, the clear endpoint should also clear the corresponding task in the task center.
I also want you to modify the saved result a bit to include the task_id, and the frontend can show the task id somewhere small. And when calling the clear endpoint, it should include that task_id so that the backend knows which task to delete in the task center. Also, make the task_id.