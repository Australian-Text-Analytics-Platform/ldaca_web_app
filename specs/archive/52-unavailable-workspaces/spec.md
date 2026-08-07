# Unavailable Workspaces

Issue: [#52](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/52)

## Accepted behavior

- An **Unavailable Workspace** is an owned, discoverable Workspace that cannot
  currently open because its native format is incompatible, its snapshot is
  corrupt, or it exceeds configured deployment limits.
- `GET /api/workspaces` returns a discriminated catalogue containing available
  Workspace resources and safely attributable unavailable entries.
- An unavailable entry exposes only its canonical UUID, a safe reason and
  message, and stored/supported schema versions for incompatible formats.
- Foreign-owned, unattributable, unsafely named, staging, trash, and non-UUID
  entries remain hidden.
- The Data Loader shows available Workspaces first and unavailable Workspaces
  last. Unavailable cards disable Load and Download, preserve ownership-checked
  Delete, and expose no name, timestamps, description, or Data Block count.
- Available Workspace load failures remain transient, per-Workspace feedback.
  Workspace Load and Unload operations are globally serialized.

## Compatibility boundary

Native Workspace schema 15 and portable archive format 14 remain strict
cutovers. Catalogue discovery classifies older native schemas without migrating
or reconstructing them. Create, get, open, update, import, and archive contracts
remain unchanged.

## Non-goals

- Migrating or repairing unavailable Workspaces.
- Providing a raw backup or recovery export.
- Exposing rejected names, descriptions, timestamps, or Data Block counts.
- Changing direct-access or portable archive behavior.
- Recording a durable architecture decision for this reversible presentation
  policy.
