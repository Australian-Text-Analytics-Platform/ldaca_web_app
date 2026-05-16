# Demo Snapshot — executable plan

**Status**: design-only, not implemented. Pick up in a fresh session.
**Drafted**: 2026-05-12
**Revised**: 2026-05-16 — refinements applied for naming collision with the analysis-lock machine, node-colour store migration, runtime-resolved stopwords, the `TokensColumnMismatchNotice`, dispersion-bins shape changes, full-result fetch path, dual-mode table pagination, and Tauri / Binder host verification. Branch: `feat/demo-snapshot` off `v0.4`.
**Revised**: 2026-05-16 (later same day) — introduced a two-mode design: Mode 1 (demo, implemented in v1) and Mode 2a (share, design-only, hooks left in v1). See §0.5.
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

The clean answer: the snapshot is a portable artifact the browser produces from data it already has, and the browser also consumes it. **Backend involvement during view: none, in either mode.** Backend involvement during *capture* is minimal but not zero — we need a one-shot full-result fetch (see §5 and §8), and Mode 2a adds a column-projected source-rows fetch on top. After the bundle is written to disk the backend is no longer in the loop.

**Consequences of this choice** — accept up front:
- No server-side snapshot library. Users keep their files (download / re-upload, or local IndexedDB if we want a "My Snapshots" drawer later — but disk file is the v1).
- Snapshot format is versioned (`schema_version` field in manifest) so we can evolve it without breaking old files.
- Pagination of result tables is **client-side** in snapshot mode (the full table ships in the bundle). Bundle size is the practical cap; see §4 for size discipline. The existing tables paginate server-side via `page_index`/`page_size` overrides — they need a dual-mode pagination contract (see §3.4).

## 2. Bundle format

A zip file with the extension `.ldaca-snapshot` (or `.zip` for portability). Contents (Mode 1 ships a subset; Mode 2a adds source-projection):

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
- **Parquet for tabular**: concordance/quotation hit rows can be tens of thousands. Parquet is ~10× smaller than JSON and decodes via `parquet-wasm` in the browser at ~5 MB/s.
- **JSON for everything else**: settings, bins, summaries. Inspectable, diffable, no decoder dependency.
- **Folder layout, not flat**: lets us add per-tool payloads without renaming.
- **Mode is a manifest field, not a layout split**: a Mode 2a bundle differs from a Mode 1 bundle only by the presence of a `source-projection` payload entry plus `mode: "share"`. A loader that hands Mode 2a to a recipient who's running an older v1 build degrades gracefully — it can load result/bins, ignore the unknown source-projection payload, and inform the user "this snapshot has share-mode data your build can't open yet".

### 2.1 `manifest.json` shape

```jsonc
{
  "schema_version": 1,
  "mode": "demo",                              // "demo" | "share" — see §0.5
  "tool": "concordance",                       // one of the analysis-tool keys
  "tool_version": "v0.4.4",                    // app version at capture
  "captured_at": "2026-05-16T07:30:00Z",
  "title": "user-chosen label",
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

## 4. Size discipline

Bundles can grow if we're careless. Caps live in one constant table keyed by mode, so adding a new mode is adding one entry:

```ts
const SNAPSHOT_CAPS: Record<SnapshotMode, SnapshotCaps> = {
  demo: {
    maxSourceRows: 2_000,        // hard — refuse capture if exceeded
    maxResultRows: 500_000,      // hard — refuse capture
    softWarnResultRows: 50_000,  // toast "snapshot will be large"
  },
  share: {
    maxSourceRows: null,         // no hard cap (subject to bundle-size warnings)
    maxResultRows: 500_000,
    softWarnResultRows: 50_000,
    softWarnSourceRows: 50_000,
    softWarnBundleBytes: 100_000_000, // 100 MB
  },
};
```

Rules:

- **Demo: hard-refuse capture if the sum of rows across selected/processed data blocks exceeds `maxSourceRows`** (2 000). User-visible message: *"Demo Snapshot is for small teaching-sized data (≤ 2 000 source rows). To share this result with collaborators, use Share Snapshot instead (coming soon)."* — telegraphs the future second mode without promising a date.
- **Demo: do not include source rows in the bundle** regardless of size. (`maxSourceRows` is a *gate on capture eligibility*, not a payload sizing.)
- **Share (future): no source-row hard cap**, but a soft warning at 50k rows and a 100 MB bundle ceiling.
- **Hard cap on result rows is the same in both modes** (500k). 500k concordance rows ≈ 80 MB parquet, which is at the upper bound of practical browser handling.
- **No materialised result-cache parquet in either bundle.** Re-stated: the materialised result cache is a backend acceleration artifact. Snapshots ship the already-aggregated bins JSON, not the cache. Share-mode's `source.parquet` is a *separate* artifact — a column-projected slice of the source corpus, not the result cache.
- **No images.** Charts are re-rendered from data, not captured as PNGs. Keeps the bundle a *data* artifact, not a screenshot.

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

## 6. Implementation phasing

**v1 ships Mode 1 only.** Every phase below is scoped to demo mode; share-mode hooks (types, manifest fields, capability bits, dispatching loader) are landed alongside as zero-cost forward-compat, but no share-mode capture path is implemented.

Designed so each phase is shippable on its own; you can stop after any phase and the app still works.

### Phase 0 — Infrastructure (~1–2 days, slightly longer than originally scoped due to dual-mode pagination + host verification)
- [ ] Pick a parquet decoder. `parquet-wasm` is the most-used; benchmark on a 50k-row concordance result. Acceptance: decode + render < 2 s on a mid-spec laptop.
- [ ] **Verify parquet-wasm + JSZip load under all three runtime hosts**: web (current Vite dev/build), Tauri desktop (custom `tauri://` scheme, may need MIME registration for `.wasm`), and Binder (proxied via JupyterServerProxy under a non-root path). A wasm-asset load that works in `vite dev` can silently break on Tauri or behind the Jupyter proxy. Fix any host-specific asset path issues in Phase 0, not after Phase 1.
- [ ] Pick a zip library. `JSZip` is the obvious default; verify the same host-host compatibility.
- [ ] Add `useSnapshotViewStore` (zustand) with the three-arm `ViewMode` discriminated union and per-tool `LoadedSnapshot` slices defined in §3.1. **Wire the `sourceProjection` field on every slice from day one**, hard-coded to `null` in demo mode — the field's presence is the central forward-compat hook.
- [ ] Add the `SNAPSHOT_CAPS` constant table from §4 and the `isSnapshotMode(viewMode)` helper. Reference these everywhere instead of inline strings.
- [ ] **Land the dual-mode pagination contract** (§3.4) — pick adapter vs. hook and apply to one table (concordance) so Phase 1 has a working pattern to copy. This is the single most reused piece of infrastructure; don't punt it to Phase 1.
- [ ] Implement the `useResolvedNodeColor(nodeId)` helper that dispatches between `nodeColorsStore` and the snapshot's frozen colour map (§3.5). Swap one call site in concordance to use it; assert behaviour unchanged in live mode.
- [ ] **Manifest + payloads loader/writer**: parse and emit the §2.1 manifest shape with the `mode`, `capabilities`, and typed `payloads` array. The loader must dispatch by `kind`, ignore unknown kinds with a console warn, and fail fatal on missing `kind: "result"`. Add a unit test that loads a hand-crafted Mode-2a manifest (mode: "share", payload kind: "source-projection") into the v1 build and asserts:
  - capabilities are gated down (`canFilterSourceRows` forced to false),
  - the user-facing notice ("update Wordflow to use shareable source rows") appears,
  - no source-projection-dependent UI surface is wired up.
  - This locks in the graceful-degrade contract before any share-mode capture code exists.
- [ ] Wire the flag into one tool's UI (concordance) to prove the mutation-guard pattern works end-to-end — no actual snapshot file yet; just a manual `setMode('concordance', { kind: 'demoSnapshot' })` from devtools to verify all mutation entry points (including `TokensColumnMismatchNotice`, tokens-mode model picker, multi-keyword input, lock indicators) are properly gated, and that `isSnapshotMode` is what's consulted, not raw string compares.
- [ ] Extend the POST `/result` body-override schema on at least the concordance endpoint to accept `page_size: "all"` (server-side capped at 500k). Add a backend test asserting the cap is enforced. Other tools' endpoints get the same extension in their phase.

### Phase 1 — Concordance snapshot (~2-3 days)
- [ ] **Eligibility gate**: before exposing the "Save view" button, check `sum(rows across selected/processed nodes) <= SNAPSHOT_CAPS.demo.maxSourceRows` (2 000). If over, replace the button with a disabled-tooltip surface explaining the limit (referencing the share-mode future).
- [ ] Capture flow: a "Save view" button in the result panel. Reads the live state, fetches full result (with hard-cap check), serialises to bundle (manifest with `mode: "demo"`, `capabilities.canFilterSourceRows: false`, no source-projection payload), triggers browser download.
- [ ] Load flow: a "Load view" button at tool entry (also accept drag-drop of `.ldaca-snapshot` files anywhere on the tool). Decodes the bundle, populates the snapshot slice, sets `viewMode = { kind: 'demoSnapshot' }`.
- [ ] Exit flow: "Exit snapshot view" button. Clears the snapshot slice, sets `viewMode = { kind: 'live' }`. The original live state was never touched, so the user returns to whatever was there before.
- [ ] Mutation guards verified for every entry point listed in §3.2.
- [ ] Cross-tool jump from frequency → concordance loaded in snapshot mode: shows toast, no jump (Concordance ignores the pending payload while in snapshot mode).
- [ ] Tests: capture → save → reload → identical view. Round-trip parity. Also: a fixture file with `mode: "share"` loads cleanly with capabilities gated down (proves the forward-compat contract from Phase 0 still holds with real data).

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
