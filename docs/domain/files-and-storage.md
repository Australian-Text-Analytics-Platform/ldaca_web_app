# Files And Storage

## Storage Areas

The Data Root owns the authentication database, per-user file and Workspace
areas, Task state, Task working directories, response snapshots, and caches.
Host paths are private and never appear in public resources.

A User File is mutable import material. Adding one to a Workspace snapshots it
into an immutable Workspace-owned source, so later moves or deletion in the
user file area cannot rewrite an existing Source Data Block.

## Safety Invariants

- User-controlled paths cannot be absolute, traverse parents, use Windows
  drive/UNC syntax, pass through links/reparse points, or escape their owner.
- Uploads and archive imports are bounded independently of `Content-Length`.
- Files publish through same-filesystem temporary files and atomic replacement.
- Existing destinations are not overwritten implicitly.
- Downloads stream response-owned snapshots so concurrent source mutation
  cannot truncate an accepted response.
- Workspace archives are inspected and extracted into staging before an atomic
  install.
- Storage admission accounts for durable usage and in-flight reservations
  before large writes begin.
