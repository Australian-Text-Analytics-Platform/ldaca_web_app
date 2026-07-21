# Database and Persistence Audit — 2026-07-20

## Audit status

This is a report-only audit of the current dirty working tree. No implementation
fixes were made. The review covered the SQLite deployment database, Workspace
snapshot and archive formats, per-user files and JSON/TOML records, Analysis
Results and Artifacts, quota admission, startup recovery, generated API
contracts, and frontend device-local persistence.

The audit found **17 actionable inconsistencies**:

| Severity | Count |
| --- | ---: |
| High | 3 |
| Medium | 13 |
| Low | 1 |

The default live Data Root at ~/Documents/ldaca was inspected read-only as a
point-in-time check. Its current SQLite database and Workspace are structurally
healthy, but the live user root contains one secret-bearing legacy backup that
has no current owner or cleanup path.

## Persistence map

| Boundary | Durable state | Current owner |
| --- | --- | --- |
| Deployment SQLite | users, identities, sessions, consumed Google credentials, OAuth transactions, quota policy | Database, SessionService, OAuthService |
| Workspace directory | access sidecar, schema-5 workspace envelope, generation-named plans, Tabs, Analyses, Artifacts | WorkspaceService through WorkspaceStore |
| Workspace ZIP | version-3 portable manifest and materialized Parquet data | WorkspaceArchiveService |
| User root | User Files, User File Import records, preferences, provider credentials | UserFileStore, UserFileImportService, UserPreferenceStore |
| Transient Data Root state | uploads, import staging, execution snapshots, response/query snapshots, trash | owning service and startup reconciliation |
| Browser localStorage | device preferences, presentation state, input caches, guidance history | frontend Zustand stores and direct component storage |

## Findings summary

| ID | Severity | Area | Finding |
| --- | --- | --- | --- |
| DB-01 | High | Workspace archives | Archive round trips preserve Tab analysis IDs but omit Analysis records and Artifacts, producing restored corrupt Analyses |
| DB-02 | High | Workspace archives | Import publishes the live directory before rebasing its plans, so a crash can leave an addressable but unloadable Workspace |
| DB-03 | High | User File Imports | Visible file publication and terminal success persistence are separate commit points |
| DB-04 | Medium | Quota | Preference and credential writes bypass quota and shared physical-capacity admission |
| DB-05 | Medium | Preferences and credentials | Two documented independent resources share one load and corruption domain |
| DB-06 | Medium | Preferences and credentials | Persisted-format behavior and documentation disagree about versioning and legacy handling |
| DB-07 | Medium | Secret lifecycle | A live legacy preferences backup still retains secret-bearing fields |
| DB-08 | Medium | Filesystem safety | Preference and credential I/O is weaker than the other durable stores |
| DB-09 | Medium | Sample imports | Available SHA-256 integrity pins are discarded and downloads are checked by size only |
| DB-10 | Medium | Workspace formats | Schema 5 and archive format 3 were reused after adding persisted SQL provenance |
| DB-11 | Medium | User File Import format | Import records are unversioned while their accepted persisted grammar is actively changing |
| DB-12 | Medium | Workspace loading | Native Workspace loading accepts semantically stale Data Block metadata |
| DB-13 | Medium | Analysis Results | Stored Result artifact identities and declared artifact references are not validated as one invariant |
| DB-14 | Medium | SQLite validation | The “exact” schema validator accepts weakened indexes and a comment-only quota CHECK |
| DB-15 | Medium | User File Import recovery | One corrupt import record permanently poisons the whole user's history with no API repair |
| DB-16 | Medium | Workspace recovery | Crash-orphan cleanup is partly unwired and malformed child Analyses can be dropped without a cleanup commit |
| DB-17 | Low | Frontend persistence | Device-local caches are not consistently user-scoped or cleared when durable resources are deleted |

## Detailed findings

### DB-01 — Archive round trips manufacture corrupt Analyses

**Severity: High**

The portable archive manifest contains Workspace metadata, Data Blocks, and
Tabs, but it has no Analysis collection or Artifact inventory
(backend/src/ldaca_wordflow/models/workspace.py:89-131).
Export serializes every Tab unchanged, including analysis_id, while exporting
only Data Block Parquet files
(backend/src/ldaca_wordflow/services/workspace_archives.py:805-850).
Import accepts those Tabs but permits only workspace.json and declared Data
Block files, so no Analysis record can accompany the association
(backend/src/ldaca_wordflow/services/workspace_archives.py:624-680).

The Workspace loader converts a Tab reference with no corresponding root
record into an empty corrupt-Analysis placeholder
(backend/src/ldaca_wordflow/infrastructure/storage/workspace_store.py:430-462).
This contradicts the durable domain statement that an Analysis, its Result,
Artifact references, and output identity are portable Workspace content
(docs/domain/analyses-and-imports.md:40-46).

**Confirmed reproduction**

- Create and complete a Sequential Analysis.
- Export its Workspace, import the ZIP, and open the imported Workspace.
- The restored Tab returns 200 and retains the original analysis_id.
- GET on the restored Tab's Analysis returns 500 with code analysis_corrupt.

**Impact**

- A successful export/import can turn a healthy user resource into an explicitly
  corrupt one.
- Artifact-backed Results are silently omitted even though their identifiers
  remain reachable from the restored Tab.
- The current empty-Tab round-trip test misses this because its analysis_id is
  null.

**Recommendation**

Choose one explicit archive contract and version it:

1. Preferred: archive complete portable Analysis records and referenced
   Artifacts in a new manifest version, excluding only execution-private state.
2. If Results are intentionally non-portable, clear analysis_id on every
   exported Tab and update the domain and user-facing documentation. Do not
   preserve a dangling identity.

Add a full round-trip test with a succeeded Artifact-backed Analysis.

### DB-02 — Workspace archive import is not crash-atomic

**Severity: High**

The import is quota-rechecked while still in staging
(backend/src/ldaca_wordflow/services/workspace.py:1581-1594).
The live commit then renames staging to the final UUID directory, fsyncs the
Workspace catalogue, and only afterwards rebases serialized plan source paths
and attempts to load the Workspace
(backend/src/ldaca_wordflow/services/workspace.py:1660-1678).

The rename therefore makes an invalid relocated snapshot durable before its
plans point at the final directory. Ordinary exceptions are handled by deleting
the destination, but a process kill or machine failure between the fsynced
rename and rebase bypasses that cleanup. Startup only removes entries inside
.staging and .trash plus node-source temporary files; it does not repair this
live UUID directory
(backend/src/ldaca_wordflow/services/workspace.py:1697-1703).

This contradicts the documented single atomic rename of a complete live
Workspace
(docs/architecture/backend/workspaces.md:111-115) and the
staged-before-atomic-install invariant
(docs/domain/files-and-storage.md:45-46).

The final rebase also mutates persisted bytes after the final quota measurement,
so the quota-approved tree is not exactly the published tree.

**Confirmed reproduction**

A staged imported snapshot was renamed without running the rebase. Lightweight
inspection still recognized it as a Workspace, but full load failed with
WorkspaceSnapshotInvalidError. Loading succeeded only after rebasing.

**Recommendation**

Rebase the private staging snapshot for its known final root before the live
rename, using copy-on-write generation files. Validate and quota-measure that
final staged representation, then make the rename the sole commit point. Add a
fault-injection test immediately after the rename.

### DB-03 — User File Import publication and success persistence are split

**Severity: High**

Completion measures the staging tree, publishes it into visible User Files,
then constructs and saves the succeeded JSON record
(backend/src/ldaca_wordflow/services/user_file_imports.py:581-625).
The publication path adds the hidden ownership marker after the quota recheck
and atomically renames the directory
(user_files.py (backend/src/ldaca_wordflow/services/user_files.py:433-465),
user_files.py (backend/src/ldaca_wordflow/services/user_files.py:646-664)).

If the succeeded-record save fails, the service catches the exception as an
execution failure and can persist a failed record even though the visible files
already exist
(backend/src/ldaca_wordflow/services/user_file_imports.py:462-513).
A process crash in the same window leaves the retained record running; startup
then deterministically marks it interrupted. Startup storage reconciliation
removes only unpublished staging and upload temporaries, not a published
destination with an ownership marker
(user_files.py (backend/src/ldaca_wordflow/services/user_files.py:731-779),
runtime.py (backend/src/ldaca_wordflow/runtime.py:549-572)).

The marker makes installation idempotent only for the same import UUID. Public
retry creates a new UUID, so the retry conflicts with the already-published
destination. This violates the documented service ownership of atomic
publication and terminal persistence
(docs/architecture/backend/background-work.md:57-66).

The final quota recheck is also incomplete: the marker and any growth from the
running record to the succeeded record occur after the reservation is resized
to the measured staging tree.

**Recommendation**

Use a recoverable publication transaction:

- prepare and size the exact terminal record plus ownership marker before the
  final recheck;
- persist a publication journal or explicit prepared state;
- rename the visible directory;
- commit succeeded;
- on startup, use the ownership marker and journal to finish or roll back the
  same import rather than marking it failed blindly.

Add tests for terminal-record save failure, a crash after rename, quota exactly
at the boundary, and retry of the same durable import identity.

### DB-04 — Preference and credential writes bypass storage admission

**Severity: Medium**

Quota documentation says one QuotaService owns admission for every principal
and that staged output is rechecked before publication
(docs/domain/files-and-storage.md:51-60).
The quota scan counts every ordinary file under the user root, including
preferences, credentials, and legacy backups
(backend/src/ldaca_wordflow/services/quota.py:464-504).

Runtime constructs UserPreferenceStore with only Settings and an I/O limiter,
not StorageAdmissionService
(backend/src/ldaca_wordflow/runtime.py:481-494).
The store writes TOML directly through atomic_output_path
(backend/src/ldaca_wordflow/services/user_preferences.py:196-222).
There is no quota reservation, latest-policy recheck, physical free-space
reservation, or serialized-byte limit.

GET preferences is also a write: if preferences.toml is absent, the load path
creates a default durable file
(backend/src/ldaca_wordflow/services/user_preferences.py:166-185).
Preference arrays and strings have no item-count or length bounds
(backend/src/ldaca_wordflow/models/user_preferences.py:16-59).

**Impact**

- An over-quota principal can still grow durable state.
- A nominal read can fail due to disk pressure or mutate state without the
  write-admission contract.
- Large preference requests can consume the global request-body allowance and
  create similarly large unadmitted TOML.

**Recommendation**

Give both preference resources a bounded serialized-size contract and the
shared StorageAdmissionService. Keep GET side-effect-free; return in-memory
defaults until an admitted PATCH creates the file.

### DB-05 — Independent preference and credential APIs share one failure domain

**Severity: Medium**

Every preference operation loads both preferences.toml and
provider-credentials.toml, and every credential operation loads both files
(user_preferences.py (backend/src/ldaca_wordflow/services/user_preferences.py:49-130),
user_preferences.py (backend/src/ldaca_wordflow/services/user_preferences.py:166-193)).
ProviderCredentialStore is a shallow adapter over that shared owner
(backend/src/ldaca_wordflow/services/provider_credentials.py:16-42).

Consequences:

- corrupt credentials make GET and PATCH preferences fail with
  ProviderCredentialsCorruptError;
- corrupt preferences make credential summary/update/clear unavailable;
- DELETE credentials cannot repair a corrupt credential file because clear
  calls the shared load before overwriting it
  (backend/src/ldaca_wordflow/services/user_preferences.py:96-103).

This conflicts with the documented independent current-principal resources
(docs/architecture/backend/http-api.md:63-66).

**Confirmed reproduction**

An invalid credential TOML caused preferences.get to fail, and
clear_credentials also raised ProviderCredentialsCorruptError instead of
repairing the file.

**Recommendation**

Split the persistence seams: independent loaders, independent corruption
errors, and either separate locks or one shared lock below two independent file
repositories. Credential clear should overwrite the credential file without
requiring its current contents to parse.

### DB-06 — Preference and credential format contracts disagree

**Severity: Medium**

StoredUserPreferences is explicitly schema-versioned, but
StoredProviderCredentials has no schema marker
(models/user_preferences.py (backend/src/ldaca_wordflow/models/user_preferences.py:62-65),
models/provider_credentials.py (backend/src/ldaca_wordflow/models/provider_credentials.py:55-74)).
The loader enforces preference version 1 but accepts any exact current,
unversioned credential layout
(backend/src/ldaca_wordflow/services/user_preferences.py:166-193).

The durable documents disagree with each other and the implementation:

- ADR 0006 says mixed or unversioned layouts are rejected
  (docs/adr/0006-separate-preferences-guidance-history-and-credentials.md:14-17).
- Backend settings says unversioned files are rejected
  (docs/reference/backend-settings.md:47-52).
- The architecture overview says UserPreferenceStore performs an idempotent
  legacy split
  (docs/architecture/backend/overview.md:63-65).
- Current source contains no legacy split or migration path.

**Recommendation**

Define one current contract. Prefer a schema-versioned credential envelope and
an explicit one-time migration tool or startup migration with documented
backup retirement. If the policy is rejection-only, remove the migration claim
and provide an operator recovery runbook.

### DB-07 — A live secret-bearing legacy backup is orphaned

**Severity: Medium**

The default live user root contains:

- preferences.toml.legacy-20260718T203305+1000.bak
- 443 bytes
- mode 0600
- original content predates the new preferences.toml and
  provider-credentials.toml created at the timestamp embedded in the backup
  name.

A structural TOML scan, without printing or recording any values, confirmed
that the backup contains API-key fields. No current source path recognizes,
expires, migrates, or deletes this filename. It is also counted as quota usage
because it is an ordinary regular file under the user root
(backend/src/ldaca_wordflow/services/quota.py:464-504).

**Impact**

The preferences/credentials split did not complete the secret lifecycle:
retired or rotated secrets can remain indefinitely in an unexpected general
preferences backup.

**Recommendation**

Add an explicit, idempotent retirement step for known legacy backup names after
successful verification of the split. If rollback backup is required, document
its retention period, keep it in a credential-owned private area, and offer a
safe cleanup command. Never expose backup contents through an API.

### DB-08 — Preference and credential filesystem safety is shallow

**Severity: Medium**

The reader checks exists, is_symlink, and is_file separately, then performs an
unbounded read_text
(backend/src/ldaca_wordflow/services/user_preferences.py:152-163).
This creates a check/use race and has no maximum file size. The writer relies
on atomic_output_path, whose parent creation and temporary-file placement do
not reject a linked parent chain
(backend/src/ldaca_wordflow/infrastructure/storage/durable_fs.py:37-69).

Other durable stores use lstat, safe containment resolvers, O_NOFOLLOW-style
checks where available, and explicit byte budgets. The preference seam can
follow a replaced user-root parent while quota scanning deliberately treats a
linked user root as zero usage.

**Recommendation**

Use the same safe-path boundary as UserFileStore or add a dedicated private
regular-file helper that:

- validates every parent without following links;
- opens the leaf without following links;
- bounds bytes before parsing;
- atomically replaces only within the verified parent;
- rechecks containment at publication.

### DB-09 — Sample integrity hashes are discarded

**Severity: Medium**

The canonical sample catalogue currently contains valid SHA-256 values for all
10 declared files; the first entries are visible in
catalogue.json (ldaca-analytics-sample-data/catalogue.json:16-26).
The backend's private catalogue model discards unknown fields and does not
model sha256
(backend/src/ldaca_wordflow/models/data_sources.py:27-47).
The download path validates only byte count before publication
(backend/src/ldaca_wordflow/services/sample_data.py:172-200).

This is a recent regression: the working-tree change removed digest validation
and added a test asserting that sha256 is absent from the public payload. A
same-length corrupt or tampered response is therefore accepted and persisted,
despite the module and errors still describing integrity checks.

Using extra="ignore" on versioned collection/file records also hides manifest
schema drift instead of rejecting it.

**Recommendation**

Use a strict private repository-manifest model that retains sha256 and a
separate public projection that intentionally omits internal pins. Hash while
streaming and compare before the atomic rename. Keep the catalogue envelope and
its nested private records extra-forbid.

### DB-10 — Persisted SQL provenance reused existing format versions

**Severity: Medium**

The working tree adds a new persisted SqlDerivation discriminator and a new
input role
(backend/src/ldaca_wordflow/domain/workspace/provenance.py:245-355).
Workspace snapshots still declare schema version 5
(backend/src/ldaca_wordflow/infrastructure/storage/workspace_store.py:44-46).
Portable archives still declare format version 3 while embedding the same
NodeProvenance union
(backend/src/ldaca_wordflow/models/workspace.py:109-131).

An older schema-5 or format-3 reader cannot parse a new SQL-derived Data Block,
so the same version identifiers now describe two incompatible dialects.

**Recommendation**

Bump both durable format versions together and define their reader policy.
Add fixtures proving:

- old formats still import through an explicit migration or are rejected with
  the correct version error;
- the new format round-trips SQL provenance;
- format/version changes are required whenever a discriminated persisted union
  gains a member or role.

### DB-11 — User File Import records have no format version

**Severity: Medium**

UserFileImport is persisted directly as a strict JSON model with no envelope or
schema_version
(user_file_import.py (backend/src/ldaca_wordflow/domain/user_file_import.py:110-123),
user_file_import_store.py (backend/src/ldaca_wordflow/infrastructure/storage/user_file_import_store.py:147-161)).
The current working-tree change broadens sample collection IDs from a flat
identifier to a canonical hierarchical path
(backend/src/ldaca_wordflow/domain/user_file_import.py:37-82).

New records such as ADO/twitter are rejected by the previous reader, but there
is no version marker with which to migrate or issue a precise unsupported
format error. Because one invalid record poisons the user's whole history
(DB-15), rollback after creating a hierarchical sample record has an amplified
failure mode.

**Recommendation**

Add a small versioned record envelope and an explicit decoder by version.
Avoid compatibility guessing; migrate once or fail with a record-specific
unsupported-version error.

### DB-12 — Native Workspace loading accepts stale Data Block metadata

**Severity: Medium**

The native loader validates metadata field shapes, plan containment, and graph
topology, but after deserializing the LazyFrame it does not verify that:

- document names an existing column;
- tokenization source and output columns exist;
- name satisfies the public NodeName/display-name contract.

The relevant load path is
workspace_store.py (backend/src/ldaca_wordflow/infrastructure/storage/workspace_store.py:792-944).
By contrast, native edit operations reconcile document/tokenization references
against the schema
(backend/src/ldaca_wordflow/services/nodes.py:552-560), and
the archive compiler rejects absent metadata columns
(backend/src/ldaca_wordflow/services/workspace_archives.py:693-705).

**Confirmed reproduction**

A valid snapshot was changed so document named a missing column while its plan
contained only value. WorkspaceStore.load succeeded and returned the stale
document value.

**Recommendation**

Validate the public name contract and collect the plan schema once during
strict load. Reject semantically invalid document/tokenization metadata, or
perform an explicit versioned migration before publication. Native and archive
loaders should enforce the same invariant.

### DB-13 — Result artifact identities are not one persisted invariant

**Severity: Medium**

AnalysisRecord validates success/Result presence and uniqueness of artifact
reference names and paths, but it does not validate the kind-specific Result or
connect identities inside that Result to artifact_references
(backend/src/ldaca_wordflow/domain/workspace/analysis.py:375-393).

The Result service validates the kind-specific payload only when queried and
then checks that every declared artifact reference exists
(analysis_results.py (backend/src/ldaca_wordflow/services/analysis_results.py:274-321),
analysis_artifacts.py (backend/src/ldaca_wordflow/services/analysis_artifacts.py:165-183)).
ensure_available walks references only
(backend/src/ldaca_wordflow/services/analysis_artifacts.py:509-518).
The API builds download URLs from StoredArtifactIdentity names inside the
Result payload
(backend/src/ldaca_wordflow/api/workspaces/analyses.py:80-91).

A drifted record can therefore declare existing artifact references while the
Result names a different artifact. The Result endpoint returns a URL that later
404/410s, or a successful Analysis can fail with 500 only when its Result is
read.

**Recommendation**

At publication and strict load, validate:

- the request kind's exact stored Result model;
- a bijection between every StoredArtifactIdentity and artifact_references;
- name and media-type agreement;
- existence and containment of every referenced file.

Isolate a corrupt Analysis explicitly instead of deferring failure to a later
projection.

### DB-14 — SQLite “exact schema” validation accepts weaker constraints

**Severity: Medium**

Index validation checks only uniqueness and column names. It ignores the
partial flag and WHERE clause returned by PRAGMA index_list
(database.py (backend/src/ldaca_wordflow/infrastructure/database.py:341-370),
database.py (backend/src/ldaca_wordflow/infrastructure/database.py:388-407)).
The quota CHECK validator searches normalized CREATE TABLE text for a substring
instead of validating the actual constraint
(backend/src/ldaca_wordflow/infrastructure/database.py:374-385).

**Confirmed reproductions**

- A schema-version-6 database using partial unique email/token indexes and
  partial named session indexes was accepted.
- A users table with the required CHECK text only inside a SQL comment was
  accepted; inserting storage_quota_bytes = 0 then succeeded.

The adapter's module contract says startup validates the current schema
exactly. These accepted schemas can violate account uniqueness, session-token
uniqueness, index coverage, and positive quota policy.

**Recommendation**

- Require partial == 0 for every required index.
- Use PRAGMA index_xinfo plus sqlite_master SQL where semantic details matter.
- Validate the CHECK through a controlled table rebuild comparison or active
  constraint probes inside a rollback-only transaction.
- Add the two reproductions as regression tests.

### DB-15 — One corrupt import record poisons an entire user's history

**Severity: Medium**

The store loads all records for one user as a unit; any invalid filename or
record aborts the user and marks the entire user corrupt
(backend/src/ldaca_wordflow/infrastructure/storage/user_file_import_store.py:164-205).
The service then makes every list request fail
(backend/src/ldaca_wordflow/services/user_file_imports.py:229-248).

The corrupt record is not present in the in-memory record map, so GET and
DELETE by its UUID return not found; the public terminal-delete operation
cannot repair the condition
(backend/src/ldaca_wordflow/services/user_file_imports.py:314-336).
New submissions can still be created, but the user cannot list either old or
new history until an operator edits the filesystem.

**Recommendation**

Isolate corruption per record, retaining its filename/UUID as a repairable
CorruptUserFileImport entry. Allow deletion of the exact corrupt record without
parsing its body, or provide a documented authenticated repair endpoint or
operator command. Healthy sibling records should remain listable.

### DB-16 — Workspace startup cleanup is incomplete and partly unwired

**Severity: Medium**

WorkspaceStore has a dedicated reconcile method that removes crash-orphaned
plan, Tab, Analysis, execution, and Artifact generations. Its docstring says it
is called during discovery
(backend/src/ldaca_wordflow/infrastructure/storage/workspace_store.py:1217-1250).
Production code never calls it. WorkspaceService.reconcile_transient_storage
only cleans .staging, .trash, and node-source temp files
(backend/src/ldaca_wordflow/services/workspace.py:1697-1703).
The only direct call found is the unit test for WorkspaceStore itself.

Consequently, a process crash around a generation commit can leave
unreferenced plans or records consuming quota indefinitely in a closed
Workspace until a later unrelated commit happens to garbage-collect them.

There is a second cleanup hole in Analysis hydration. A child with a missing
parent is silently skipped, and the ValueError branch contains an unreachable
tab-root check because tab-root IDs were already continued
(backend/src/ldaca_wordflow/infrastructure/storage/workspace_store.py:440-453).
Startup Analysis reconciliation sees only the hydrated records. It commits only
when it changes a visible record
(analyses.py (backend/src/ldaca_wordflow/services/analyses.py:880-928),
workspace.py (backend/src/ldaca_wordflow/services/workspace.py:1723-1735)).
A skipped orphan can therefore remain on disk until another mutation.

**Recommendation**

Call WorkspaceStore.reconcile for every safely owned Workspace during startup,
under the same per-Workspace gate and before domain reconciliation. Have load
return an explicit cleanup set for dropped malformed child records, and force a
commit/removal when that set is non-empty. Remove the unreachable branch and
add startup tests for crash-orphan generations and rootless children.

### DB-17 — Frontend persistence has incomplete lifecycle ownership

**Severity: Low**

FileTree stores collapsed user-file paths under one global localStorage key,
without user identity
(frontend/src/features/views/data-loader/components/FileTree.tsx:74-95).
On a shared browser profile, path metadata and collapse behavior carry between
accounts.

Three persistent maps retain deleted Workspace and Data Block identities:

- recent selections
  (frontend/src/stores/recentSelectionsStore.ts:14-55);
- preprocessing inputs
  (frontend/src/stores/preprocessingInputsStore.ts:20-62);
- active Analysis Tab presentation
  (frontend/src/features/views/common/tabs/analysisTabsPresentationStore.ts:5-52).

Workspace deletion clears current selection and query state but does not remove
entries from those persistent maps
(frontend/src/features/workspace/common/hooks/useWorkspaceManagementMutations.ts:125-143).
The maps have no storage version, migration, global cap, or resource-deletion
cleanup.

**Recommendation**

Scope user-file presentation state by authenticated user. Give each persistent
store a version and migration, and expose removeWorkspace/removeNode actions
called from successful durable deletion paths. Keep the current active-Tab
self-repair, but also remove deleted Workspace keys proactively.

## Live Data Root snapshot

The following checks were read-only and point-in-time:

| Check | Result |
| --- | --- |
| SQLite user_version | 6 |
| SQLite integrity_check | ok |
| SQLite foreign_key_check | no violations |
| SQLite rows | 1 user; 0 identities, sessions, consumed Google credentials, or OAuth transactions |
| Required live indexes | present and non-partial |
| Workspaces | 1 safely owned Workspace |
| Workspace strict load | passed; 5 Data Blocks |
| Tabs and Analyses | 8 Tabs; 6 Analyses: 5 succeeded, 1 failed |
| Analysis stored models/files | all current records validated; no missing referenced files or identity mismatches |
| Workspace generation files | 19 referenced, 19 present, no unreferenced generation files |
| Workspace staging/trash | empty |
| User File Import history | no retained records |
| preferences.toml | valid schema version 1 |
| provider-credentials.toml | valid current unversioned model |
| Legacy backup | present, mode 0600, contains secret-bearing fields; values were not read or recorded |

This healthy snapshot does not reduce the severity of the fault windows above;
it only confirms they have not damaged the inspected live data at this moment.

## Verified aligned areas

The audit also confirmed the following areas are currently aligned:

- The freshly exported OpenAPI document exactly matches
  frontend/openapi/ldaca-wordflow.openapi.json.
- The generated frontend client and current backend routes agree.
- SQLite foreign keys are enabled on every operation-scoped connection.
- Raw session and CSRF values are not persisted; only hashes are stored.
- User File paths and Workspace ownership boundaries generally use strict
  containment and no-link checks.
- Normal Workspace generation commits use plans/records first and
  workspace.json as the metadata commit point.
- Data Block Undo/Redo plan history is process-local by deliberate contract.
- SQL derivation treating every declared input as a parent is deliberate.
- Arrow page endpoints are buffered complete IPC responses, not open-ended HTTP
  streams.
- Frontend authentication no longer persists a bearer token.

## Verification performed

### Automated checks

- Backend: ruff check passed.
- Backend: ty check passed.
- Backend: full pytest passed — 489 passed, 1 skipped.
- Frontend: lint passed.
- Frontend: test passed — 202 files, 816 tests.
- Frontend: knip passed.
- Frontend: production build and TypeScript no-emit check passed.
- Fresh OpenAPI export matched the checked-in document byte-for-byte.

### Targeted fault and drift checks

- Analysis archive round trip reproduced restored analysis_corrupt.
- Workspace archive rename-before-rebase reproduced inspectable but unloadable
  live content.
- Stale document metadata was accepted by native Workspace load.
- Unversioned credential TOML was accepted.
- Credential clear could not repair corrupt credential TOML.
- Partial SQLite indexes were accepted as exact.
- Comment-only quota CHECK text was accepted as a real constraint.
- Current live Analysis Result models and artifact files were cross-checked.
- Current live Workspace references were compared with generation files.
- The legacy backup was inspected structurally without exposing secret values.

## Recommended remediation order

### Milestone 1 — Stop creating corrupt or split-commit resources

1. DB-01: define and implement the archive Analysis contract.
2. DB-02: move Workspace plan rebasing before the live rename.
3. DB-03: make User File publication recoverable with one durable transaction
   identity and startup reconciliation.

### Milestone 2 — Restore exact persistence contracts

1. DB-10 and DB-11: version every actively evolving durable format.
2. DB-14: harden SQLite constraint validation.
3. DB-13 and DB-12: validate complete semantic object graphs at load and
   publication.
4. DB-09: restore private digest validation.

### Milestone 3 — Unify storage admission and recovery

1. DB-04: route preference and credential writes through shared admission.
2. DB-05, DB-06, DB-08: split the resources cleanly and harden their file
   boundary.
3. DB-07: retire the live secret-bearing legacy backup safely.
4. DB-15 and DB-16: isolate corrupt records and wire deterministic startup
   cleanup.

### Milestone 4 — Bound device-local leftovers

1. DB-17: add user/resource cleanup and storage-version migrations to frontend
   persistent stores.

## Completion criterion for the fixes

The persistence layer should be considered repaired only when:

- every durable resource has one explicit owner and one commit point;
- every format has a version or is formally immutable;
- publication bytes are exactly the bytes admitted by quota;
- startup deterministically finishes or rolls back every interrupted commit;
- corrupt records are isolated and repairable without hiding healthy siblings;
- archive export/import has a tested, lossless contract for every field it
  claims to preserve;
- frontend device persistence is scoped and garbage-collected with the durable
  resources it references.
