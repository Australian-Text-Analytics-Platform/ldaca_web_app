# Persistence Integrity

This page records the current commit, restart, isolation, and repair semantics
for every backend persistence boundary.

## Current Guarantees

- Native Workspace data schema 1 and portable archive data format 1 are strict
  current contracts. An old `version` field, including native schema 23, has no
  special reader or classification and fails the normal snapshot load path;
  archive format 22 is rejected. Each of the six top-level Analysis kinds has
  an independent schema version, currently 1.
- Workspace and User File data use private same-filesystem staging and atomic
  replacement for their normal publication paths.
- User File Import records and prepared-publication journals are strict,
  version-1, size-bounded JSON envelopes. Each individual save is atomic.
- Workspace list operations expose safely attributable incompatible, corrupt,
  and over-limit Workspaces as unavailable entries while isolating them from
  healthy siblings. The client still offers Load and displays the ordinary
  backend load error. Data Blocks, Tabs, Analyses, and User File
  Imports isolate safely attributable current-schema corruption as minimal
  unavailable resources without changing the invalid bytes during load.
  Unsupported native Analysis records remain writable opaque bytes; portable
  import and export omit them and their dependent subtrees with response-header
  counts.
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
| Analysis records and Results | [`WorkspaceStore`](../../backend/src/ldaca_wordflow/infrastructure/storage/workspace_store.py) parses stable Tab and Analysis headers before kind dispatch. Unsupported kind versions retain byte-identical opaque records and isolate only the owned subtree; malformed current-version records are `record_invalid`. [`result_integrity.py`](../../backend/src/ldaca_wordflow/analysis/result_integrity.py) validates the kind-specific stored Result, output Data Block identities, semantic Artifact identities, declared paths, exact owned file tree, and inferred media types before success publication and during strict load. Failure before commit makes the Analysis fail; failure during load isolates that Analysis and dependent records without changing stored bytes. |
| Hosted SQLite | Multi-user runtimes use [`database.py`](../../backend/src/ldaca_wordflow/infrastructure/database.py), which requires schema 7 and compares complete index metadata, including partial predicates. Quota checks, uniqueness, and foreign-key behavior are exercised by rollback-only probes, leaving no validation rows. Single-user runtimes do not create, open, validate, or modify this file. |
| Workspace discovery and open | Runtime startup clears only global service-private staging and trash; it never enters a UUID Workspace directory. Authenticated listing inspects attributable metadata and isolates incompatible, corrupt, and over-limit entries. Explicit open locks and loads one Workspace before best-effort orphan cleanup and interrupted-Analysis finalization. Invalid current-schema children stay byte-identical until explicit clear or deletion; incompatible parent formats remain catalogue-only with bounded raw-ZIP export. |

The detailed storage invariants remain in
[Files and Storage](../domain/files-and-storage.md).
