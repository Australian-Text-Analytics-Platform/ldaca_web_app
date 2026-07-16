---
status: accepted
---

# Single-process, lifespan-owned backend

Wordflow runs one ASGI process, and FastAPI lifespan owns every stateful backend
resource. Workspace slots and gates, event subscribers, scheduler queues, and
executor handles are process-local, so adding Uvicorn workers would create
competing authorities. `create_app` remains side-effect free for tests and
OpenAPI generation; supporting multiple processes later requires external
Analysis and User File Import scheduling, event transport, and distributed
Workspace locking, not another worker flag.
