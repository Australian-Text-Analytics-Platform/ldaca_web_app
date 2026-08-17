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

wordflow_server = await start_async_server(port=8001)
proxy_path = (
    f"{os.environ['JUPYTERHUB_SERVICE_PREFIX'].rstrip('/')}"
    f"/proxy/{wordflow_server.settings.backend_port}/"
)
display(Markdown(f"[Open Wordflow]({proxy_path})"))
```

The call returns only after application lifespan startup succeeds. The link
opens `${JUPYTERHUB_SERVICE_PREFIX}proxy/8001/`, where Jupyter Server Proxy
removes the external prefix before forwarding requests. Wordflow supplies the
same prefix as the ASGI `root_path`, and the served `runtime-config.js` directs
the browser's API and health requests back through that path.

Stop the caller-owned server before rerunning the cell or leaving the notebook:

```python
await wordflow_server.close()
```

## Start From A Terminal

For a source checkout, run from the repository root:

```bash
uv run --project backend ldaca-wordflow --port 8001
```

For an isolated published release:

```bash
uvx --from 'ldaca-wordflow==<fixed-version>' ldaca-wordflow --port 8001
```

Run these blocking commands in a Jupyter terminal rather than a notebook cell,
then open `${JUPYTERHUB_SERVICE_PREFIX}proxy/8001/`. The Jupyter server
environment must already contain `jupyter-server-proxy`. Do not run the CLI and
the asynchronous notebook launcher on the same port at the same time.

## Verify The Deployment

From a terminal inside the Binder container:

```bash
curl --fail --silent http://127.0.0.1:8001/health
```

In the browser, verify the proxied Wordflow URL loads, reloads, and keeps API,
health, authentication, and event-stream requests below the same proxy prefix.
The compiled frontend must contain no fixed local API URL.

Binder storage is normally ephemeral. The default Data Root is writable for
the session; deployments requiring persistence must mount durable storage and
set `DATA_ROOT` to a directory inside that mount before launching Wordflow.
