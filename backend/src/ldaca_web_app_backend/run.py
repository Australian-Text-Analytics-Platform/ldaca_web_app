# In-thread async FastAPI dev server (non-blocking) - Port 8001
import asyncio

import uvicorn

# Import app directly from main (same directory)
from .main import app  # assumes `app` is FastAPI instance

# # Apply nest_asyncio to allow nested event loops
# nest_asyncio.apply()

_server: uvicorn.Server | None = None
_server_task: asyncio.Task | None = None


def start_server_async(host="localhost", port=8001):
    global _server, _server_task
    if _server and getattr(_server, "started", False):
        print(f"Server already running at http://{host}:{port}")
        return _server
    config = uvicorn.Config(
        app,
        host=host,
        port=port,
        reload=False,  # in-loop reload unsupported; use reload_app()+restart_server
        log_level="info",
        timeout_keep_alive=30,
        lifespan="on",
    )
    _server = uvicorn.Server(config)
    loop = asyncio.get_running_loop()
    _server_task = loop.create_task(_server.serve())
    return _server_task


async def start_server(host="localhost", port=8001):
    # global _server, _server_task
    # if _server and getattr(_server, "started", False):
    #     print(f"Server already running at http://{host}:{port}")
    #     return _server
    # config = uvicorn.Config(
    #     app,
    #     host=host,
    #     port=port,
    #     reload=False,  # in-loop reload unsupported; use reload_app()+restart_server
    #     log_level="info",
    #     timeout_keep_alive=30,
    #     lifespan="on",
    # )
    # _server = uvicorn.Server(config)
    # _server.serve()
    raise NotImplementedError("Regular server not implemented yet.")
    uvicorn.run(
        app, host=host, port=port, reload=False, log_level="info", lifespan="on"
    )
