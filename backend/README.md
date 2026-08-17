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
import os

from IPython.display import Markdown, display
from ldaca_wordflow import start_async_server

server = await start_async_server(port=8001)
proxy_path = (
    f"{os.environ['JUPYTERHUB_SERVICE_PREFIX'].rstrip('/')}"
    f"/proxy/{server.settings.backend_port}/"
)
display(Markdown(f"[Open Wordflow]({proxy_path})"))
```

`start_async_server()` returns only after ASGI lifespan startup succeeds. Its
caller-owned handle supports waiting and bounded graceful shutdown. Under
JupyterHub, the launcher derives the proxy `root_path` from
`JUPYTERHUB_SERVICE_PREFIX`. Install `ldaca-wordflow[deploy]` in the Binder
environment so `jupyter-server-proxy` is available to the Jupyter server. Do
not run this cell while a CLI-launched instance already owns the same port.

When finished, stop the caller-owned server from another cell:

```python
await server.close()
```

See the [BinderHub runbook](../docs/runbooks/binderhub.md) for image setup,
terminal launch alternatives, proxy behavior, and storage expectations.

## Development

- Backend architecture: [`../docs/architecture/backend/overview.md`](../docs/architecture/backend/overview.md)
- HTTP endpoint inventory: [`../docs/reference/backend-api.md`](../docs/reference/backend-api.md)
- Settings reference: [`../docs/reference/backend-settings.md`](../docs/reference/backend-settings.md)
- Lint: `uv run ruff check .`
- Type check: `uv run ty check`
- Tests: `uv run pytest -q`
- OpenAPI export: `uv run python scripts/export_openapi.py --output <path>`
