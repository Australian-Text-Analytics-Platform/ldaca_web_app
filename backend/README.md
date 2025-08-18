# LDaCA Web App Backend

FastAPI backend for the Language Data Commons of Australia platform. Provides authenticated multi‑user access to text analysis, workspace management, file handling, and integration with the `docframe` / `docworkspace` libraries.

## Features

- FastAPI with modular routers (admin, auth, users, files, text, workspaces)
- Async SQLite (aiosqlite / SQLAlchemy) with migration scripts
- Google OAuth (optional) or single-user mode
- Token-based auth (FastAPI Users)
- Document & workspace operations backed by `docframe` and `docworkspace`
- CORS + configurable settings via environment variables
- Structured project layout with tests and scripts

## Project Layout (current)

```text
backend/
  api/                # Route modules (routers)
  core/               # Core logic (workspace API glue, auth helpers, utils)
  models/             # (Placeholder for DB / Pydantic models)
  scripts/            # Utility scripts (empty / to be populated)
  tests/              # Test suite (unit/integration)
  config.py           # Settings (Pydantic Settings)
  db.py               # DB initialization & session helpers
  init_db.py          # Initialize database script
  migrate_db.py       # Migration script (if applicable)
  inline.py           # Inline execution helpers / ad-hoc tasks
  main.py             # FastAPI app entrypoint
  .env(.example)      # Environment configuration
  data/               # Runtime data (SQLite DB, backups, user files)
```

## Environment Variables

Key variables (see `.env`):

| Variable | Purpose | Default / Example |
|----------|---------|-------------------|
| DATABASE_URL | Async DB URL | `sqlite+aiosqlite:///./data/users.db` |
| DATABASE_BACKUP_FOLDER | DB backup dir | `./data/backups` |
| USER_DATA_FOLDER | Root for user data | `./data` |
| SAMPLE_DATA_FOLDER | Sample datasets | `./data/sample_data` |
| SERVER_HOST / SERVER_PORT | Bind interface / port | `0.0.0.0` / `8001` |
| DEBUG | Enable debug mode | `false` |
| CORS_ALLOWED_ORIGINS_STR | CSV origins | `http://localhost:3000,...` |
| MULTI_USER | Enable OAuth multi-user | `false` |
| SINGLE_USER_* | Single-user identity | `root`, etc. |
| TOKEN_EXPIRE_HOURS | Auth token lifetime | `24` |
| SECRET_KEY | JWT / crypto secret | (set in prod) |
| LOG_LEVEL | Logging verbosity | `INFO` |
| ONI_API_KEY | External API key (example) | (set) |

Create your own `.env` based on `.env.example`.

## Data & Storage Convention

- Single configurable root (`USER_DATA_FOLDER`) containing:
  - `uploads/` (raw) | `workspaces/` (per user/project) | `exports/` | `cache/` | `backups/` | `tmp/`
- Do not commit `data/` (ensure in `.gitignore`).
- Access paths through utility helpers (planned: a storage service) to ease future S3 / GCS migration.

## Quick Start (Development)

```bash
# Install (editable) with uv
uv pip install -e .

# Run server
uv run uvicorn main:app --reload --port 8001

# Open interactive docs
# http://localhost:8001/docs  (Swagger)
# http://localhost:8001/redoc
```

If you restructure into an `app/` package later, adjust the run command accordingly (e.g., `uvicorn app.main:app`).

## Running Tests

```bash
uv run pytest -q              # All tests
uv run pytest -m unit         # Unit tests only
uv run pytest -m integration  # Integration tests
```

Add markers in test functions/classes as needed.

## Linting & Formatting (Recommended)

Add (future) tools:

```bash
uv pip install ruff black mypy
ruff check .
black .
```

## API Routers (Current)

| Module | Endpoint Prefix | Responsibility |
|--------|------------------|----------------|
| `api.auth` | `/auth` | Authentication & tokens |
| `api.users` | `/users` | User operations |
| `api.files` | `/files` | Uploads / downloads |
| `api.text` | `/text` | Text analysis endpoints |
| `api.workspaces` | `/workspaces` | Workspace CRUD & graph |
| `api.admin` | `/admin` | Admin / diagnostics |

Routers are assembled in `main.py`. Consider adding a `api/router.py` aggregator when versioning (`/api/v1`).

## Configuration Pattern

`config.py` uses Pydantic Settings. Recommended enhancements:

- Add `class Settings(BaseSettings): ...` with nested models (SecuritySettings, StorageSettings)
- Enable `.env` override only in dev: `env_file = ".env" if DEV else None`

## Security Notes

- Replace placeholder `SECRET_KEY` before production.
- Enforce HTTPS termination at reverse proxy (e.g., nginx / Traefik)
- Restrict CORS origins precisely in prod.
- Rotate tokens by lowering `TOKEN_EXPIRE_HOURS` and refreshing via silent endpoint.

## Suggested Future Refactor (Roadmap)

1. Introduce `app/` package with `api/v1/`, `services/`, `db/`, `repositories/`.
2. Abstract storage (LocalStorage → S3) behind interface.
3. Add Alembic migrations (`alembic/` dir) for DB evolution.
4. Add structured logging (JSON) & correlation IDs.
5. Add background task queue (e.g., `arq` / `rq` / `celery`) for long-running text analytics.
6. Add rate limiting (e.g., `slowapi`) & request metrics (Prometheus).

## Deployment

Basic production run command (example):

```bash
uv run uvicorn main:app --host 0.0.0.0 --port 8001 --workers 4
```

Container best practices:

- Run as non-root user
- Mount persistent volume to `/app/data`
- Inject secrets via environment / secret manager (not baked into image)

## Health & Observability

Add endpoints / middleware (future):

- `/healthz` (lightweight DB / cache ping)
- `/metrics` (Prometheus)
- Structured logging with request ID injection

## Contributing

1. Fork & create feature branch
2. Add / update tests
3. Run test suite & linters
4. Open PR with concise description & checklist

## License

Add an explicit license file (e.g., Apache-2.0 or MIT) at repository root if not already defined.

---
For any clarifications or to automate the refactor into the proposed structure, open an issue or request a restructuring task.
