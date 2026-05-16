# Demo snapshot — implementation playbook

> **Companion to `plan.md`.** That document is the design rationale; this one is the step-by-step recipe for wiring snapshot mode into a new (or existing) analytic tool. Written after the v1 build shipped for concordance, quotation, token-frequency, sequential-analysis (Trends), and topic-modelling, so the steps and caveats reflect what actually trips up implementers, not what theory predicts.

**Audience**: anyone adding snapshot mode to a new analytic tool, or porting one of the existing five to a refactored architecture.

**Pre-reads**: `plan.md` §0–§3 (naming, store, mode types).

---

## 1. The architectural commitment in one paragraph

A snapshot is **the live UI rendered against frozen data**, not a parallel viewer. Each analytic tool's React tree continues to read its existing live state hooks; the snapshot feature inserts a layer that *shadows* those live values with captured data when the per-tool view-mode flips to `demoSnapshot`. This pattern is called **effective-value dispatch**: rename live state with a `live` prefix at the source, then introduce a same-named variable (without the prefix) that conditionally reads from the loaded snapshot. Downstream consumers — panels, charts, hooks like `useSequentialAnalysisTaskFlow` — read the shadowed name and naturally pick up snapshot data. Side-effects that touch the backend (Run, Clear, Update, Detach, persistence on chart-type change, post-fit re-aggregation) are wrapped to early-return in snapshot mode. The Save/Load buttons live in the shared `<SnapshotActions>` (mounted via `<AnalysisCardLayout>`'s `snapshot` slot, or via `<AnalysisFeatureHeader>` for concordance which uses a different chrome component).

The benefit: a snapshot view inherits every visual feature of the live tool — pagination, chart legends, sort, filter, tooltips, exports, colour palettes — without duplicating the rendering code. The risk: any side-effect path you forget to gate will silently fire against the live workspace or the live task store.

---

## 2. Per-tool checklist

Order matters. Do steps 1–3 before step 4 so the JSX compile-fails cleanly when you forget a wire.

### Step 1 — Author the capture hook

`src/features/analysis/<tool>/hooks/use<Tool>SnapshotCapture.ts`

Inputs: workspaceId, workspaceName, the captured request (typed against the tool's `<Tool>Request`), the live result, selected nodes, `getNodeRowCount`, `getAuthHeaders`. Output: an async `(filename, description) => Promise<void>` that assembles the bundle and uploads via `snapshotsApi.upload`.

Required manifest fields (from `SnapshotManifest` in `features/snapshot-view/types.ts`):
- `schema_version: 1`, `mode: 'demo'`, `tool: <SnapshotToolKey>`, `tool_version` (from `getCurrentAppVersion()`), `captured_at` (ISO).
- `title` — strip the tool-key prefix from `filename` and the `.ldaca-snapshot` suffix. **The prefix is `${SnapshotToolKey}-`, not the user-facing label.** Tool keys use underscores (`token_frequencies`, `sequential_analysis`, `topic_modeling`); the on-disk filename inherits that.
- `source` — `workspace_id`, `workspace_name`, `node_ids`, `node_labels`, **`per_block_rows`** (positionally aligned with `node_ids`), `total_source_rows` (sum).
- `capabilities` — usually `{ canPaginate, canSortAndFilterResult: true, canExport: true, canFilterSourceRows: false, canCrossJump: false }`. `canPaginate` is true only when the result genuinely has pagination state worth preserving.
- `preview` — tool-specific summary stats (declared per-tool arm in `SnapshotPreview`).
- `payloads` — minimum `{ kind: 'result', path: 'tables/result.json' }`, plus `{ kind: 'settings', path: 'settings.json' }` when a request is captured.
- `node_colors` — read from `useNodeColorsStore.getState().colors` at capture time, filter to the selected `node_ids`.

Pre-flight eligibility check via `checkSnapshotEligibility({ mode: 'demo', perBlockSourceRows: [...], resultRows: 0 })`. Throw a `CaptureError` with a `reason` field — the host UI surfaces the `message` as a toast.

**Materialise hard-require** (concordance, quotation): a `materialized` boolean input gates whether the bundle can be captured. Throws if the live result hasn't gone through Process All — the load-side viewer can't render the unmaterialised shape. Token-freq, sequential, topic-modelling don't materialise so the gate is omitted.

**Reference-first node ordering** (token-freq only): the manifest's `node_ids` must match the captured request's order so the load-side effective-reference dispatch finds the captured reference at `node_ids[0]`. Build a `captureSelectedNodes` array via `orderedPanelNodeIds`, not raw `livePanelSelectedNodes`.

### Step 2 — Author the load hook

`src/features/analysis/<tool>/hooks/use<Tool>SnapshotLoad.ts`

A `useCallback` returning `(filename) => Promise<void>` that:
1. Downloads via `snapshotsApi.download`.
2. Decodes via `readBundle` from `@/features/snapshot-view`.
3. Validates `manifest.tool` matches the tool key. Throw a typed `<Tool>SnapshotLoadError` on mismatch.
4. Reads `result` payload (required) and `settings` payload (optional).
5. Populates the store via `useSnapshotViewStore.getState().loadSnapshot(toolKey, loaded, DEMO_SNAPSHOT_MODE)`.
6. Surfaces parser degradations (`source-projection-unsupported`) as `toast.info(...)`.

Export a `<Tool>SnapshotPayload` interface — the discriminated payload shape held by `LoadedSnapshot.payload`. Other code in the feature reads from `loadedSnapshot.payload.result` / `.settings`, so the type must be exact.

### Step 3 — Author the banner component

`src/features/analysis/<tool>/components/<Tool>SnapshotBanner.tsx`

Pure copy-paste from any of the existing five. Reads `useSnapshotViewStore((s) => s.snapshots.<toolKey>)`, renders an amber-tinted card with title + captured timestamp + tool version + workspace name, and an Exit button that calls `exitSnapshot(toolKey)`.

The only per-tool variation: the `toolKey` slug and the slice selector. Everything else is shared visual styling.

### Step 4 — Refactor the feature for effective-value dispatch

This is the big one. In `<Tool>Feature.tsx`:

#### 4.1 Add the snapshot store hooks **early** (before colour/lock hooks that depend on the shadowed `panelSelectedNodes`)

```tsx
const snapshotMode = useToolSnapshotMode('<toolKey>');
const loadedSnapshot = useSnapshotViewStore(
  (s) => s.snapshots.<toolKey>,
) as LoadedSnapshot<<Tool>SnapshotPayload> | null;
const inSnapshotMode = isSnapshotMode(snapshotMode) && loadedSnapshot != null;
```

#### 4.2 Rename the live state with `live` prefix at the source

| Live destructure | Rename to |
|---|---|
| `panelSelectedNodes` from `useAnalysisLock` | `livePanelSelectedNodes` |
| `result` / `results` from `useSafeResult` | `liveResult` / `liveResults` |
| `nodeColors` from `useNodeColorManagement` | `liveNodeColors` |
| `lastCompareNodeIds`, `referenceNodeId` (token-freq) | `liveLastCompareNodeIds`, `liveReferenceNodeId` |
| `tokensModel` (token-freq) | `liveTokensModel` |

#### 4.3 Add same-named shadow values via `useMemo` or plain expression

For each renamed value, add a same-named variable that reads from the snapshot when `inSnapshotMode`, else from the live source.

```tsx
const panelSelectedNodes = useMemo<WorkspaceNodeLike[]>(() => {
  if (!inSnapshotMode || !loadedSnapshot) return livePanelSelectedNodes;
  const { node_ids, node_labels, per_block_rows, total_source_rows } =
    loadedSnapshot.manifest.source;
  const evenSplit = node_ids.length > 0
    ? Math.floor(total_source_rows / node_ids.length)
    : 0;
  return node_ids.map((id, idx) => ({
    id,
    node_id: id,
    name: node_labels[idx] ?? id,
    shape: [per_block_rows?.[idx] ?? evenSplit, 0] as [number, number],
  }));
}, [inSnapshotMode, loadedSnapshot, livePanelSelectedNodes]);
```

**Use plain expressions, not `useMemo`, when the dispatch is a one-line refinement** (`const x = inSnapshotMode && loadedSnapshot ? snap : live`). The React Compiler complains about manual memoisation on refinement-style dispatches; plain expressions let it decide. See caveat §3.5.

#### 4.4 Shadow `nodeColors` and palette swatches

The live `useNodeColorsStore` does **not** carry entries for the captured node IDs (they may not exist in the live workspace at all). Shadow `nodeColors` with `manifest.node_colors`:

```tsx
const nodeColors: Record<string, string> =
  inSnapshotMode && loadedSnapshot
    ? loadedSnapshot.manifest.node_colors
    : liveNodeColors;
```

Don't override only `getColorForNode` — the parameter panel's colour-picker swatch reads `nodeColors[id]` directly.

#### 4.5 Gate side-effect handlers

Every backend-touching handler must early-return in snapshot mode:
- `handleAnalyze` / `handleRunOrUpdate`
- `handleClear` / `handleClearResults`
- `handleDetach` (sequential, topic-modelling)
- **`handleUpdateExactTopicCount`** (topic-modelling re-aggregation — the trickiest)
- `handleChartTypeChange` — wrap with `effHandleChartTypeChange` that only sets local state, skips the backend `postSequentialAnalysisTaskResult`
- Token-click handlers (token-freq) that navigate to other tools or persist stopword changes
- Column-selection change handlers

A useful pattern: name the wrapped versions with an `eff` prefix (`effHandlePageChange`, `effHandleSort`, `effHandleTokenRightClick`) and pass those to the panels. Original handlers stay declared so other paths (test setup, hydration) keep working.

#### 4.6 Skip live-mode auto-effects in snapshot mode

Effects that auto-populate state from live workspace state (auto-select time column, auto-compute sampling fractions, auto-pick tokens model) must early-return `if (inSnapshotMode) return;`. Otherwise they'll fight the snapshot hydration effect (§4.7).

#### 4.7 Add a snapshot hydration effect

Mirror what the live tool's `onHydratedRequest` callback does, but read from `loadedSnapshot.payload.settings` / `.result.analysis_params`. Fires once when `inSnapshotMode` flips true; populates the parameter-panel state so the display matches the captured run.

```tsx
useEffect(() => {
  if (!inSnapshotMode || !loadedSnapshot) return;
  const settings = loadedSnapshot.payload.settings;
  if (!settings) return;
  if (typeof settings.random_seed === 'number') setRandomSeed(settings.random_seed);
  // …
}, [inSnapshotMode, loadedSnapshot]);
```

For features with complex hydration paths (sequential, topic-modelling), this effect is the longest piece of the refactor. Carefully cover every panel-display state variable.

#### 4.8 Wire `<Tool>SnapshotBanner` above the parameter panel

```tsx
return (
  <div className="space-y-4">
    {inSnapshotMode && <<Tool>SnapshotBanner />}
    {/* existing parameter card */}
    {/* existing results panel */}
  </div>
);
```

#### 4.9 Build the live capture request and wire `useTool SnapshotCapture`

The capture hook needs a `<Tool>Request | null`. Build it from current live form state via a plain expression (not `useMemo`) — returns `null` when prerequisites missing (no node, no column, etc.). Same shape as what the analyse flow would post to the backend.

Compose a `saveSnapshotDisabledReason` string by case-analysing the live state: no node → "Select a data block first."; row count > 2,000 → "block too large"; missing result → "Run the analysis first"; etc. The reason becomes the hover tooltip on a disabled Save button.

#### 4.10 Pass the snapshot slot through `<AnalysisCardLayout>` (or `<AnalysisFeatureHeader>` for concordance)

```tsx
snapshot={{
  tool: '<toolKey>',
  onSave: handleSaveSnapshot,
  saveDisabledReason: saveSnapshotDisabledReason,
  onOpen: handleOpenSnapshot,
  nodeLabels: livePanelSelectedNodes
    .map((n) => (n.name as string | undefined) ?? (n.id as string | undefined) ?? '')
    .filter((s) => s.length > 0),
}}
```

`nodeLabels` pre-populates the Save dialog's filename input with `Honi-Soit-2026-05-16` instead of `demo-2026-05-16`. Pass `livePanelSelectedNodes` (not the shadowed one) so the captured snapshot's own filename hint stays stable across loads.

### Step 5 — Thread `readOnly` through panels

Both `<Tool>ParameterPanel` and `<Tool>ResultsPanel` need a `readOnly?: boolean` (or equivalent `inputsDisabled` for token-freq/topic-modelling). Wired from the feature via `readOnly={inSnapshotMode}`. The panels gate:

- Parameter panel: every form input. The node-selection block is locked via the existing `isLocked` (passed as `isLocked || inSnapshotMode`) plus a snapshot-specific `lockedMessage` ("Viewing a saved snapshot — selection is frozen.").
- Results panel: client-side display controls (legend toggle, sort, pagination, period selection, chart-type select, stopword filter) **stay active**; backend-touching controls (detach, re-aggregation slider, post-fit persistence) get gated.

Some panel inputs are post-fit display caps that work entirely client-side on the captured payload. **Don't gate these.** Examples:
- Token-frequency stopword textarea — filters `appliedStopSet` which drives client-side `deriveNodeDisplayResults`.
- Topic-modelling "Words per topic" — slices each topic's `representative_words` array.
- Concordance dispersion lowercase matches — re-merges series keys client-side from per-bin counts.

For the topic-modelling words-per-topic input specifically, the locked-reason tooltip needs a snapshot-aware override — the default "Clear Results to fit with a higher count" is misleading because the user can't clear/re-fit in snapshot mode. Pass `representativeWordsCountLockedReason` to the panel with a snapshot-friendly string.

### Step 6 — Tests

Add a `__tests__/` folder under the tool with:
- `<Tool>SnapshotBanner.test.tsx` — three tests: renders nothing when no snapshot, renders title/version/workspace when loaded, Exit click resets the store.
- `use<Tool>SnapshotLoad.test.tsx` — four tests: happy-path load, wrong-tool rejection, missing-result-payload, settings-undefined fallback.

Patterns to copy verbatim from `token-frequency/__tests__/` (the cleanest set):
- Build the manifest with a `makeManifest(overrides)` helper.
- Build the zip blob with a `buildBundleBlob(manifest, result, settings?)` helper.
- Mock `useAuth` to return empty headers.
- Spy on `snapshotsApi.download`.
- Wrap store mutations in `act()`.

---

## 3. Caveats from this implementation

### 3.1 Filename prefix must match the tool key, not the user-facing label

The filename pattern is `${SnapshotToolKey}-${name}.ldaca-snapshot`. Tool keys use underscores (`token_frequencies`, `sequential_analysis`, `topic_modeling`); the user-facing labels do not (Token Frequency, Trends, Topic Modelling). The title-scrubbing regex in the capture hook **must** use the underscore form:

```ts
// CORRECT
title: filename.replace(/^token_frequencies-/, '').replace(/\.ldaca-snapshot$/, '')

// WRONG — leaves `token_frequencies-` visible in the load dialog
title: filename.replace(/^token-frequency-/, '').replace(/\.ldaca-snapshot$/, '')
```

This bug shipped in two tools (token-frequency and sequential-analysis) before being caught. Verify by saving a snapshot and checking the Load dialog displays just the user's chosen name.

### 3.2 `total_source_rows` is a sum, not per-block; preserve `per_block_rows` separately

Recording only `total_source_rows` and using it for every node's `shape[0]` in the load reconstruction makes a 2 × 1.1k capture display "2,200 × 0" for each node. The manifest now carries an optional `per_block_rows: number[]` aligned with `node_ids`; the load code reads `per_block_rows?.[idx] ?? evenSplit`. Always populate it at capture time.

### 3.3 The "Frequency" / "group-by" / "case-sensitive" form fields are backend parameters, not frontend

Tempting to leave them editable in snapshot mode "because they're just form widgets". Don't — changing them in snapshot mode produces a phantom: the form accepts input but the chart doesn't update because the displayed result is captured. Disable them. The only forms that legitimately stay active in snapshot mode are **post-fit display caps** (see §2.5 of `plan.md` and the examples in §2 step 5 above).

### 3.4 Node colours must shadow against `manifest.node_colors`, not just `getColorForNode`

The capture hook saves `manifest.node_colors`; the load flow must read them back. Only token-frequency did this initially; the other four fell through to the default palette in snapshot mode. Fix is the one-liner in §2 step 4.4 above.

### 3.5 React Compiler vs. manual `useMemo` on refinement dispatches

Wrapping `inSnapshotMode && loadedSnapshot ? snap : live` in `useMemo` with the dependencies listed manually trips `react-hooks/preserve-manual-memoization`. The Compiler can't prove that derived inputs like `activeTimeColumn`, `numericIntervalValue`, etc., are stable. Two safe patterns:
- Plain expression (best for refinements): `const x = inSnapshotMode ? snap : live;`
- IIFE for multi-line dispatch: `const x = (() => { /* … */ })();`

Reserve `useMemo` for dispatches whose dependencies are themselves bona fide state (renders to `useState` returns, hook outputs that are stable across renders).

### 3.6 Skip-if-exists policy for the demo-snapshot importer

The import dialog's demo-snapshots tab defaults to *skipping* entries that conflict with a local file of the same name with a different SHA. Users must explicitly tick the per-row "Replace local copy and re-download" toggle to opt in. Backend tracks this via the `replace_ids` field on `ImportDemoSnapshotsRequest`. Never auto-overwrite a user's own snapshot save.

### 3.7 Right-click "add to stopword" works client-side in snapshot mode

The live token-frequency right-click handler pushes a token into the stopword filter and persists to the backend. In snapshot mode it has a snapshot-aware override that updates only the local `stopWords` text and `appliedStopSet` — the filter drives client-side `deriveNodeDisplayResults` so the chart re-filters without a backend roundtrip. Apply this same pattern wherever a "post-fit filter" interaction makes sense in a snapshot.

### 3.8 `useAnalysisFeature` keeps subscribing to live tasks in snapshot mode

Even in snapshot mode, the live task store may have a running task (or a completed one for a different analysis). `useAnalysisFeature`'s `onHydratedResult` / `onHydratedRequest` callbacks can fire and mutate live state during a snapshot view. This is harmless because the panel reads shadowed values, but it does mean:
- `setLiveX(...)` calls in hydration may run while the user is viewing a snapshot.
- The snapshot hydration effect (§4.7) is a one-shot triggered by `[inSnapshotMode, loadedSnapshot]` changes, not a continuous sync — write it that way.

### 3.9 `selectedNodes` ordering for capture must match the request's `node_ids`

If the manifest's `node_ids` is order-A and the captured request's `node_ids` is order-B, the load-side effective dispatch (which reads the reference/first from `settings.node_ids[0]` but reconstructs `panelSelectedNodes` from `manifest.source.node_ids`) will mismatch. Build a `captureSelectedNodes` array reordered to match the request before passing to the capture hook. Currently relevant for token-frequency; will matter for any future multi-node tool with a reference-first convention.

### 3.10 The `<SaveSnapshotDialog>` runs its own `sanitiseName` after pre-population

The pre-populated default name from `nodeLabels` is human-readable; the dialog re-runs `sanitiseName(name)` before composing the on-disk filename. Don't double-sanitise — the slugifier in `SnapshotActions.buildDefaultName` only needs to produce something readable (trim, replace path separators, collapse whitespace). The dialog's stricter regex handles the rest.

---

## 4. Reference map

### Backend
- `backend/src/ldaca_wordflow/api/snapshots.py` — upload / list / download / delete endpoints; `/api/users/me/snapshots`.
- `backend/src/ldaca_wordflow/api/files.py` — the demo-snapshots catalogue + import endpoints (`/files/demo-snapshots/catalogue`, `/files/import-demo-snapshots`).
- `backend/src/ldaca_wordflow/core/utils.py` — `get_user_snapshots_folder(user_id)` returns the on-disk path.
- `backend/src/ldaca_wordflow/models/__init__.py` — `DemoSnapshotEntry`, `ImportDemoSnapshotsRequest/Response`, `SampleDataCollection`, etc.
- For tools that need a backend `page_size: 'all'` capture path (concordance, quotation), there's a `SNAPSHOT_ALL_PAGE_SIZE_CAP = 500_000` in the analyses module. Add to your tool's analysis endpoint if pagination is involved.

### Frontend — shared
- `src/features/snapshot-view/` — store, types, codec, manifest, caps, mode, components (SnapshotActions, Save/Load dialogs, banner template).
- `src/features/snapshot-view/types.ts` — `SnapshotManifest`, `SnapshotPreview`, `LoadedSnapshot<Payload>`, `SnapshotToolKey`.
- `src/features/snapshot-view/store.ts` — `useSnapshotViewStore`, `useToolSnapshotMode(tool)`.
- `src/features/snapshot-view/components/SnapshotActions.tsx` — the Save/Load buttons + `buildDefaultName` helper (filename pre-population).
- `src/features/analysis/common/components/AnalysisCardLayout.tsx` — `snapshot` slot prop (`{tool, onSave, saveDisabledReason, onOpen, nodeLabels}`).
- `src/features/analysis/common/components/AnalysisFeatureHeader.tsx` — concordance-specific header chrome with `onSaveSnapshot`/`saveSnapshotDisabledReason`/`onOpenSnapshot`/`snapshotNodeLabels` props.

### Frontend — per tool
Each tool follows the same layout:
```
src/features/analysis/<tool>/
├── <Tool>Feature.tsx                       ← effective-value dispatch lives here
├── components/
│   ├── <Tool>SnapshotBanner.tsx            ← exit banner
│   └── panels/
│       ├── <Tool>ParameterPanel.tsx        ← snapshot slot, inputsDisabled
│       └── <Tool>ResultsPanel.tsx          ← readOnly threading
├── hooks/
│   ├── use<Tool>SnapshotCapture.ts         ← bundle assembly + upload
│   └── use<Tool>SnapshotLoad.ts            ← download + decode + store
└── __tests__/
    ├── <Tool>SnapshotBanner.test.tsx
    └── use<Tool>SnapshotLoad.test.tsx
```

### Sample-data repo (demo bundle hosting)
- `demo_snapshots/catalogue.json` — list of published bundles with `{id, filename, path, tool, name, description, size, sha256, tool_version?, recommended_dataset?}`.
- `demo_snapshots/README.md` — authoring guide for adding new bundles.
- Bundles land in the user's `<user_cache>/snapshots/` folder on import; tool Load dialogs discover them via the existing `snapshotsApi.list` endpoint.

---

## 5. Quick verification checklist

Before declaring a tool's snapshot mode done, manually verify:

- [ ] Save a snapshot. The filename defaults to `<Block-Label>_<Other-Label>-YYYY-MM-DD`. The on-disk file uses the underscore tool prefix.
- [ ] Load the snapshot in the same workspace. Chart/table renders, captured colours show on swatches.
- [ ] Exit, then load in a **different** workspace (one without the original nodes). Chart still renders; data-block names show in the panel; captured colours appear (not default palette). Per-block row count in the panel is correct (not doubled).
- [ ] Run + Clear + Detach + any re-aggregation slider are disabled (verify tooltip text mentions snapshot view).
- [ ] Post-fit display controls (stopword filter, words-per-topic, lowercase merging, chart type, page size, sort, legend toggle) still work.
- [ ] Token-click / right-click handlers (where applicable) either no-op or operate purely client-side — no backend network traffic.
- [ ] `npx tsc --noEmit` clean.
- [ ] `npx eslint --no-warn-ignored src/features/analysis/<tool> src/features/snapshot-view` clean.
- [ ] `npx vitest run src/features/analysis/<tool>` — banner + load tests pass.
- [ ] Full `npx vitest run` — no regression elsewhere.
