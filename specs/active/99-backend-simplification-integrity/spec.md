# Issue 99: Backend Simplification, Integrity, and Modernization

## Purpose

Simplify the backend without preserving accidental complexity. Remove proven
dead and compatibility-only paths, deepen shared infrastructure modules, make
worker and Result interfaces strict, update direct dependencies, and complete
the persistence-integrity program.

The supported product remains desktop and hosted Wordflow with Google and
CILogon authentication, Samples and Data Portal imports, all four Annotation
provider adapters, and local plus configured remote Quotation engines.

## Accepted Baseline

The pre-program scan found 164 non-vendored backend source modules with about
40,800 lines of Python, 803 passing tests, 86 OpenAPI operations, clean Ruff
and Ty checks, no unused direct dependencies, and no broad high-confidence
unused-production-function set. Complexity scanning reported 59 functions over
the configured McCabe threshold; these are review targets, not automatic
deletion candidates. The first contract increment intentionally removes two
unreachable operations and their two private-only tests.

## Contract Reset

One coordinated cutover owns all breaking contracts:

- native Workspace data schema 1 plus independent schema version 1 for each of
  the six top-level Analysis kinds;
- portable Workspace archive data format 1 with the same per-kind envelopes;
- SQLite schema 7;
- User File Import record envelope version 1;
- UUID and aware-UTC identity/time types throughout the domain;
- discriminated Tab settings and Analysis Result variants;
- strict remote Quotation v2 request and response models.

There is no migration, converter, runtime fallback, or best-effort parser for
the replaced formats. Native schema 23 receives no special detection: it is
catalogued through the normal corrupt-snapshot path, remains selectable for a
Load attempt, and reports the ordinary backend error. Archive format 22 is
rejected. Workspaces with a recognized `data_schema_version` mismatch retain
bounded raw-ZIP download. Current-version malformed children and unsupported
Analysis-kind versions remain in place as the smallest attributable unavailable
resource and do not hide healthy siblings. Opaque native Analysis records are
preserved across unrelated commits; portable import and export deliberately
omit them and their dependent subtrees with reported counts.

## Architecture

`WorkspaceService` remains the only Workspace mutation authority. Analysis and
User File Import lifecycles remain independent durable resources. They share a
private fair scheduler module and supervised fresh-process runner, not a
generic Task resource.

Storage safety, immutable input snapshots, Topic projection codecs, provider
adapters, and Result presentation each have one deep interface. Runtime and
WorkspaceStore remain deep modules rather than being split into forwarding
classes. The copied GenderGapTracker source is not modified.

## Result and Tab Interfaces

- Delete unreachable paged Result table routes and identities.
- Materialize one strict semantic Result projection and recursively resolve
  stored identities to public URLs.
- Replace optional ready/queried/source/group shapes with discriminated
  variants.
- Remove Topic diagnostic metadata and redundant per-corpus topic counts from
  persisted and public Results; emit execution diagnostics to logs.
- Replace cross-kind optional Tab fields with kind-specific settings and patch
  types.

## Persistence Integrity

Complete every open boundary recorded in
`docs/reference/persistence-integrity.md`: Workspace import publication, User
File Import publication recovery, admitted private TOML writes, sample digest
verification, versioned import records, Data Block and Result identity checks,
semantic SQLite validation, corrupt-import isolation, and startup Workspace
reconciliation.

## Acceptance

Each increment remains reviewable and passes focused tests. The final proof set
includes backend Ruff, Ty, and Pytest; regenerated OpenAPI and frontend client;
frontend tests, lint, and build; documentation links; package/runtime probes;
and `git diff --check` while preserving unrelated worktree changes.
