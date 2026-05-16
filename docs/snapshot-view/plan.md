# Demo Snapshot — executable plan

**Status**: design-only, not implemented. Pick up in a fresh session.
**Drafted**: 2026-05-12
**Revised**: 2026-05-16 — refinements applied for naming collision with the analysis-lock machine, node-colour store migration, runtime-resolved stopwords, the `TokensColumnMismatchNotice`, dispersion-bins shape changes, full-result fetch path, dual-mode table pagination, and Tauri / Binder host verification. Branch: `feat/demo-snapshot` off `v0.4`.
**Revised**: 2026-05-16 (later same day) — introduced a two-mode design: Mode 1 (demo, implemented in v1) and Mode 2a (share, design-only, hooks left in v1). See §0.5.
**Revised**: 2026-05-16 (third pass) — switched to backend-mediated storage (sibling of `user_cache/embeddings`), added sidecar `.manifest.json` + `.md` files for fast listing, introduced master-switch UX in `preferencesStore` + sidebar dropdown (§3.6), shared `<AnalysisFeatureHeader>` template (§3.7), MAJOR.MINOR version compatibility predicate with per-tool override registry (§2.3), and the per-snapshot + adaptive-batch delete UX (§5.7). Phase 0a–0g are now landed; Phase 0h–0k spec the remaining infrastructure. See changelog at bottom of file.
**Scope**: analytic tools only — concordance, quotation, token-frequency, sequential-analysis, topic-modeling. AI-Annotator is deferred until the feature stabilises (mirroring the refactor plan's exclusion).
**Out of scope**: data loader, data preprocessing, export. A snapshot is a *read-only view of an analysis result*, not a serialised workspace; users should never be invited to trust snapshot data as a workspace input.

---

## 0. Naming convention (collision avoidance)

"snapshot" is already used unrelated to this feature: [useAnalysisLockMachine.ts](../../frontend/src/features/analysis/common/useAnalysisLockMachine.ts) uses `lockedNodesSnapshot`, `snapshotInput`, `LockedNodesSnapshot`, etc. for the at-Run-time freeze of selected nodes/columns. **New code in this feature must namespace its symbols as `snapshotView` / `SnapshotView` / `viewMode`** so the two never alias. Reserved naming pattern:

- store: `useSnapshotViewStore` (holds both demo and share snapshots once Mode 2a lands — see §3.1)
- per-tool slice fields on that store: `concordance`, `quotation`, `tokenFrequency`, `sequentialAnalysis`, `topicModeling` (each typed `LoadedSnapshot<...> | null`; the store name supplies the namespace, so we don't repeat `snapshotView` in every field)
- file extension and user-facing label: `.ldaca-snapshot`; internal code refers to a "snapshot bundle"
- view-mode value: discriminated union `{ kind: 'live' } | { kind: 'demoSnapshot' } | { kind: 'shareSnapshot' }` — see §3.1
- mode predicates: `isSnapshotMode(viewMode)` (true for demo + share), reserved over inline string compares
- file-system / package paths: `frontend/src/features/snapshot-view/...` for the cross-tool infrastructure (store, manifest codec, mode helpers); per-tool capture/load code lives under each tool's existing folder

Anywhere bare `snapshot` already exists in code, leave it — it means lock-machine state. New code that needs to refer to this feature uses `snapshotView` to disambiguate.

---

## 0.5. Two modes: demo (Mode 1) and share (Mode 2a)

The feature splits into two snapshot flavours that share most of their plumbing:

| | **Mode 1 — demo** (v1) | **Mode 2a — share** (future, hooks only in v1) |
| --- | --- | --- |
| Intent | Show off a result for teaching / presentation. The author is not inviting deep exploration of the source. | Send a collaborator a specific result *plus* the source rows needed to inspect it, without sharing the whole workspace or raw corpus. |
| Backend during view | None. | None. (Still pure-frontend on the recipient side.) |
| Backend during capture | Full-result fetch only. | Full-result fetch **plus** a column-projected materialised parquet of the source nodes — only the columns the analysis touched. |
| Source rows in bundle | **No.** Only the result and aggregated/derived payloads. | **Yes**, projected to the columns the analysis used (text column, doc-id, the tokens column if tokens-mode, metadata used for grouping/filtering). |
| Source-size cap | **Sum of rows across selected/processed data blocks ≤ 2 000.** Heuristic: a bundle from a small teaching-sized corpus. Refuse capture if exceeded. | None on source rows (subject to bundle-size warnings). |
| Result-row cap | 500 000 (same as §4). | 500 000. |
| What the recipient can do | View result + chart + selections. Pure-frontend pagination/sort. Cross-tool jumps suppressed with a toast. | Everything in Mode 1, **plus** client-side search/filter/inspect over the source-projection rows, and click-from-result to source-row context. **Cannot** re-run analyses (no polars-text engine in the browser; that's "Mode 2b" and explicitly out of scope — see §10). |
| Status in v1 | Implemented. | **Not implemented**; v1 leaves the design hooks (mode field, typed payloads, capability flags, three-arm `ViewMode` union, per-mode caps table). |

**Design rule for v1**: anywhere code branches on mode, make it a capability check, not a string equality. `if (snapshot.capabilities.canFilterSourceRows)` — not `if (mode === 'shareSnapshot')`. This way, Mode 2a lights up by adding the source-projection payload and flipping capability bits, with no widespread `if` rewrites.

**Why no "Mode 2b" (full re-run)**: the recipient would need a polars-text execution engine in the browser, or import the bundle into their own Wordflow instance. The former is a multi-MB wasm bundle with feature-parity headaches; the latter is "share a workspace fragment" — a separate problem with security and ownership concerns. Out of scope; see §10.

---

## 1. Why both modes are frontend-only during view

Both Mode 1 and Mode 2a's hard requirement is **isolation from the live backend during view**. Any path that reads or writes server state *while a snapshot is open* risks: (a) leaking stale results into a different workspace, (b) reactivating GC'd parquet caches, (c) coupling snapshot lifetime to task lifetime, (d) creating cross-user attack surface.

The clean answer: the snapshot is a portable artifact the browser produces from data it already has, and the browser also consumes it. **Backend involvement during view: none, in either mode.** Backend involvement during *capture and storage* is necessary but narrow:

- **Capture** needs a one-shot full-result fetch (the existing `POST /result` extended with `page_size: "all"`, landed in Phase 0g for concordance). Mode 2a adds a column-projected source-rows fetch on top (deferred).
- **Storage** uses per-user backend file ops to write the bundle into `user_cache/snapshots/` (sibling of `user_cache/embeddings/`). No analysis logic — the backend is purely a storage clerk. See §2.4 for endpoints.
- **Once a bundle is in the frontend's memory**, the backend is no longer engaged. Pagination, sort, filter, chart re-render — all pure-frontend.

This is a deliberate scope expansion from the original "no backend" framing: it buys a real user_cache-based list-and-load UX that works identically in web, Tauri, and Binder hosts, without per-platform code paths. The view-time isolation property — the actual safety guarantee that made this feature frontend-first — is unchanged.

**Consequences of this choice** — accept up front:
- Snapshots live on the server, per-authenticated-user. A user logged in as A on laptop and on workstation sees the same snapshot list. A different user (B) doesn't see A's snapshots.
- Snapshot format is versioned (`schema_version` field in manifest) so we can evolve it without breaking old files.
- Per-version compatibility is checked at list time via the `tool_version` field (§2.3). Incompatible snapshots show in the list but the Open button is disabled with a tooltip; they remain present until the user (or a future cleanup pass) deletes them.
- Pagination of result tables is **client-side** in snapshot mode (the full table ships in the bundle). Bundle size is the practical cap; see §4 for size discipline. The existing tables paginate server-side via `page_index`/`page_size` overrides — they need a dual-mode pagination contract (see §3.4).

## 2. Bundle format and storage

### 2.0 On-disk layout (per user)

Snapshots are stored under each user's `user_cache/snapshots/` folder — sibling of `user_cache/embeddings/`, using the existing [`get_user_cache_folder(user_id)`](../../backend/src/ldaca_wordflow/core/utils.py#L73) helper. Each snapshot writes **three sibling files** with a common basename:

```
<data_root>/<user_data_folder>/{user_root|user_<id>}/user_cache/snapshots/
  concordance-pride-prejudice.ldaca-snapshot      ← the zip bundle (canonical artifact)
  concordance-pride-prejudice.manifest.json       ← sidecar: parsed manifest for fast listing
  concordance-pride-prejudice.md                  ← sidecar: human-readable description
```

- **Bundle** (`.ldaca-snapshot`) is the canonical artifact: a self-contained zip the user could in principle download and share manually. The frontend never decompresses a bundle just to list snapshots.
- **Sidecar `.manifest.json`** is extracted from the bundle on save. The list endpoint returns these manifests verbatim so the load dialog renders previews without unzipping every file. If a sidecar is missing (snapshot dropped in manually, or sidecar accidentally deleted), the backend lazily extracts it from the zip on first list and re-writes it. The zip's internal `manifest.json` remains the canonical source of truth on load — the sidecar is purely a listing optimisation.
- **Sidecar `.md`** is a short human-readable description, auto-generated at save from manifest data (similar to sample-data READMEs). Rendered by the load dialog via the existing `react-markdown` + `remark-gfm` stack — same components `SampleDataPanel` uses for its READMEs. Users can leave the description blank at save (we render a default summary); future capture flows may let them edit it before save.

### 2.1 Filename convention

`<tool>-<user_defined_name>.ldaca-snapshot` (and matching sidecar names). The user-defined name is a label the user types at save time — *not* the system user id (per-user scoping is provided by the folder path).

Sanitisation rules:
- Replace `[/\\:*?"<>|]` with `_`.
- Reject empty after sanitisation.
- Trim to 80 chars max.
- Reject if `<tool>-<sanitised>` already exists in the current snapshot list (frontend-side check against the in-memory list — no overwrite confirm modal; the save dialog inline-validates the name input and disables Save until valid + unique).

Original (un-sanitised) user input is preserved in `manifest.title` for display in the load dialog and the snapshot view banner.

### 2.2 Bundle internal contents

A zip with the extension `.ldaca-snapshot`. Contents:

```
manifest.json                  required, schema_version + mode + tool + capture metadata
settings.json                  required, all form/UI state needed to reproduce the view
view-state.json                required, ephemeral UI state (selections, pagination, expanded rows)
tables/
  result.parquet               primary result rows (per tool — see §5)
  dispersion-bins.json         concordance only — pre-aggregated 100 buckets
  source.parquet               share mode only — column-projected source rows (see §5.6)
  ...                          additional per-tool payloads
```

Why this layout:
- **Parquet for tabular**: concordance/quotation hit rows can be tens of thousands. Parquet is ~10× smaller than JSON and decodes via `hyparquet` (pure JS — see Phase 0c decision) in the browser.
- **JSON for everything else**: settings, bins, summaries. Inspectable, diffable, no decoder dependency.
- **Folder layout, not flat**: lets us add per-tool payloads without renaming.
- **Mode is a manifest field, not a layout split**: a Mode 2a bundle differs from a Mode 1 bundle only by the presence of a `source-projection` payload entry plus `mode: "share"`. A loader that hands Mode 2a to a recipient who's running an older v1 build degrades gracefully — it can load result/bins, ignore the unknown source-projection payload, and inform the user "this snapshot has share-mode data your build can't open yet".

### 2.3 `manifest.json` shape

```jsonc
{
  "schema_version": 1,
  "mode": "demo",                              // "demo" | "share" — see §0.5
  "tool": "concordance",                       // one of the analysis-tool keys
  "tool_version": "v0.4.4",                    // app version at capture — drives compatibility check (§2.4)
  "captured_at": "2026-05-16T07:30:00Z",
  "title": "user-chosen label",                // un-sanitised; filename uses a sanitised form (§2.1)
  "source": {
    "workspace_id": "uuid-at-capture-time",    // for traceability only, never re-engaged
    "workspace_name": "...",
    "node_ids": ["..."],
    "node_labels": ["..."],
    "total_source_rows": 1842                  // recorded so loaders can sanity-check vs. mode cap
  },
  "capabilities": {
    "canPaginate": true,
    "canSortAndFilterResult": true,
    "canExport": true,
    "canFilterSourceRows": false,              // true only in share mode
    "canCrossJump": false                      // future — multi-tool snapshots
  },
  "preview": {                                 // tool-specific summary populated at capture (§2.3.1)
    "tool": "concordance",
    "searchTerm": "love",
    "totalHits": 14823,
    "materialised": true,
    "displayColumns": ["doc_id", "left_context", "matched_text", "right_context"]
  },
  "payloads": [
    { "kind": "result",            "path": "tables/result.parquet" },
    { "kind": "dispersion-bins",   "path": "tables/dispersion-bins.json" }
    // share mode appends:
    // { "kind": "source-projection", "path": "tables/source.parquet", "columns": ["text", "doc_id", "tokens"] }
  ]
}
```

Loader rules:
- Dispatch by `kind`, not by array index — `result` may not be at `payloads[0]` in future bundles.
- Unknown `kind` values are ignored with a console warn — never block load.
- Missing `kind: "result"` is a fatal load error.
- The `capabilities` block is the source of truth for UI enablement. Components must read capabilities, **not** test `mode === "demo"`. This is the central hook that makes Mode 2a a flip-the-bits exercise.

`source` is for human reference and audit. Loaders **never** look up these IDs against the live backend.

#### 2.3.1 `preview` block — typed per tool

The `preview` block is a discriminated union over `tool`, populated at capture time from in-hand data so the load dialog renders summary stats without decoding parquet payloads. Each tool defines its own preview schema in code:

```ts
type SnapshotPreview =
  | { tool: 'concordance'; searchTerm: string; totalHits: number; materialised: boolean; displayColumns: string[] }
  | { tool: 'quotation'; openPattern: string; closePattern: string; totalHits: number; displayColumns: string[] }
  | { tool: 'token_frequencies'; vocabSize: number; topToken: string; topTokenCount: number; tokeniserId: string }
  | { tool: 'sequential_analysis'; seriesCount: number; bucketCount: number; chartType: string }
  | { tool: 'topic_modeling'; numTopics: number; vocabSize: number; embedder: string; wordsPerTopic: number };
```

The load dialog maps each preview to a list of label/value rows via a per-tool `formatPreview()` helper — so the dialog renders identically across tools, but the *content* of the preview is tool-specific without hardcoding tool keys into the dialog. Adding a new analytic tool means: define its `SnapshotPreview` arm + a `formatPreview()` entry; the dialog inherits support automatically.

### 2.4 Version compatibility

Each manifest carries `tool_version` (the running app version at capture, e.g. `"v0.4.4"`). Load-side compatibility is decided by a single predicate, with per-tool overrides:

```ts
// features/snapshot-view/compat.ts
const TOOL_COMPATIBILITY: Partial<Record<SnapshotToolKey, {
  compatibleMinorVersions: string[];   // e.g., ['0.4', '0.5']
}>> = {
  // Empty for now — every tool falls back to "same MAJOR.MINOR".
  // Populate as tools stabilise:
  //   concordance: { compatibleMinorVersions: ['0.4', '0.5'] },
};

function isCompatibleSnapshot(
  snapshotVersion: string,
  tool: SnapshotToolKey,
  currentVersion: string,
): boolean {
  const override = TOOL_COMPATIBILITY[tool];
  if (override) {
    return override.compatibleMinorVersions.includes(parseMajorMinor(snapshotVersion));
  }
  return parseMajorMinor(snapshotVersion) === parseMajorMinor(currentVersion);  // default
}
```

Rules:
- Default predicate: same `MAJOR.MINOR` (so `0.4.x` is compatible with any `0.4.x` build; `0.3.x` and `0.5.x` are not).
- The override registry holds explicit allowlists for tools known to be cross-version safe (typically: backend-only changes, or tools that have stabilised). Empty in v1 — every tool uses the default.
- Incompatible snapshots **show in the list** with an "Incompatible (saved in v0.3.5)" badge and the Open button disabled with a tooltip explanation. They are not silently hidden — same graceful-degrade philosophy as Mode-2a capability gating.
- The **batch-delete predicate** (§5.7) is the same as this load predicate. Anything the current build can't open IS what "stale" means. This avoids the orphan-middle-zone where a snapshot can neither be opened nor batch-deleted.
- When the allowlist grows beyond a trivial list for a given tool, promote it to a predicate function (e.g. "any 0.4.x or 0.5.x but not 0.4.0"). v1 keeps it a string list; the API surface lets us replace with a function without changing callers.

### 2.5 Backend storage endpoints

All endpoints are user-scoped via the existing auth (`Depends(get_current_user)`), routed under `/users/me/snapshots`. The backend is a storage clerk — no analysis logic.

| Method | Path | Returns | Purpose |
| --- | --- | --- | --- |
| `GET` | `/users/me/snapshots` | `{ items: SnapshotManifest[] }` | List all snapshot manifests for the current user. Reads sidecar `.manifest.json` files; lazily extracts from zip if a sidecar is missing. Optional `?tool=concordance` query filters by `manifest.tool`. |
| `POST` | `/users/me/snapshots` | `{ manifest: SnapshotManifest }` | Multipart upload: `file` part is the bundle bytes, `filename` form field carries the user-chosen filename (server validates against the sanitisation rules in §2.1). Server extracts the bundle's `manifest.json` to write the sidecar `.manifest.json`, generates the `.md` from manifest data. Rejects with 409 if the filename collides (frontend should already have prevented this; the server check is defence-in-depth). |
| `GET` | `/users/me/snapshots/{filename}` | bundle bytes (`application/zip`) | Download a bundle by its on-disk filename. 404 if absent. |
| `GET` | `/users/me/snapshots/{filename}/description` | rendered markdown (`text/markdown`) | Read the human description sidecar. Convenience for the load dialog's README pane. Optional — the dialog can also derive a default from manifest data when the file is absent. |
| `DELETE` | `/users/me/snapshots/{filename}` | `{ deleted: true }` | Remove all three files (bundle + manifest sidecar + .md sidecar) atomically. 404 if absent. |
| `DELETE` | `/users/me/snapshots?tool=concordance&incompatible_with=v0.4.4` | `{ deleted: string[] }` | Batch delete. Without the `incompatible_with` parameter, deletes every snapshot matching the `tool` filter. With it, deletes only those whose `manifest.tool_version` is incompatible per the same predicate the frontend uses (§2.4). The frontend evaluates the predicate to know what label to show on the button; the server re-evaluates so it's the source of truth on what actually gets deleted. |

Implementation notes:
- All filename arguments are sanitised + path-confined to `user_cache/snapshots/` before touching disk. Reject `..` and absolute paths.
- The list endpoint caches the parsed sidecar manifests in memory per-user with a short TTL (~30 s) to avoid re-reading on every load-dialog open. Save/delete invalidate the cache.
- Sidecar lazy-extract: if a `.ldaca-snapshot` is found without a matching `.manifest.json`, the list endpoint opens the zip, reads `manifest.json`, writes the sidecar, and adds it to the response. This makes the system resilient to manual file drops without forcing the frontend to ever decode bundles itself.

## 3. Snapshot mode flags and mutation guards

### 3.1 Where the flag lives

One mode per feature, modelled as a discriminated union so exhaustive `switch` lights up every branch site when a new mode is added:

```ts
type ViewMode =
  | { kind: 'live' }
  | { kind: 'demoSnapshot' }
  | { kind: 'shareSnapshot' };     // reserved — not constructed in v1
```

Recommended placement: a small `useSnapshotViewStore` (zustand) keyed by tool. The store holds the active view mode for each tool **plus** the loaded snapshot payload + capabilities. One store read tells a component both "what mode am I in?" and "where's the data?":

```ts
type SnapshotCapabilities = {
  canPaginate: boolean;
  canSortAndFilterResult: boolean;
  canExport: boolean;
  canFilterSourceRows: boolean;    // share mode only
  canCrossJump: boolean;           // future
};

type LoadedSnapshot<Payload> = {
  manifest: SnapshotManifest;
  capabilities: SnapshotCapabilities;
  payload: Payload;
  // share-mode-only — null in demo mode:
  sourceProjection: SourceProjectionTable | null;
};

type SnapshotViewStore = {
  mode: Record<ToolKey, ViewMode>;
  setMode: (tool: ToolKey, mode: ViewMode) => void;

  // One slice per tool — see §5 for payload shapes. Each holds the
  // currently-loaded snapshot for that tool (or null in live mode).
  concordance: LoadedSnapshot<ConcordanceSnapshotPayload> | null;
  quotation: LoadedSnapshot<QuotationSnapshotPayload> | null;
  tokenFrequency: LoadedSnapshot<TokenFrequencySnapshotPayload> | null;
  sequentialAnalysis: LoadedSnapshot<SequentialAnalysisSnapshotPayload> | null;
  topicModeling: LoadedSnapshot<TopicModelingSnapshotPayload> | null;
};
```

Reasoning:
- A **per-tool slice** (rather than one global flag) lets a snapshot view in concordance coexist with a live view in quotation — useful if the user is comparing.
- The store is named `useSnapshotViewStore` (not `useDemoSnapshotStore`) because once Mode 2a lands the same store holds share-mode snapshots too — no rename needed. Internally, code reads `mode.kind === 'demoSnapshot' || mode.kind === 'shareSnapshot'` via a helper `isSnapshotMode(mode)`.
- The `sourceProjection` field is wired in from day one but is **always `null` in v1** (demo mode never produces one). Mode 2a populates it without changing the slice type. This is the central forward-compat hook.

### 3.2 What disables in snapshot mode

Columns: **Live** = normal Wordflow. **Demo** = Mode 1, what v1 ships. **Share** = Mode 2a's projected behaviour; "= demo" means same as demo, "+" calls out where share mode goes further. UI code reads `capabilities`, not the mode string — the columns below describe the *capability values* that drive the same conditional rendering.

| UI surface | Live | Demo (Mode 1) | Share (Mode 2a, future) |
| --- | --- | --- | --- |
| Run / Update primary action | enabled | **hidden** (replaced with "Exit snapshot view" button) | = demo |
| Process All / Materialise | enabled | **hidden** | = demo |
| Add to Workspace / Detach (all variants) | enabled | **hidden** | = demo |
| Clear Results | enabled | repurposed to "Exit snapshot view" | = demo |
| Pagination, sorting, column selection on result table | enabled | enabled (pure-frontend, gated by `canPaginate` / `canSortAndFilterResult`) | = demo |
| Selection (chart bins, table rows) | enabled | enabled (pure-frontend) | = demo |
| Export buttons (CSV/parquet of the current view) | enabled | enabled — gated by `canExport`; exports snapshot data | = demo |
| `TokensColumnMismatchNotice` (column-lacks-tokens banner) | enabled | **hidden** — we can't validate against a corpus we don't have, and there's no Run flow for the user to act on the warning | = demo |
| Analysis-lock indicators (`useAnalysisLockMachine`) | enabled | **fixed-locked appearance, no controls** — the snapshot is by definition a frozen run; show the locked state but no unlock/re-run control | = demo |
| Tokens-mode model picker, tokens-mode multi-keyword input | enabled | **disabled (read-only display of captured values)** | = demo |
| **Source-row inspector** (browse/search the underlying rows behind a result) | enabled (via workspace) | **hidden** — no source rows in bundle | **enabled when `canFilterSourceRows`** — reads from `sourceProjection`; pure-frontend search/filter, no re-run |
| **Click-from-result to source-row context** | enabled | **disabled** — bundle lacks source rows | **enabled when `canFilterSourceRows`** |

Implementation pattern: each feature exposes a `viewMode` from its top-level component and threads it down. Mutation handlers early-return when `isSnapshotMode(viewMode)`. **Don't rely on UI hiding alone** — handlers must also check, so a stale event handler can't fire a mutation. Capability checks gate optional features (source-inspector, etc.), so a Mode 1 build encountering a Mode 2a bundle won't expose surfaces it can't back.

### 3.3 Cross-tool jumps

Three jump paths exist today, all routed via `analysisStore.pendingConcordance` / similar pending payloads:

- **Token-frequency → Concordance**: click a frequency row → opens concordance tab pre-populated with `searchWord`. [token-frequency/hooks/useTokenFrequencyTaskFlow.ts:249](../../frontend/src/features/analysis/token-frequency/hooks/useTokenFrequencyTaskFlow.ts#L249) (line shifted from :223 after the responsive-cloud + memoisation refactor).
- **AI-Annotator → Concordance**: similar pattern, scoped to a selected category. (Deferred — AI-Annotator is still iterating.)
- **Quotation → Concordance**: not currently implemented, but if added in the future, applies to the same rule.

Rule for snapshot mode (both demo and share): **cross-tool jumps are no-ops with a toast** ("Snapshot view — open the tool live to follow this link"). Implementing them would require capturing snapshots of multiple tools together, which v1 doesn't do (it's the `canCrossJump` capability bit, default `false` on every v1 bundle).

Implementation: jump-emitting code reads `viewMode` of its *own* tool. If `isSnapshotMode(viewMode)`, check `canCrossJump`; if false, suppress and toast. (The receiving tool also guards in case a stale pending payload survives a mode switch.)

### 3.4 Dual-mode pagination contract

Existing result tables (concordance, quotation, token-frequency, sequential, topic) paginate server-side via `page_index` / `page_size` overrides on the POST `/result` endpoints — see [concordance.py:321](../../backend/src/ldaca_wordflow/api/workspaces/analyses/concordance.py#L321). In snapshot mode, the same components must paginate **client-side over the in-memory parquet table**. Two acceptable shapes:

1. **Pagination adapter** (recommended): each table accepts a `paginationSource: { kind: 'server', query } | { kind: 'client', rows }`. The component renders identically; the adapter resolves `page_index`/`page_size` against the right source.
2. **Conditional hook**: a `usePaginatedRows(mode, ...)` hook returns `{ rows, total, pageIndex, setPageIndex }` and switches internals by mode.

Either works; the adapter is preferred because it preserves the existing prop surface and the table component does not learn about modes. Pin this in Phase 0 before tool-specific work — it is the single biggest reusable lever and the area most likely to leak `'live'` assumptions if rushed.

### 3.5 Node colours: capture frozen, render from a snapshot-local map

**Critical refinement (added 2026-05-16).** Since the plan was first drafted, node-colour state has migrated to a global store + workspace `ui_state` sidecar:

- [nodeColorsStore.ts](../../frontend/src/stores/nodeColorsStore.ts) — global store, holds resolved colour for every node id ever seen in the workspace.
- [api/workspaceUiState.ts](../../frontend/src/api/workspaceUiState.ts) — backend `ui_state` sidecar that persists assigned colours per workspace and rehydrates them on load.

Two rules for the snapshot:

1. **At capture**: resolve colour-per-node-id from `useNodeColorsStore.getState()` for every node id referenced in the result, and freeze the resolved `Record<nodeId, color>` into the manifest under `node_colors`. Do not rely on `task.request.node_colors` — that field reflects the run-time hint, not the post-run rendered state, and after a colour reassignment they can diverge.
2. **At view**: the loader hydrates this map into the **snapshot payload's own `nodeColors` field**, not into `useNodeColorsStore`. Tool components, when `isSnapshotMode(viewMode)` (i.e. demo or share), read colours from the snapshot payload via a helper `useResolvedNodeColor(nodeId)` that dispatches by mode. Writing into `useNodeColorsStore` would mutate the *live* workspace's colours when the user is just inspecting a snapshot — a silent cross-state contamination.

The same "frozen at capture, never written back" rule applies to anything else read from `nodeColorsStore` (palette index, manually-assigned vs auto-assigned distinction, etc.).

### 3.6 Master switch — enable/disable demo snapshots

Demo snapshots are an **off-by-default** feature surfaced via a master switch. When off, every Save/Load button across every analytic tool is unmounted (not just disabled — fully gone), keeping the analytic UI uncluttered for users who aren't demoing.

Placement and state:

- **State**: a boolean `demoSnapshotsEnabled` on [`usePreferencesStore`](../../frontend/src/stores/preferencesStore.ts), persisted via the existing preferences sync. Default `false`.
- **UI location**: a `DropdownMenuCheckboxItem` labelled **"Enable demo snapshots"** in the sidebar's existing dropdown menu — same menu that already houses *Reset all hints* and the *Clear embedding cache* item ([Sidebar.tsx:349-394](../../frontend/src/components/layout/Sidebar.tsx#L349-L394)). Below the visible-views checkboxes, alongside the existing "settings-ish" actions.
- **Lifecycle of `user_cache/snapshots/`**: the folder is created lazily on first save (the first time the user actually captures a snapshot with demo mode enabled). Disabling demo mode does **not** delete the folder or its contents — the user's saved snapshots persist across enable/disable cycles. Folder removal is explicit, via the per-tool batch-delete UX (§5.7).

What flipping the switch does (and does NOT do):

- ON → analytic tools render their `<AnalysisFeatureHeader>` Save/Load slot (§3.7). Snapshot view machinery becomes user-reachable.
- OFF → Save/Load buttons unmount tool-wide. **In-progress snapshot views remain** — if the user is currently viewing a loaded snapshot when they flip the switch off, that view stays active until they exit it via the snapshot banner's "Exit snapshot view" control. We do not force-exit, because that would discard a state the user is actively looking at.
- The switch does **not** gate the infrastructure (store, codec, helpers, mutation guards). Those stay always-on so a currently-loaded snapshot continues to render correctly even with the switch toggled off.

### 3.7 Shared `<AnalysisFeatureHeader>` template

Each analytic tool currently builds its own `<CardHeader><CardTitle>...</CardTitle></CardHeader>` block inside its `*ParameterPanel.tsx` (e.g. [ConcordanceParameterPanel.tsx:121](../../frontend/src/features/analysis/concordance/components/ConcordanceParameterPanel.tsx#L121)). The header already uses `flex md:flex-row md:justify-between` — there's a right-side slot sitting empty. Rather than duplicate Save/Load wiring per tool, introduce a shared header component:

```tsx
// frontend/src/features/analysis/common/components/AnalysisFeatureHeader.tsx
interface AnalysisFeatureHeaderProps {
  tool: SnapshotToolKey;             // drives snapshot save/load wiring
  title: string | React.ReactNode;
  infoKey: string;                   // for <InfoIcon>
  infoTooltip: string;
  helpKey: string;                   // for <HelpIcon>
  helpTooltip: string;
}

// Renders: CardHeader > flex row >
//   left:  CardTitle + InfoIcon + HelpIcon  (today's pattern)
//   right: <SnapshotActions tool={tool} />   (Save + Load buttons, gated by
//           preferencesStore.demoSnapshotsEnabled; Load further gated by
//           "list returned ≥1 compatible snapshot for this tool")
```

Each tool's `*ParameterPanel.tsx` imports `<AnalysisFeatureHeader>` and replaces its `<CardHeader>` block with one line. The Save/Load logic lives once.

Phasing for the refactor:

- **Phase 0j**: build `<AnalysisFeatureHeader>` and migrate concordance as the pattern proof. Other tools keep their current per-tool headers.
- **Phase 2 (per tool)**: migrate quotation, token-frequency, sequential, topic-modeling alongside their respective save/load Phase-2 commits.

The migration is mechanical — each tool's header has the same structure, just different title text + info/help keys.

## 4. Size discipline

Bundles can grow if we're careless. Caps live in one constant table keyed by mode, so adding a new mode is adding one entry:

```ts
const SNAPSHOT_CAPS: Record<SnapshotMode, SnapshotCaps> = {
  demo: {
    maxSourceRowsPerBlock: 2_000,  // hard — per-block cap, NOT summed
    maxResultRows: 500_000,        // hard — refuse capture
    softWarnResultRows: 50_000,    // toast "snapshot will be large"
  },
  share: {
    maxSourceRowsPerBlock: null,   // no hard cap (subject to bundle-size warnings)
    maxResultRows: 500_000,
    softWarnResultRows: 50_000,
    softWarnSourceRowsPerBlock: 50_000,
    softWarnBundleBytes: 100_000_000, // 100 MB
  },
};
```

Rules:

- **Demo: hard-refuse capture if ANY selected source block exceeds `maxSourceRowsPerBlock`** (2 000). Cap is **per-block, not summed** — a multi-block capture (e.g. comparing two 1 100-row corpora) is fine as long as each block is teaching-sized. User-visible message: *"Demo snapshots cap each selected data block at 2 000 rows. The largest selected block has N rows — pick a smaller block or trim it first."*
- **Demo: do not include source rows in the bundle** regardless of size. (`maxSourceRowsPerBlock` is a *gate on capture eligibility*, not a payload sizing.)
- **Share (future): no source-row hard cap**, but a soft warning at 50k rows per block and a 100 MB bundle ceiling.
- **Hard cap on result rows is the same in both modes** (500k). 500k concordance rows ≈ 80 MB parquet, which is at the upper bound of practical browser handling.
- **No materialised result-cache parquet in either bundle.** Re-stated: the materialised result cache is a backend acceleration artifact. Snapshots ship the already-aggregated bins JSON, not the cache. Share-mode's `source.parquet` is a *separate* artifact — a column-projected slice of the source corpus, not the result cache.
- **No images.** Charts are re-rendered from data, not captured as PNGs. Keeps the bundle a *data* artifact, not a screenshot.
- **Eligibility surfaces as grey-out + `<DisabledReasonTooltip>`** on the Save button — same UX pattern as the Run-button disabled tooltips elsewhere in the analytic panels. The host feature computes the reason synchronously (largest block's row count, missing task, etc.) and threads it through the shared `<AnalysisFeatureHeader>`. Users see the explanation on hover *before* opening the Save dialog.

## 5. Per-tool capture/load specs

Each row below: what the snapshot must capture to reproduce the view, and where it lives in current code.

### 5.1 Concordance

| Field | Source | Notes |
| --- | --- | --- |
| Search settings (search_word, num_left/right_tokens, regex, whole_word, case_sensitive, tokens-mode + multi-keyword) | `ConcordanceRequest` payload | direct copy from the persisted request — picks up any new fields added between releases without code change |
| Node columns (`node_columns`) | `task.request` | direct copy |
| Node colours (`node_colors`) | `useNodeColorsStore.getState()` resolved against the result's node ids | **frozen at capture** — see §3.5; do not source from `task.request.node_colors` |
| Result rows | `POST /concordance/tasks/{id}/result` with `page_size: "all"` | parquet — schema: matched_text, left/right context, doc id, start/end idx |
| Dispersion bins per node | `/concordance/tasks/{id}/bins` | JSON, one entry per node — capture the **full response shape as-is** including per-text totals and selection sub-totals added post-2026-05-12 (commits d4d006b, 6abaa19). Do not normalise on the way out; preserve unknown fields so future bins enhancements load cleanly. |
| Materialise summaries | `task.request.materialize_summaries` | JSON |
| UI state (current node tab, expanded rows, column visibility, selection) | local feature state | view-state.json |
| Chart settings (bin count, chart type, x-axis category/number, scope dropdown) | local feature state | view-state.json |

**Result-row size**: the existing POST `/result` endpoint already supports body-override pagination ([concordance.py:321](../../backend/src/ldaca_wordflow/api/workspaces/analyses/concordance.py#L321)). Snapshot capture extends the override path to accept `page_size: "all"`, server-side capped at the same hard cap as the snapshot itself (500k rows — see §4). Capture-side enforcement: pre-check the task's total row count via the existing pagination response, abort with the soft-warn / hard-cap toast before issuing the full fetch.

**Loader**: hydrate the `concordance` slice in `useSnapshotViewStore` (typed as `LoadedSnapshot<ConcordanceSnapshotPayload>`). Components select from this slice when `isSnapshotMode(viewMode)`, else from the live `current_task_id`-driven React Query path. Keep the two completely separate — do not pipe snapshot rows through `analysisStore` (which is live-workspace state).

### 5.2 Quotation

| Field | Source | Notes |
| --- | --- | --- |
| Quotation settings (open/close patterns, surrounding tokens) | `QuotationRequest` | direct |
| Node columns/colors | `task.request` | direct |
| Result rows | `/quotation/tasks/{id}/result` (full) | parquet |
| Materialise summary | `task.request.materialize_summary` | JSON |
| UI state (selection, pagination, current node tab) | local state | view-state.json |

### 5.3 Token frequency

| Field | Source | Notes |
| --- | --- | --- |
| Tokeniser + filter settings | `TokenFrequencyRequest` | direct |
| **Applied stopword list** | resolved output of `loadMergedStopwords({ languages })` at capture time | **frozen at capture, not re-resolved on load.** Multi-language stopwords are merged per-corpus-language at runtime ([loadMergedStopwords.ts](../../frontend/src/lib/loadMergedStopwords.ts), commits b686919, 8674dea, e25ec3b). Since the snapshot has no corpus to re-derive languages from, capture the *applied* merged list verbatim — this is the same list rendered by `AppliedStopwordsDialog`. Storing only the language list would risk drift if the bundled stopword JSONs change between capture and load. |
| Frequency table | result endpoint | parquet (token, count, [doc count]) |
| Chart settings (incl. word-cloud canvas size memo) | local state | view-state.json — the responsive word-cloud (commit cc1539e) re-derives sizing on resize, so don't capture computed dimensions; capture only user-selected settings |
| **Click-to-concordance link state** | n/a | guarded — see §3.3 |

### 5.4 Sequential analysis (Trends)

| Field | Source | Notes |
| --- | --- | --- |
| Series definitions (expressions, group_by, sort) | `SequentialAnalysisRequest` | direct |
| Result table | result endpoint | parquet (long format: bucket, series, value) |
| Chart settings (chart type, x-axis category/number, selection) | local state | view-state.json |

### 5.5 Topic modeling

| Field | Source | Notes |
| --- | --- | --- |
| Model settings (num_topics, max_features, embedder, etc.) | `TopicModelingRequest` | direct |
| **Applied stopword list** | resolved at capture time | same rule as §5.3 — capture the merged, applied list (rendered by `AppliedStopwordsDialog`, commit 209f674), not the source languages. Post-fit stopword filter (commit 49b8973) means the *displayed* representative words depend on this list, so it must round-trip exactly. |
| Topic-term table (with words-per-topic up to `max(50, 2×setting)`, commit 163074d) | result endpoint | parquet |
| Document-topic table | result endpoint | parquet |
| Zoom domain, selected topic, hovered topic | local state | view-state.json |

### 5.6 Source projection (share mode only — designed, not implemented in v1)

Captured by Mode 2a, never by Mode 1. Reserved here so the v1 type system and loader dispatch already know about it.

| Field | Source | Notes |
| --- | --- | --- |
| Projected source rows | column-projected fetch from the workspace nodes' materialised parquet — only the columns the analysis touched | parquet; column list recorded in the manifest payload entry (`{ "kind": "source-projection", "columns": [...] }`). Capture must enforce that no column outside this list is included, otherwise the share-mode contract ("only the columns you used are shared") is silently broken. |
| Column list | computed at capture from the analysis settings + tool's known column dependencies | e.g. concordance needs the text column + doc-id; tokens-mode adds the tokens column; metadata columns used for grouping/filtering also included. **No** raw columns that the analysis never referenced. |
| Row alignment with result | implicit — recipient pages over the source-projection independently of the result table; cross-references (e.g. doc-id) link them on demand | The two tables are not row-aligned; they share doc-ids. |

Loader behaviour when the v1 (demo-only) build encounters a Mode 2a bundle: load result + bins as usual, set `capabilities.canFilterSourceRows = false` even if the manifest says true, show a notice "this snapshot includes shareable source rows your build version doesn't yet support — update to the latest Wordflow to use them". This is the graceful-degrade path that the typed payload list enables.

### 5.7 Save / Load / Delete UI

#### 5.7.1 Save (capture) button

- **Location**: right-side slot of `<AnalysisFeatureHeader>` (§3.7), top-right of each tool's title row.
- **Visibility**: rendered only when `preferencesStore.demoSnapshotsEnabled` is true. Otherwise the slot is empty / unmounted.
- **Enablement**: disabled with tooltip when no result is present yet, when the eligibility cap (§4) is exceeded, or while a save request is in flight.
- **Behaviour**: opens a small modal dialog with a name input (placeholder: tool + timestamp suggestion) and an optional description textarea. Inline-validates the name against the loaded snapshot list — shows "Name already exists" until the typed name is unique. Save POSTs the bundle; on success, dialog closes with a toast.

#### 5.7.2 Load button + dialog

- **Location**: right-side slot of `<AnalysisFeatureHeader>`, next to Save.
- **Visibility**: rendered only when `preferencesStore.demoSnapshotsEnabled` AND the snapshot list (for this tool) has ≥1 entry. Otherwise unmounted — no "empty load" state to confuse the user.
- **Dialog layout** (modelled on [`SampleDataPanel`](../../frontend/src/features/data-loader/components/SampleDataPanel.tsx)):
  - Per-row layout: `[ <title>  (flex-1) ]  [ Quote icon → README viewer ]  [ red Trash icon → per-snapshot delete ]  [ <size> ]  [ <version chip / "Incompatible" badge> ]  [ Open button ]`.
  - Per-row metadata block underneath (collapsed by default, expanded on click): capture date, source workspace + node names + total source rows, tool-specific `formatPreview()` rows (vocab size, num topics, search term + total hits — whatever the `preview` block declared).
  - README viewer: same `react-markdown` + `remark-gfm` stack as `SampleDataPanel`, pointed at the snapshot's `.md` sidecar via `GET /users/me/snapshots/{filename}/description`.
- **Footer**: Cancel + adaptive batch-delete button (§5.7.4).

#### 5.7.3 Per-snapshot delete (red bin icon)

- Confirmation modal lists: snapshot name, capture date, `tool_version`.
- Single Delete (destructive variant) + Cancel buttons.
- On success: list refreshes; if the deleted snapshot was the one currently loaded into `useSnapshotViewStore`, auto-exit to live mode and toast "Snapshot deleted — returned to live view".
- On failure (network, 404, permission): red toast; list refreshes so any externally-removed file disappears.

#### 5.7.4 Adaptive batch-delete button

Button label flips based on the live snapshot list state:

| List state for this tool | Button label | What it deletes |
| --- | --- | --- |
| ≥1 incompatible snapshot present | **"Delete stale snapshots"** | Only snapshots failing the compatibility predicate (§2.4). |
| 0 incompatible, ≥1 compatible | **"Delete all snapshots"** | Every snapshot for this tool. |
| 0 snapshots total | (button hidden — same as the Load button) | n/a |

Click → confirmation modal (lists count + version range affected for the stale variant; lists count + names for the all variant) → DELETE endpoint → list refresh.

Click-cost summary (matches the original ask):
- Delete one snapshot: 2 clicks (bin icon + confirm).
- Delete all incompatible: 2 clicks (button + confirm).
- Clear everything for a tool when a mix exists: 4 clicks max (stale-pass + all-pass).

## 6. Implementation phasing

**v1 ships Mode 1 only.** Every phase below is scoped to demo mode; share-mode hooks (types, manifest fields, capability bits, dispatching loader) are landed alongside as zero-cost forward-compat, but no share-mode capture path is implemented.

Designed so each phase is shippable on its own; you can stop after any phase and the app still works.

### Phase 0 — Infrastructure

Split into atomic sub-phases. **0a–0g have landed** (commits b52d0e1 … 6db28c1); **0h–0k remain** for the backend-mediated storage + master switch + shared header + compat predicate added in the third design pass.

#### Phase 0a–0g — landed
- [x] **0a** — Types, ViewMode union, SNAPSHOT_CAPS, `useSnapshotViewStore`, `isSnapshotMode` helper.
- [x] **0b** — Manifest codec (parse/emit) with Mode-2a graceful-degrade contract.
- [x] **0c** — Bundle codec on JSZip + hyparquet (no wasm, sidesteps Tauri/Binder host concerns).
- [x] **0d** — Dual-mode pagination contract (`PaginationSource` adapter).
- [x] **0e** — `useResolvedNodeColor` helper.
- [x] **0f** — `useToolSnapshotMode` selector + first mutation guard on Concordance's `handleRunOrUpdate`.
- [x] **0g** — Backend `page_size: "all"` override on POST `/concordance/.../result` with 500k cap.

#### Phase 0h — Backend snapshot storage + frontend API client
- [ ] Backend: add `get_user_snapshots_folder(user_id)` helper alongside `get_user_cache_folder` in [`utils.py`](../../backend/src/ldaca_wordflow/core/utils.py). Folder is `user_cache/snapshots/`, created lazily.
- [ ] Backend: new router `/users/me/snapshots` with the five endpoints in §2.5 (list, upload, download, description, single-delete, batch-delete). Save extracts the bundle's internal `manifest.json` to write the sidecar `.manifest.json`; auto-generates `.md` from manifest data. Lazy sidecar extraction on list when missing.
- [ ] Backend tests: per-user isolation (user A's snapshots invisible to user B), filename sanitisation rejection, lazy sidecar extract from a hand-built fixture zip, batch delete with and without the `incompatible_with` filter.
- [ ] Frontend: `snapshotsApi` client in `api/snapshots.ts` mirroring `filesApi` patterns (auth header passthrough, JSON-typed responses).
- [ ] Frontend tests: API client unit tests against a mocked fetch, covering each endpoint + error paths.

#### Phase 0i — Master switch
- [ ] Add `demoSnapshotsEnabled: boolean` to [`usePreferencesStore`](../../frontend/src/stores/preferencesStore.ts), default `false`. Persist via existing backend preferences sync.
- [ ] Add a `DropdownMenuCheckboxItem` "Enable demo snapshots" to the sidebar dropdown menu after the visible-views section (§3.6), between `DropdownMenuSeparator` and the existing `Reset all hints` item.
- [ ] Tests: store default, store persistence sync, sidebar menu renders the checkbox and toggles the store.

#### Phase 0j — `<AnalysisFeatureHeader>` shared component
- [ ] Build `frontend/src/features/analysis/common/components/AnalysisFeatureHeader.tsx` (§3.7). Accepts `tool`, `title`, `infoKey`, `helpKey`, tooltips. Renders the existing CardHeader pattern on the left, a `<SnapshotActions tool={tool} />` slot on the right. The slot returns `null` when `demoSnapshotsEnabled` is off — no DOM at all in that case.
- [ ] Refactor `ConcordanceParameterPanel.tsx` to use `<AnalysisFeatureHeader>` in place of its current `<CardHeader>` block. No behaviour change in live mode; just consolidates the header source. Snapshot Save/Load wires sit empty in this phase (Phase 1 fills them).
- [ ] Tests: header renders with title/info/help in live mode (no snapshot actions); slot mounts when `demoSnapshotsEnabled` flips on; concordance regression-tests still pass.

#### Phase 0k — Compatibility predicate
- [ ] Add `features/snapshot-view/compat.ts` with `TOOL_COMPATIBILITY` registry, `parseMajorMinor`, `isCompatibleSnapshot(snapshotVersion, tool, currentVersion)` (§2.4). The registry is empty in v1.
- [ ] Wire the current build's version through `import.meta.env` (Vite injects the package version at build time) into a single `getCurrentAppVersion()` helper, so all callers consult one source of truth.
- [ ] Tests: default predicate, override-allowlist predicate, edge cases (malformed version strings, missing patch component, leading `v`).

### Phase 1 — Concordance snapshot capture + load UI

#### Phase 1a — Save (capture) dialog
- [ ] **Eligibility gate**: before showing the Save button as enabled, check `max(rows across selected/processed nodes) <= SNAPSHOT_CAPS.demo.maxSourceRowsPerBlock` (2 000). When the largest block exceeds the cap, render the Save button disabled with `<DisabledReasonTooltip>` explaining which block is over and by how much. Multi-block selections are allowed as long as each block is under the cap individually.
- [ ] Save dialog: name input with inline validation against the loaded snapshot list (no overwrite confirm); optional description textarea; Save / Cancel.
- [ ] Capture flow: fetch full result via the Phase-0g `page_size: "all"` path; assemble the bundle in-memory using the Phase-0b/0c codec (including the `preview` block built from the in-hand result data); POST to `/users/me/snapshots`.
- [ ] Toast on success / failure. The Load button then becomes visible (or its count refreshes) because the list endpoint will now return ≥1 snapshot.
- [ ] Tests: name validation, eligibility gate, end-to-end capture against a mocked API.

#### Phase 1b — Load dialog (sample-data-style)
- [ ] Load dialog modelled on [`SampleDataPanel`](../../frontend/src/features/data-loader/components/SampleDataPanel.tsx): a `<Dialog>` listing each snapshot as a row. Per row: title + Quote-icon README viewer + **red Trash bin icon** + size + version chip / "Incompatible" badge.
- [ ] Per-snapshot delete: bin icon → confirmation modal with name + capture date + `tool_version` → DELETE endpoint → list refresh.
- [ ] Adaptive batch-delete button at dialog footer:
  - If any incompatible snapshots exist for this tool: label **"Delete stale snapshots"** — confirmation modal lists count + versions affected, calls DELETE with `?tool=concordance&incompatible_with=<current>`.
  - Otherwise: label **"Delete all snapshots"** — confirmation modal lists count, calls DELETE with `?tool=concordance` (no `incompatible_with`).
- [ ] If the currently-loaded snapshot is among those deleted, exit to live mode automatically.
- [ ] Load flow: clicking an Open button on a compatible snapshot → GET bundle bytes → decode via Phase-0c bundle codec → populate `useSnapshotViewStore.concordance` → set `viewMode = { kind: 'demoSnapshot' }`. Snapshot banner replaces the header's Save/Load slot, with an "Exit snapshot view" button.
- [ ] Mutation guards verified for every entry point listed in §3.2 (Phase-0f covers Run; this commit extends to Process All, Detach, Add to Workspace, tokens-mode controls).
- [ ] Cross-tool jump from frequency → concordance loaded in snapshot mode: toast, no jump.
- [ ] Tests: list dialog rendering with compatible + incompatible mix, per-row delete, both batch-delete variants, load → identical view round-trip, deleting currently-loaded snapshot exits the view.

### Phase 2 — Quotation, Frequency, Sequential (~1 day each)
Repeat the Phase-1 pattern. The factoring done in Phase 1 should make each subsequent tool a copy-paste of the capture/load skeleton with tool-specific field mapping.

### Phase 3 — Topic modeling (~2 days)
Larger result payloads (topic × term matrix). Confirm the hard cap holds; bump if needed. Re-rendering of the topic chart must work without the BERTopic model object — verify our chart code is purely data-driven (it should be).

### Phase 4 — Polish (~1 day)
- [ ] Toolbar treatment for snapshot mode (banner, distinct background, etc.) — make it visually impossible to mistake snapshot for live.
- [ ] "Snapshot info" tooltip showing manifest source data (workspace name at capture, capture date, source nodes).
- [ ] Optional: an in-tool "My Snapshots" drawer backed by IndexedDB. Lets users re-open recent snapshots without re-uploading. Pure-frontend, still no backend involvement.

## 7. Test plan

### 7.1 Round-trip parity (per tool)
- Capture in tool X with non-default settings + selection + pagination → save → reload → assert every visible value matches.

### 7.2 Mutation guard coverage
- For each tool in snapshot mode, click every mutation surface listed in §3.2 (or invoke the handler directly in a test). Assert no network request is made.

### 7.3 Cross-tool isolation
- Live concordance + snapshot quotation simultaneously → mutate concordance, snapshot quotation unaffected, no toasts on either side.

### 7.4 Bundle robustness
- Corrupt `manifest.json` → load fails gracefully with a specific error toast, app remains in live mode.
- Future schema version (`schema_version: 99`) → load refuses with "snapshot too new for this app version".
- Missing payload file referenced by manifest → load refuses with "snapshot is incomplete".

### 7.5 Cross-user (regression — even though it's frontend-only, future server-assisted variants must preserve this)
- Snapshot captured by user A, loaded in user B's browser → loads fine (it's just a file), no backend lookups occur, no cross-user state observed.

## 8. Open questions to resolve before starting

1. ~~**Full-result fetch endpoint**~~ — **resolved 2026-05-16**: extend the existing POST `/result` body-override schema (already wired through [`_apply_result_query_overrides`](../../backend/src/ldaca_wordflow/api/workspaces/analyses/concordance.py#L77)) to accept `page_size: "all"`, server-side capped at the 500k hard cap. Same pattern for quotation / token-frequency / sequential / topic endpoints. No new endpoint surface.
2. **Result-table size for topic modeling**: the document-topic matrix can be `n_docs × n_topics`; what's our 99th-percentile size in practice? If > 500k cells, consider sparse-row parquet encoding or capping the captured doc set.
3. **Snapshot inside a snapshot**: if a snapshot is loaded and the user then clicks a row that *would* normally cross-jump, do we (a) toast (current proposal), (b) suppress the click entirely so it doesn't look interactive, or (c) load a multi-tool snapshot if one was captured? (a) is simplest; (c) is a v2 feature.
4. **Future: server-assisted variant?** If we later want shareable URLs (one user shares snapshot with another), that's a separate design. Stay frontend-only for v1 — it's a feature, not a limitation.
5. **Tauri custom-scheme wasm loading** — proven to work for the existing app but parquet-wasm specifically streams the wasm module asynchronously; verify on Tauri before Phase 1 commits to it. If it fails, the fallback is `apache-arrow` JS-only decoding (slower but no wasm); benchmark first.

## 9. What this plan deliberately does *not* cover

- **AI-Annotator** — feature is still iterating; revisit after it stabilises.
- **Data loader / preprocessing / export tabs** — out of scope by design (snapshot is for *analysis views*, not workspace inputs).
- **Workspace snapshot** — different problem with different constraints (must re-engage backend, supports mutation). Out of scope.
- **Mode 2a (share snapshot) capture in v1** — designed (§10), hooks landed alongside Mode 1, but no capture path is implemented in v1. Recipient-side graceful-degrade is implemented (a v1 build that receives a Mode 2a bundle loads result + bins and reports the source-rows portion as not-yet-supported).
- **Mode 2b (re-runnable workspace fragment)** — explicitly rejected. Either requires browser-side polars/tokenisation (massive bundle) or recipient-side import into a Wordflow instance (security model + workspace-fragment ownership design — a different feature).
- **Collaborative editing of snapshots** — not a goal; snapshots are immutable artifacts.
- **Version migration of old snapshots when schema changes** — v1 refuses old/new schemas with a clear error. Migrations are a problem to solve once we have real users with old snapshots.

## 10. Mode 2a — share snapshot, future design

This section is **forward-looking only**. v1 implements Mode 1, lands the hooks listed below, and stops. Mode 2a becomes a follow-up project once the demo experience is in users' hands.

### 10.1 What additional capture work Mode 2a needs

- **Column dependency inference per tool** — given an analysis's settings, compute the minimum set of source columns needed to inspect its result. Each tool's `featureModule` exposes a `getRequiredColumns(request, taskMeta) → string[]`. This is the source of truth for the `source-projection.columns` manifest field.
- **Column-projected materialised export endpoint** — given a node id and a column list, return the relevant rows as a parquet stream. Most of this exists in `/workspaces/{id}/nodes/{node_id}/materialise`-class APIs; needs a `?columns=` projection parameter and a cap-aware mode. Verify cross-node coverage when an analysis spans multiple nodes.
- **Capture-time merge** — concatenate per-node projections into a single `source.parquet`, tagging each row with its source node id. Recipient pages over the merged table; the node-id column drives any per-node UI.
- **Manifest upgrades** — emit `mode: "share"`, `capabilities.canFilterSourceRows: true`, and the `source-projection` payload entry with the resolved column list.

### 10.2 What additional view work Mode 2a needs

- **Source-row inspector component** per tool. Drop-in next to the result table; reads from `loadedSnapshot.sourceProjection`; supports pure-frontend search/filter/sort.
- **Cross-link UI**: clicking a result row scrolls/filters the source-row inspector to matching doc-ids. This is new UX — does not exist in live mode (live mode browses the workspace directly).
- **Bundle-size warnings** at capture per §4 (`softWarnSourceRows`, `softWarnBundleBytes`).

### 10.3 What the v1 hooks deliver

So that Mode 2a doesn't become a re-architecture:

- `mode` field in manifest (already required in v1 — Mode 1 emits `"demo"`).
- Typed `payloads` array dispatched by `kind`; v1 emits `result` + `dispersion-bins`; Mode 2a adds `source-projection`.
- `capabilities` object on `LoadedSnapshot`; v1 sets `canFilterSourceRows: false`; Mode 2a sets it true.
- `sourceProjection: SourceProjectionTable | null` on every per-tool slice in `useSnapshotViewStore`; v1 keeps it `null`.
- `SNAPSHOT_CAPS` table keyed by mode; v1 has a `share` entry (commented as "not yet emitted") so adding share-mode is filling in handlers, not adding a schema.
- Three-arm `ViewMode` discriminated union; v1 only constructs the demo arm but `switch` exhaustiveness already mentions `shareSnapshot`.
- `isSnapshotMode(viewMode)` helper used at every guard site instead of inline string compares.
- Loader's graceful-degrade test (lands in Phase 0) proves that v1 builds load Mode 2a bundles safely with capabilities gated down.

This leaves Mode 2a as approximately: ① add the capture-time column-projection endpoint and emit the new payload kind, ② build the source-row inspector component per tool, ③ flip a capability bit and add a `share` entry to the caps table. No store rewrite, no manifest schema bump, no breaking change to v1 bundles.

---

**Recommended kickoff**: start with Phase 0 + Phase 1 in one session. The infrastructure validates the whole approach; concordance is the hardest tool to snapshot (most complex view state), so getting it right shapes everything that follows. The two-mode hooks ride along Phase 0 and do not extend the timeline appreciably — they're type-level forward-compat, not implementation work.
