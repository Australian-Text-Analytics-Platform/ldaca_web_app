---
status: accepted
---

# One Workspace mutation boundary

`WorkspaceService` is the only authority allowed to load, make resident,
mutate, persist, import, or delete a Workspace. All writes for one user pass
through one gate, while non-resident targets use detached transactions without
changing residency. This replaces implicit current-Workspace state and
multiple write paths, ensuring optimistic Revisions, Task completions, archive
installs, and HTTP mutations share one serialization contract.
