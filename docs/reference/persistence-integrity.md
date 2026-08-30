# Persistence Integrity

This page records the current commit, restart, isolation, and repair semantics
for every backend persistence boundary.

## Current Guarantees

- Native Workspace schema 22 and portable archive format 21 are strict current
  contracts. Older formats are rejected rather than guessed or migrated at
  runtime.
- Workspace and User File data use private same-filesystem staging and atomic
  replacement for their normal publication paths.
- User File Import records and prepared-publication journals are strict,
  version-1, size-bounded JSON envelopes. Each individual save is atomic.
- Workspace list operations expose safely attributable incompatible, corrupt,
  and over-limit Workspaces as ID-only unavailable entries while isolating
  them from healthy siblings. Data Blocks, Tabs, Analyses, and User File
  Imports isolate safely attributable current-schema corruption as minimal
  unavailable resources without changing the invalid bytes during load.
- Central storage admission measures allocated bytes and reserves concurrent
  growth for Workspace, User File, import, Analysis, and response-snapshot
  writes.
- Preferences and single-user provider credentials share a contained private
  TOML boundary. Reads are strict UTF-8 and capped at 1 MiB without following
  links or reparse points. Writes stage a `0600` file beside the destination,
  recheck quota against the staged and replaced files, and use one atomic
  replacement as the only visibility commit. A failed admission recheck or
  interrupted pre-commit write leaves the previous file unchanged and removes
  the staged file; no startup repair is required.

## Boundary Semantics

| Boundary | Commit and restart semantics |
|---|---|
| Workspace import | [`WorkspaceService`](../../backend/src/ldaca_wordflow/services/workspace.py) assigns the new identity, compiles Workspace and retained-query plans for their final paths, strictly loads the complete future representation, and remeasures quota while the bytes remain staged. The same-filesystem directory rename is the only publication mutation; startup never repairs a partially visible import. |
| User File Import | [`UserFileImportService`](../../backend/src/ldaca_wordflow/services/user_file_imports.py) first persists a successful prepared intent, then publishes the owned file collection, saves the succeeded record, and clears the journal. On restart, an owned visible destination completes the saved Result; an absent destination removes staging and the ordinary interrupted-record transition records failure. Execution is never rerun. |
| Preferences and credentials | The shared private TOML primitive admits and atomically replaces one strict file. A failed pre-commit operation preserves the prior file. There is no multi-file recovery protocol because each business store has one independent commit point. |
| Samples | [`SampleDataService`](../../backend/src/ldaca_wordflow/services/sample_data.py) hashes every streamed byte and verifies the catalogue size and private SHA-256 digest before the downloaded file is renamed into import staging. Any mismatch removes the temporary download and publishes nothing. |
| Import records | [`UserFileImportStore`](../../backend/src/ldaca_wordflow/infrastructure/storage/user_file_import_store.py) accepts only version 1. Unversioned, unknown, oversized, linked, or malformed records are isolated independently. Their UUID comes only from a canonical filename, so deletion does not parse an invalid body. |
| Data Blocks | [`WorkspaceStore`](../../backend/src/ldaca_wordflow/infrastructure/storage/workspace_store.py) persists an ordered schema signature and validates it plus the Document Column Preference both when publishing and loading. A bad plan, owned source, schema, or preference isolates that Data Block and its descendants; healthy siblings load and the invalid committed bytes are not changed by hydration. A Workspace containing an unavailable Data Block is read-only until repaired or exported. |
| Analysis Results | [`result_integrity.py`](../../backend/src/ldaca_wordflow/analysis/result_integrity.py) validates the kind-specific stored Result, output Data Block identities, semantic Artifact identities, declared paths, exact owned file tree, and inferred media types before success publication and during strict load. Failure before commit makes the Analysis fail; failure during load isolates that Analysis and dependent records without changing stored bytes. |
| SQLite | [`database.py`](../../backend/src/ldaca_wordflow/infrastructure/database.py) requires schema 7 and compares complete index metadata, including partial predicates. Quota checks, uniqueness, and foreign-key behavior are exercised by rollback-only probes, leaving no validation rows. |
| Startup reconciliation | Before readiness, each current available Workspace runs [`WorkspaceStore.reconcile`](../../backend/src/ldaca_wordflow/infrastructure/storage/workspace_store.py). Reconciliation removes only unreferenced generations and abandoned private execution storage. Invalid current-schema child records stay in place and are isolated on load; incompatible parent formats remain catalogue-only with bounded raw-ZIP export. |

The detailed storage invariants remain in
[Files and Storage](../domain/files-and-storage.md).
