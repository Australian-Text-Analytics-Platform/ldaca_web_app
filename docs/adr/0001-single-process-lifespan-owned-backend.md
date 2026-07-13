---
status: accepted
---

# Single-process, lifespan-owned backend

Wordflow runs one ASGI process, and FastAPI lifespan owns every stateful backend
resource. Workspace residency, per-user mutation gates, Task subscribers, and
executor handles are process-local, so adding Uvicorn workers would create
competing authorities. `create_app` remains side-effect free for tests and
OpenAPI generation; supporting multiple processes later requires external Task
coordination and distributed Workspace locking, not another worker flag.
