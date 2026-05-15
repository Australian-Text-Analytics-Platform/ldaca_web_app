# Demo Snapshot — executable plan

**Status**: design-only, not implemented. Pick up in a fresh session.
**Drafted**: 2026-05-12
**Revised**: 2026-05-16 — refinements applied for naming collision with the analysis-lock machine, node-colour store migration, runtime-resolved stopwords, the `TokensColumnMismatchNotice`, dispersion-bins shape changes, full-result fetch path, dual-mode table pagination, and Tauri / Binder host verification. Branch: `feat/demo-snapshot` off `v0.4`.
**Scope**: analytic tools only — concordance, quotation, token-frequency, sequential-analysis, topic-modeling. AI-Annotator is deferred until the feature stabilises (mirroring the refactor plan's exclusion).
**Out of scope**: data loader, data preprocessing, export. A snapshot is a *read-only view of an analysis result*, not a serialised workspace; users should never be invited to trust snapshot data as a workspace input.

---

## 0. Naming convention (collision avoidance)

"snapshot" is already used unrelated to this feature: [useAnalysisLockMachine.ts](../../frontend/src/features/analysis/common/useAnalysisLockMachine.ts) uses `lockedNodesSnapshot`, `snapshotInput`, `LockedNodesSnapshot`, etc. for the at-Run-time freeze of selected nodes/columns. **The Demo Snapshot feature must consistently prefix its symbols with `demoSnapshot`** (or `DemoSnapshot` for types/components) so the two never alias. Reserved naming pattern:

- store: `useDemoSnapshotStore`
- per-tool slice fields: `demoSnapshotConcordance`, `demoSnapshotQuotation`, ...
- file extension and MIME label: `.ldaca-snapshot` is *user-facing*; internal code refers to "demo-snapshot bundle".
- mode flag value: `'live' | 'demoSnapshot'` (not bare `'snapshot'`).

Anywhere bare `snapshot` already exists in code, leave it — it means lock-machine state.

---

## 1. Why this is a frontend-only feature

A snapshot's hard requirement is **isolation from the live backend during view**. Any path that reads or writes server state *while a snapshot is open* risks: (a) leaking stale results into a different workspace, (b) reactivating GC'd parquet caches, (c) coupling snapshot lifetime to task lifetime, (d) creating cross-user attack surface.

The clean answer: the snapshot is a portable artifact the browser produces from data it already has, and the browser also consumes it. **Backend involvement during view: none.** Backend involvement during *capture* is minimal but not zero — we need a one-shot full-result fetch (see §5 and §8). After the bundle is written to disk the backend is no longer in the loop.

**Consequences of this choice** — accept up front:
- No server-side snapshot library. Users keep their files (download / re-upload, or local IndexedDB if we want a "My Snapshots" drawer later — but disk file is the v1).
- Snapshot format is versioned (`schema_version` field in manifest) so we can evolve it without breaking old files.
- Pagination of result tables is **client-side** in snapshot mode (the full table ships in the bundle). Bundle size is the practical cap; see §4 for size discipline. The existing tables paginate server-side via `page_index`/`page_size` overrides — they need a dual-mode pagination contract (see §3.4).

## 2. Bundle format

A zip file with the extension `.ldaca-snapshot` (or `.zip` for portability). Contents:

```
manifest.json                  required, schema_version + tool + capture metadata
settings.json                  required, all form/UI state needed to reproduce the view
view-state.json                required, ephemeral UI state (selections, pagination, expanded rows)
tables/
  result.parquet               primary result rows (per tool — see §5)
  dispersion-bins.json         concordance only — pre-aggregated 100 buckets
  ...                          additional per-tool payloads
```

Why this layout:
- **Parquet for tabular**: concordance/quotation hit rows can be tens of thousands. Parquet is ~10× smaller than JSON and decodes via `parquet-wasm` in the browser at ~5 MB/s.
- **JSON for everything else**: settings, bins, summaries. Inspectable, diffable, no decoder dependency.
- **Folder layout, not flat**: lets us add per-tool payloads without renaming.

### 2.1 `manifest.json` shape (proposed)

```jsonc
{
  "schema_version": 1,
  "tool": "concordance",                       // one of the analysis-tool keys
  "tool_version": "v0.3.0",                    // app version at capture
  "captured_at": "2026-05-12T03:14:00Z",
  "title": "user-chosen label",
  "source": {
    "workspace_id": "uuid-at-capture-time",    // for traceability only, never re-engaged
    "workspace_name": "...",
    "node_ids": ["..."],
    "node_labels": ["..."]
  },
  "payload_files": ["tables/result.parquet", "tables/dispersion-bins.json"]
}
```

`source` is for human reference and audit. Loaders **never** look up these IDs against the live backend.

## 3. Demo mode flag and mutation guards

### 3.1 Where the flag lives

One option per feature, e.g. `concordanceFeatureMode: 'live' | 'demoSnapshot'`. Recommended placement: a small `useDemoSnapshotStore` (zustand) keyed by tool. The bare name `useFeatureModeStore` was dropped to avoid implying it would gate other feature modes; this store is solely about Demo Snapshot view:

```ts
type FeatureMode = 'live' | 'demoSnapshot';
type DemoSnapshotStore = {
  mode: Record<ToolKey, FeatureMode>;
  setMode: (tool: ToolKey, mode: FeatureMode) => void;
  // Snapshot payload slices live alongside the flag so a single store
  // read tells a component both "am I in snapshot mode?" and "where's
  // the snapshot data?". One slice per tool — see §5 for shape.
  concordance: DemoSnapshotConcordancePayload | null;
  quotation: DemoSnapshotQuotationPayload | null;
  tokenFrequency: DemoSnapshotTokenFrequencyPayload | null;
  sequentialAnalysis: DemoSnapshotSequentialAnalysisPayload | null;
  topicModeling: DemoSnapshotTopicModelingPayload | null;
};
```

Reasoning: a per-tool slice (rather than one global flag) lets snapshot view in concordance coexist with live view in quotation — useful if the user is comparing.

### 3.2 What disables in snapshot mode

| UI surface | Live | Snapshot |
| --- | --- | --- |
| Run / Update primary action | enabled | **hidden** (replaced with "Exit snapshot view" button) |
| Process All / Materialise | enabled | **hidden** |
| Add to Workspace / Detach (all variants) | enabled | **hidden** |
| Clear Results | enabled | repurposed to "Exit snapshot view" |
| Pagination, sorting, column selection | enabled | enabled (pure-frontend operations) |
| Selection (chart bins, table rows) | enabled | enabled (pure-frontend operations) |
| Export buttons (CSV/parquet of the current view) | enabled | enabled — exports the snapshot's data, not workspace data |
| `TokensColumnMismatchNotice` (column-lacks-tokens banner) | enabled | **hidden** — we can't validate against a corpus we don't have, and there's no Run flow for the user to act on the warning |
| Analysis-lock indicators (`useAnalysisLockMachine`) | enabled | **fixed-locked appearance, no controls** — the snapshot is by definition a frozen run; show the locked state but no unlock/re-run control |
| Tokens-mode model picker, tokens-mode multi-keyword input | enabled | **disabled (read-only display of captured values)** |

Implementation pattern: each feature exposes a `viewMode` from its top-level component and threads it down. Mutation handlers early-return when `viewMode === 'demoSnapshot'`. **Don't rely on UI hiding alone** — handlers must also check, so a stale event handler can't fire a mutation.

### 3.3 Cross-tool jumps

Three jump paths exist today, all routed via `analysisStore.pendingConcordance` / similar pending payloads:

- **Token-frequency → Concordance**: click a frequency row → opens concordance tab pre-populated with `searchWord`. [token-frequency/hooks/useTokenFrequencyTaskFlow.ts:249](../../frontend/src/features/analysis/token-frequency/hooks/useTokenFrequencyTaskFlow.ts#L249) (line shifted from :223 after the responsive-cloud + memoisation refactor).
- **AI-Annotator → Concordance**: similar pattern, scoped to a selected category. (Deferred — AI-Annotator is still iterating.)
- **Quotation → Concordance**: not currently implemented, but if added in the future, applies to the same rule.

Rule for snapshot mode: **cross-tool jumps are no-ops with a toast** ("Snapshot view — open the tool live to follow this link"). Implementing them in snapshot mode would require capturing snapshots of multiple tools together, which v1 doesn't do.

Implementation: jump-emitting code reads `featureMode` of its *own* tool. If `'demoSnapshot'`, suppress and toast. (The receiving tool also guards in case a stale pending payload survives a mode switch.)

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
2. **At view**: the loader hydrates this map into the **snapshot payload's own `nodeColors` field**, not into `useNodeColorsStore`. Tool components, when `featureMode === 'demoSnapshot'`, read colours from the snapshot payload via a helper like `useResolvedNodeColor(nodeId)` that dispatches by mode. Writing into `useNodeColorsStore` would mutate the *live* workspace's colours when the user is just inspecting a snapshot — a silent cross-state contamination.

The same "frozen at capture, never written back" rule applies to anything else read from `nodeColorsStore` (palette index, manually-assigned vs auto-assigned distinction, etc.).

## 4. Size discipline

Bundles can grow if we're careless. Targets:

- **Soft warn** when result rows > 50k (toast at capture: "Snapshot will be large — N rows. Continue?").
- **Hard cap** at 500k rows — refuse to capture and show "Filter or paginate first". 500k concordance rows ≈ 80 MB parquet, which is at the upper bound of practical browser handling.
- **No materialised parquet in the bundle.** Re-stated: the materialised cache is a backend acceleration artifact. Snapshots ship the already-aggregated bins JSON, not the parquet.
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

**Loader**: hydrate the `demoSnapshotConcordance` slice in `useDemoSnapshotStore`. Components select from this slice when `featureMode === 'demoSnapshot'`, else from the live `current_task_id`-driven React Query path. Keep the two completely separate — do not pipe snapshot rows through `analysisStore` (which is live-workspace state).

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

## 6. Implementation phasing

Designed so each phase is shippable on its own; you can stop after any phase and the app still works.

### Phase 0 — Infrastructure (~1–2 days, slightly longer than originally scoped due to dual-mode pagination + host verification)
- [ ] Pick a parquet decoder. `parquet-wasm` is the most-used; benchmark on a 50k-row concordance result. Acceptance: decode + render < 2 s on a mid-spec laptop.
- [ ] **Verify parquet-wasm + JSZip load under all three runtime hosts**: web (current Vite dev/build), Tauri desktop (custom `tauri://` scheme, may need MIME registration for `.wasm`), and Binder (proxied via JupyterServerProxy under a non-root path). A wasm-asset load that works in `vite dev` can silently break on Tauri or behind the Jupyter proxy. Fix any host-specific asset path issues in Phase 0, not after Phase 1.
- [ ] Pick a zip library. `JSZip` is the obvious default; verify the same host-host compatibility.
- [ ] Add `useDemoSnapshotStore` (zustand) with the per-tool slices defined in §3.1.
- [ ] **Land the dual-mode pagination contract** (§3.4) — pick adapter vs. hook and apply to one table (concordance) so Phase 1 has a working pattern to copy. This is the single most reused piece of infrastructure; don't punt it to Phase 1.
- [ ] Implement the `useResolvedNodeColor(nodeId)` helper that dispatches between `nodeColorsStore` and the snapshot's frozen colour map (§3.5). Swap one call site in concordance to use it; assert behaviour unchanged in live mode.
- [ ] Wire the flag into one tool's UI (concordance) to prove the mutation-guard pattern works end-to-end — no actual snapshot file yet; just a manual `setMode('concordance', 'demoSnapshot')` from devtools to verify all mutation entry points (including `TokensColumnMismatchNotice`, tokens-mode model picker, multi-keyword input, lock indicators) are properly gated.
- [ ] Extend the POST `/result` body-override schema on at least the concordance endpoint to accept `page_size: "all"` (server-side capped at 500k). Add a backend test asserting the cap is enforced. Other tools' endpoints get the same extension in their phase.

### Phase 1 — Concordance snapshot (~2-3 days)
- [ ] Capture flow: a "Save view" button in the result panel. Reads the live state, fetches full result (with hard-cap check), serialises to bundle, triggers browser download.
- [ ] Load flow: a "Load view" button at tool entry (also accept drag-drop of `.ldaca-snapshot` files anywhere on the tool). Decodes the bundle, populates the snapshot slice, sets `featureMode = 'snapshot'`.
- [ ] Exit flow: "Exit snapshot view" button. Clears the snapshot slice, sets `featureMode = 'live'`. The original live state was never touched, so the user returns to whatever was there before.
- [ ] Mutation guards verified for every entry point listed in §3.2.
- [ ] Cross-tool jump from frequency → concordance loaded in snapshot mode: shows toast, no jump (Concordance ignores the pending payload while in snapshot mode).
- [ ] Tests: capture → save → reload → identical view. Round-trip parity.

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
- **Collaborative editing of snapshots** — not a goal; snapshots are immutable artifacts.
- **Version migration of old snapshots when schema changes** — v1 refuses old/new schemas with a clear error. Migrations are a problem to solve once we have real users with old snapshots.

---

**Recommended kickoff**: start with Phase 0 + Phase 1 in one session. The infrastructure validates the whole approach; concordance is the hardest tool to snapshot (most complex view state), so getting it right shapes everything that follows.
