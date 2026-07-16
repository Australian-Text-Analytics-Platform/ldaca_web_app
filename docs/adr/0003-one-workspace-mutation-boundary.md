---
status: accepted
---

# One Workspace mutation boundary

`WorkspaceService` is the only authority allowed to open, close, mutate,
persist, import, or delete a Workspace. One slot and asynchronous gate exist per
Workspace ID, and a closed Workspace is never loaded implicitly. This replaces
implicit current-Workspace state, per-user residency, detached mutation paths,
and multiple writers. HTTP commands and Analysis completion therefore mutate
the same in-memory aggregate in server arrival order and publish through one
atomic persistence boundary.
