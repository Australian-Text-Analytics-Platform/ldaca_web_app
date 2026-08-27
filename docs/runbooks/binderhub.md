# BinderHub Deployment Runbook

BinderHub runs Wordflow as one single-user, same-origin application. The
published Python package supplies both the FastAPI backend and compiled SPA;
do not start Vite or configure browser CORS for this profile.

## Prepare The Binder Image

Install a fixed Wordflow release in the Binder environment that runs Jupyter
Server. A standard Binder repository can place this requirement in
`binder/requirements.txt`:

```text
ldaca-wordflow[deploy]==<version-containing-the-binder-fix>
```

The `deploy` extra installs `jupyter-server-proxy` and IPython with Wordflow.
If the Jupyter server and notebook kernel use different Python environments,
install `jupyter-server-proxy` in the server environment and Wordflow in the
environment that imports or executes it. An isolated `uvx` environment does
not install an extension into an already-running Jupyter server.

Keep the default single-user profile and loopback host. JupyterHub authenticates
the proxied route, while Wordflow binds only inside the user's Binder container.

## Start From A Notebook

Run this cell once:

```python
import os

from IPython.display import Markdown, display
from ldaca_wordflow import start_async_server

PORT = 8001
ROOT_PATH = (
    f"{os.environ['JUPYTERHUB_SERVICE_PREFIX'].rstrip('/')}"
    f"/proxy/{PORT}"
)
wordflow_server = await start_async_server(
    serve_frontend=True,
    port=PORT,
    root_path=ROOT_PATH,
)
display(Markdown(f"[Open Wordflow]({ROOT_PATH}/)"))
```

The call returns only after application lifespan startup succeeds. With the
default `PORT`, the link opens `${JUPYTERHUB_SERVICE_PREFIX}proxy/8001/`. Set
`PORT = 3000` to use the corresponding `${JUPYTERHUB_SERVICE_PREFIX}proxy/3000/`
URL instead. Jupyter Server Proxy removes the external prefix before forwarding
requests. The notebook supplies the same prefix as Wordflow's generic ASGI
`root_path`, and the served `runtime-config.js` directs the router, API, health,
authentication, and event-stream requests back through that path. The backend
does not inspect `JUPYTERHUB_SERVICE_PREFIX`.

`serve_frontend=True` is the combined Binder contract: FastAPI serves the
packaged SPA and API from the same process. For backend-only source development,
use `serve_frontend=False` and run Vite separately for hot reload. The async
launcher does not start or supervise Vite.

Stop the caller-owned server before rerunning the cell or leaving the notebook:

```python
await wordflow_server.close()
```

## Start From A Terminal

For a source checkout, run from the repository root:

```bash
ROOT_PATH="${JUPYTERHUB_SERVICE_PREFIX%/}/proxy/8001"
uv run --project backend ldaca-wordflow --port 8001 --root-path "$ROOT_PATH"
```

For an isolated published release:

```bash
ROOT_PATH="${JUPYTERHUB_SERVICE_PREFIX%/}/proxy/8001"
uvx --from 'ldaca-wordflow==<fixed-version>' ldaca-wordflow \
  --port 8001 --root-path "$ROOT_PATH"
```

Run these blocking commands in a Jupyter terminal rather than a notebook cell,
then open `${JUPYTERHUB_SERVICE_PREFIX}proxy/8001/`. The Jupyter server
environment must already contain `jupyter-server-proxy`. Do not run the CLI and
the asynchronous notebook launcher on the same port at the same time.

## Verify The Deployment

From a terminal inside the Binder container:

```bash
curl --fail --silent http://127.0.0.1:8001/health/ready
```

In the browser, verify the proxied Wordflow URL loads, reloads, and keeps API,
health, authentication, and event-stream requests below the same proxy prefix.
The compiled frontend must contain no fixed local API URL.

Binder storage is normally ephemeral. Without `DATA_ROOT`, the setup screen can
use the platform-recommended session location. Deployments requiring persistence
must mount durable storage and set `DATA_ROOT` to a directory inside that mount
before launching Wordflow.
