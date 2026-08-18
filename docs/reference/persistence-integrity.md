# Persistence Integrity

This page records current persistence guarantees and known hardening
boundaries. It is a source-linked risk register, not a dated review, a runtime
health report, or a claim that the listed failure windows have occurred in a
deployment.

## Current Guarantees

- Native Workspace schema 18 and portable archive format 17 are strict current
  contracts. Older formats are rejected rather than guessed or migrated at
  runtime.
- Workspace and User File data use private same-filesystem staging and atomic
  replacement for their normal publication paths.
- User File Import records are strict, size-bounded JSON files, and each
  individual record save is atomic.
- Workspace list operations expose safely attributable incompatible, corrupt,
  and over-limit Workspaces as ID-only unavailable entries while isolating
  them from healthy siblings. Analysis hydration can expose corrupt Tab-owned
  records without making healthy sibling Analyses unreadable.
- Central storage admission measures allocated bytes and reserves concurrent
  growth for Workspace, User File, import, Analysis, and response-snapshot
  writes.

The detailed storage invariants remain in
[Files and Storage](../domain/files-and-storage.md). The boundaries below are
the separate hardening program and are intentionally not repaired by the
half-wired-component cleanup.

## Open Hardening Boundaries

| Boundary | Current seam and required hardening |
|---|---|
| Workspace import publication | [`WorkspaceService`](../../backend/src/ldaca_wordflow/services/workspace.py) renames the staged archive into the live catalogue before rebasing persisted plan and retained-query sources. A crash in that window can publish a Workspace that strict loading cannot reopen. Rebase, validate, and quota-measure the final representation before making the rename the sole commit point. |
| User File Import publication | [`UserFileImportService`](../../backend/src/ldaca_wordflow/services/user_file_imports.py) publishes visible files before saving the succeeded import record through [`UserFileImportStore`](../../backend/src/ldaca_wordflow/infrastructure/storage/user_file_import_store.py). Failure or interruption between those commits can leave published files paired with a failed or interrupted record. Add a recoverable prepared/publication transaction and startup completion or rollback. |
| Quota and safe private paths | [`UserPreferenceStore`](../../backend/src/ldaca_wordflow/services/user_preferences.py) and [`ProviderCredentialStore`](../../backend/src/ldaca_wordflow/services/provider_credentials.py) write through the atomic-file helper without central storage admission. Their private-file reads and writes also lack the bounded, no-follow parent-chain contract used by User Files. Bring both stores under admitted, size-bounded, containment-checked persistence. |
| Sample integrity | The private [`SampleFile`](../../backend/src/ldaca_wordflow/models/data_sources.py) model ignores catalogue hashes, while [`SampleDataService`](../../backend/src/ldaca_wordflow/services/sample_data.py) validates downloaded size only. Retain the repository digest privately and verify it while streaming before publication. |
| Import-record evolution | [`UserFileImport`](../../backend/src/ldaca_wordflow/domain/user_file_import.py) is persisted directly without a format-version envelope. Add an explicit versioned decoder so incompatible records can be rejected or migrated deliberately. |
| Data Block and Result integrity | Native [`WorkspaceStore`](../../backend/src/ldaca_wordflow/infrastructure/storage/workspace_store.py) does not fully reconcile a Data Block's display name and Document Column Preference with its loaded schema. [`AnalysisRecord`](../../backend/src/ldaca_wordflow/domain/workspace/analysis.py) and [`AnalysisResultService`](../../backend/src/ldaca_wordflow/services/analysis_results.py) validate stored Results and declared Artifacts at different times, rather than enforcing one persisted identity invariant. Validate both relationships at publication and strict load, isolating a bad Analysis or Data Block without hiding healthy siblings. |
| SQLite schema validation | [`database.py`](../../backend/src/ldaca_wordflow/infrastructure/database.py) recognizes required indexes by uniqueness and columns without rejecting partial indexes, and recognizes the quota `CHECK` through normalized SQL text. Validate partial predicates and constraints semantically, including rollback-only behavior probes. |
| Corrupt import isolation | [`UserFileImportStore`](../../backend/src/ldaca_wordflow/infrastructure/storage/user_file_import_store.py) marks an entire user's import history corrupt when one file is invalid. Because the bad record is not loaded, the public delete operation cannot repair it. Isolate corruption per record and make that exact record removable without parsing its body. |
| Startup reconciliation | [`WorkspaceStore.reconcile`](../../backend/src/ldaca_wordflow/infrastructure/storage/workspace_store.py) can remove abandoned generations but is not wired into production startup. Hydration also skips some Analysis records whose parents are missing. Run store reconciliation before serving and explicitly remove or isolate parentless invalid records. |

## Verification Targets

Hardening work should use fault injection at each publication boundary, strict
old/new-format fixtures, corrupt-sibling isolation tests, quota-edge tests, and
restart tests. A fix is complete only when durable documentation and recovery
procedures describe the same commit and repair boundaries as the source.
