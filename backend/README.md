# LDaCA Wordflow Backend

FastAPI service for LDaCA Wordflow. The package can run the API by itself or
serve the bundled production frontend from the same process.

The authoritative source, issue tracker, CI, and package release workflow live
in the [LDaCA Wordflow monorepo](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow).

## Quick start

```bash
# Install and run (backend + frontend on one port)
uvx ldaca-wordflow

# Or run only the backend API
uvx ldaca-wordflow --backend

# Custom port
uvx ldaca-wordflow --port 9000
```

## Notebook and BinderHub launch

Use the asynchronous launcher when Python must retain control of the event loop,
such as a BinderHub notebook cell:

```python
from ldaca_wordflow import start_async_server

server = await start_async_server()
# The compiled web application is now ready through jupyter-server-proxy.

await server.close()
```

`start_async_server()` returns only after ASGI lifespan startup succeeds. Its
caller-owned handle supports waiting and bounded graceful shutdown. Under
JupyterHub, the launcher derives the proxy `root_path` from
`JUPYTERHUB_SERVICE_PREFIX`.

## Development

- Backend architecture: [`../docs/architecture/backend/overview.md`](../docs/architecture/backend/overview.md)
- HTTP endpoint inventory: [`../docs/reference/backend-api.md`](../docs/reference/backend-api.md)
- Settings reference: [`../docs/reference/backend-settings.md`](../docs/reference/backend-settings.md)
- Lint: `uv run ruff check .`
- Type check: `uv run ty check`
- Tests: `uv run pytest -q`
- OpenAPI export: `uv run python scripts/export_openapi.py --output <path>`
