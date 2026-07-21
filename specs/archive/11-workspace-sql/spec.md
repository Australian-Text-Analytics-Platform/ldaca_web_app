# Workspace SQL Query And Derivation Interface

Issue: [#11](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/11)

Status: completed 2026-07-20

## Accepted behavior

Wordflow exposes one Workspace-scoped SQL command at
`POST /api/workspaces/{workspace_id}/sql`.

- Query mode registers only the declared Data Blocks under their exact
  canonical UUIDs and returns one independently collected Arrow IPC page.
- Create mode adds one Derived Data Block whose ordered parents are exactly
  the declared Data Blocks and whose provenance records the submitted SQL.
- SQL is allowed except for external `read_*` and `scan_*` table functions.
- Pagination is applied after the submitted query and uses one-row lookahead.
- SQL does not replace typed preprocessing commands or identity-preserving
  Data Block Edits.
- The generic Data Block rows endpoint is removed after all frontend callers
  migrate.

## Product constraints

- No user-facing SQL editor is included.
- No cursor, result cache, long-lived response, or PyArrow dependency is added.
- Each page may recompute the submitted query.
- SQL provenance records creation history and is not a replay guarantee after
  a parent is removed.
