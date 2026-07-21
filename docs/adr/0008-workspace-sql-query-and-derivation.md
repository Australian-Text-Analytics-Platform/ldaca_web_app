---
status: accepted
---

# Workspace SQL query and derivation

Wordflow exposes one Workspace-scoped SQL command for stateless tabular queries
and Derived Data Block creation. Each request declares a non-empty ordered set
of Data Blocks. The backend registers only those lazy plans in a temporary
Polars `SQLContext(eager=False)`, using each canonical UUID as its exact table
name. Callers quote UUID identifiers and no second alias namespace exists.

Query mode evaluates the submitted SQL lazily, applies one-based pagination and
one-row lookahead outside that SQL, and collects one self-contained Arrow IPC
page. Each page request is independent and may recompute ordering, distinct
values, or aggregates. Wordflow accepts that cost instead of owning SQL
sessions, cursors, cached results, or long-lived response streams.

Create mode validates and serializes the resulting lazy plan before committing
one new Data Block through the Workspace mutation boundary. Its parents are all
declared inputs in request order. Provenance stores the exact SQL and declared
inputs as creation history; it is not a replay guarantee after a parent is
removed. SQL creation does not provide an in-place edit mode.

The SQL surface permits Polars SQL except external `read_*` and `scan_*` table
functions. A lightweight lexical policy check ignores comments and string
literals and rejects matching function calls. This protects the intended
Workspace data boundary but is explicitly not a general SQL sandbox.

Typed native operations remain the product contract for Filter, Find/Replace,
Create, Polars Expression, Sample, Join, Stack, cast, rename, and delete.
Those operations preserve semantics that SQL does not represent losslessly,
including Topic Distribution filtering, regex transformations, categorical
casts, plugins, and the full Polars expression surface.
