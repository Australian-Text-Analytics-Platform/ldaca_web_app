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
Workspace coordination, not another worker flag.

Independent single-process backend instances may share one mounted Data Root.
There is no Data Root startup lock. Instead, each open or closing Workspace is
owned through a non-blocking operating-system lock at
`workspaces/.locks/<workspace-id>.lock`, and deletion claims the same lock. This
permits different instances to open different Workspaces while preventing them
from concurrently loading or deleting the same Workspace. The lock coordinates
processes that see the same filesystem; it is not a distributed lock across
separately synchronized copies.

This narrower boundary does not support multiple Uvicorn workers for one app:
events, scheduler queues, execution handles, per-user open selection, and
runtime state remain lifespan-owned and process-local. Persistent lock files
are rendezvous and diagnostic artifacts only; operating-system ownership is
authoritative and ends automatically if a process terminates.
