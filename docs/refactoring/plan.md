# Frontend Refactor Plan — v0.3.0

Audit performed 2026-05-09 across `frontend/src/` (~52 KLOC, 325 files). Strict TS + `noUncheckedIndexedAccess` + ESLint `--max-warnings=0` are honored; `tsc --noEmit` and `eslint` pass clean as of audit time. Findings below are concrete (file:line) and verified.

The work is split into 5 phases. Phase 1 is the "do today" subset: real bugs, dead code, and one near-duplicate file. Phase 2–4 each take 2–7 days; do them in any order based on what you're touching anyway.

> **AI Annotator deferred.** The AI Annotator feature is in early iteration; expect frontend redesigns. All AI-Annotator-specific items below (notably H6 in §3.2 and any cross-feature migrations involving `useAnalysisLockMachine` → `useAnalysisLock`) are skipped until that feature stabilises. Cross-cutting fixes will not exclude AI Annotator if doing so would create exceptions.

---

## Phase 1 — Bugs, dead code, and `TutorialView` consolidation — ✅ DONE

Landed on the `refactoring` branch as four commits:
- `5b96190` fix: B1–B5 (HintsController dup mount, zoom-brush effect loop, Replace-tooltip suppression while busy, slice-reset duplicate block, useFiles auth signature in query key + queryClient.clear() on logout).
- `e64f2b8` refactor: dead-code deletion (7 files removed, 339 LoC). All items grep-verified zero-consumers before deletion.
- `208e7e4` refactor: TutorialView → DocumentView consolidation (–268 LoC).
- `7927805` refactor: import-path codemod (355 imports across 64 files now use `@/`); `scripts/codemod-relative-to-alias.mjs` left in tree for future re-runs.

Net Phase 1: ~9 fewer files, ~500 fewer LoC. Build / typecheck / eslint clean. Tests at baseline (2 pre-existing filter-tab failures, unchanged from before this refactor).

Items deferred from the original Phase 1 scope:
- **B6** (URL parse at module load in useAuth.ts) — moved to Phase 4.7.
- **B8** (`key={index}` on user-mutable lists in concordance/sequential/expression) — moved to Phase 2 alongside the broader expression-sub-tab work, since proper fix needs `string[]` → `{id, value}[]` state-shape changes.
- **B9** (useNodeColumnInfos cache dep loop) — subsumed by Phase 4.3 (replace `nodeInfoCache` with react-query).

### 1.1 Real bugs

- [ ] **B1** Delete duplicate `<HintsController />` mount at `frontend/src/App.tsx:373-375`. Lazy-imported component is mounted at both line 347 and line 374 → two component instances, two Suspense boundaries, doubled subscriptions. Keep the outer one (line 347).
- [ ] **B2** Fix infinite-effect risk in `useTopicModelingZoomBrush.ts:46-56`. `fullDomain = computeZoomDomain(topics)` returns a fresh object every render and is in the effect deps → effect re-fires every render. The `eslint-disable react-hooks/set-state-in-effect` masks it. Wrap with `useMemo(() => computeZoomDomain(topics), [topics])`.
- [ ] **B3** `useReplaceSubTab.ts:170-177` disabled-reason builder doesn't suppress while global ops are running. Tooltip shows stale "Enter a regex pattern first" instead of nothing. Add `if (applyLoading || isLoading.operations) return undefined;` to match the pattern in the other 5 sub-tabs.
- [ ] **B4** `useSliceSubTab.ts:208-227` has a duplicate reset block — the first block's setters are dead (the second runs on truthy `selectedNodeId` and is a strict superset). Delete the dead first block.
- [ ] **B5** `useFiles.ts:26` puts `JSON.stringify(authHeaders)` into the react-query key. On logout, old key never gets evicted. Drop the auth signature from the key; add `queryClient.removeQueries({ queryKey: queryKeys.files })` to `useAuth.ts` logout.
- [ ] **B6** `useAuth.ts:105-115` parses `window.location.search` and rewrites the URL **at module import time** (outside any hook/effect). Move into a `useEffect` in `App.tsx` or a one-shot `processGoogleRedirectToken()` called from the root component. *(Defer to Phase 4 if it touches too much auth code.)*
- [ ] **B7** `tutorials/warningRegistry.ts` is empty `{}`, so every `<WarningIcon targetKey="…">` will silently fail. Combined with §1.2 (WarningIcon is dead code), the fix is: **delete `WarningIcon.tsx` and `warningRegistry.ts` together**. Audit codebase for any consumer first; the cross-cutting auditor confirmed none. Add either back if/when needed.
- [ ] **B8** `key={index}` on user-mutable lists (sort/filter/reorder mis-attributes row identity, breaks input focus). Fix with stable keys at:
  - [ ] `concordance/ConcordanceFeature.tsx:1579,1751,1763`
  - [ ] `sequential-analysis/SequentialAnalysisFeature.tsx:943`
  - [ ] `expression/PolarsExpressionSubTab.tsx:170,209,248,312`
- [ ] **B9** `useNodeColumnInfos.ts:55-110` lists `cache` in effect deps then calls `setCache` → re-runs every fetch. Replace `cache` with `cacheRef.current` access pattern, or remove `cache` from deps with a justified eslint-disable. *(Defer to Phase 4 if `useNodeColumnInfos` is replaced wholesale by react-query — see §4.3.)*

### 1.2 Pure dead code — verified zero external consumers

Each item: confirm with `grep -r "<symbol>" frontend/src/` first. Audit was thorough but verify before deleting. ~150 LoC total.

Hooks/components:
- [ ] Delete `frontend/src/hooks/useLocalTable.ts` entirely (entire hook unused).
- [ ] Delete `frontend/src/components/help/WarningIcon.tsx` entirely (also covers B7).
- [ ] Delete `frontend/src/hooks/useWorkspaceTaskStream.ts` (just re-exports `useWorkspaceTaskInbox`); update `Sidebar.tsx:28` to import directly.

API:
- [ ] Remove `nodesApi.shape` (`api/nodes.ts:174`).
- [ ] Remove `UserMeResponse` (`api/auth.ts:23`).
- [ ] Remove `GoogleAuthResponseType` alias (`api/auth.ts:43`).
- [ ] Remove the 8 internal-only types exported from `api/nodes.ts:45-113` (`JoinNodesRequest`, `JoinPreviewParams`, `CastNodeRequest`, `ConcatPreviewRequest`, `ConcatRequest`, `JoinPreviewResponse`, `OperationInfo`, `PolarsExpressionItem`). Make non-exported.

Stores (silent dead state):
- [ ] Delete `isGlobalLoading`, `globalError`, and the 5 undeclared modal keys (`joinModal`, `filterModal`, `documentColumnModal`, `renameModal`, `deleteConfirmModal`) from `uiStore` initial state (`stores/uiStore.ts:150-165`). The TS type doesn't declare them; they survive only because the literal is wider than the type.
- [ ] Delete `concordanceSearch` action and its mutation (`useWorkspaceInternal.ts:101-134, 238-242`). The concordance feature calls `textApi.concordance` directly.

Token frequency:
- [ ] Delete `filterStatisticsByStopWords`, `filterStatisticsByTokenPattern`, `sortStatistics` from `tokenFrequencyAdapters.ts:239-269` (~80 LoC; filtering happens in tanstack column model).

Hook returns (drop unused fields):
- [ ] `useSchemaManagement.ts:266-272` → drop `setCurrentSchema` from return shape (only `setLockedSchema` is consumed externally).
- [ ] `useAggregateSubTab.ts` → drop `manualExpressionActive` from result (computed but never read).
- [ ] `useAggregateSubTab.ts` → drop the outer `dropZoneRef` (returned at two paths; component reads the inner one).

Tutorial registries:
- [ ] Delete unused `tutorialIndexTarget`/`infoIndexTarget`/`referenceIndexTarget` exports where unused (verify each via grep — `tutorialIndexTarget` IS used in Sidebar; the others are not).

Barrels:
- [ ] Delete `components/index.ts` (every consumer imports from leaf).
- [ ] Delete `components/ui/index.ts` (same).
- [ ] Delete `components/tabs/index.ts` (same).

Empty React imports:
- [ ] `useNodeColumnOptions.ts:1` — remove vestigial `import { } from 'react';`.
- [ ] `useWorkspaceQueries.ts:1` — same.

### 1.3 `TutorialView` → `DocumentView` consolidation

`TutorialView.tsx` (269 LoC) is 95% byte-identical to `DocumentView.tsx` (283 LoC). `DocumentView` already accepts `docType="tutorial"`.

- [ ] Switch the lazy import in `App.tsx:22` to point at `DocumentView` with `docType="tutorial"`.
- [ ] Verify all `useUIStore` actions used by `TutorialView` are also wired into `DocumentView`'s code path.
- [ ] Delete `frontend/src/components/TutorialView.tsx`.
- [ ] Update any other imports of `TutorialView` (search the tree).

### 1.4 Import-path codemod

65 files use `../../../` even though `@/` alias is configured. Worst offenders are deeply nested feature components.

- [ ] Run regex replace `from '(\.\./){3,}([^']+)'` → `from '@/$2'` across `frontend/src/**/*.{ts,tsx}`.
- [ ] Verify TS still compiles (`npm run build`).
- [ ] Optionally enforce going forward via ESLint `no-restricted-imports` or `eslint-plugin-import` rule.

### 1.5 Validation gate

After Phase 1:
- [ ] `cd frontend && npm run build` clean.
- [ ] `cd frontend && npx eslint 'src/**/*.{ts,tsx}'` clean.
- [ ] `cd frontend && npm test -- --run` (existing tests still pass).
- [ ] Manual smoke: app boots, login works, workspace loads, one of each analysis feature opens.

---

## Phase 2 — Cross-feature shared abstractions — 🟡 PARTIALLY DONE

Replaces the duplication patterns in analysis features and preprocessing sub-tabs. ~500 LoC removed; ~12 new shared files in `features/analysis/common/` and `features/preprocessing/{components,hooks}/`. **Effort: 2–3 days.**

### What's landed so far

- **`58b456f` Phase 2.5** magic-literal consolidation: `queryKeys.{filePreview, columnUniqueValues, analysisServerRequestLock}` factory entries; `TaskState` union + `PENDING_TASK_STATES`/`RUNNING_TASK_STATES`/`TERMINAL_TASK_STATES` sets and predicates in `analysisStore`; `lib/debugFlags.ts` with `isGraphDebugEnabled()` consumed by 3 call sites.
- **`a890f5a` Phase 2.4** type-duplication consolidation: `FileTreeNode` re-export from `api/files`; `NodeColumnSelection` 4 → 1 (canonical `useAutoNodeColumns.ts`); `DetachDialogNodeOption` aliases removed from 3 dialog files; `PaginationInfo`/`PreviewPagination` re-exports of `NodeDataPagination`; new `SourceRowPagination` for concordance/quotation.
- **`ab2b23e` Phase 2.3** doc-icon unification: `<DocLinkIcon kind="...">` is the implementation; `HelpIcon`/`InfoIcon`/`ReferenceIcon` collapsed to 3-line wrappers (call sites + tests untouched).
- **`f9118c3` Phase 2.2** `useNodePreviewWithRawFallback` hook covers the duplicated "operation preview, with raw-data fallback" pattern; filter/aggregate/slice/replace migrated. Plus: `dedupeNodeIds` to `selectionUtils`, `MAX_JOIN_NODES` to `types`, dead `previewColumnsToRender` IIFE removed, `DEFAULT_PALETTE` single-color shadowing renamed `SINGLE_NODE_PALETTE`.
- **`6344210` Phase 2.2** `<SubTabActivityTag>` replaces the `<Tag tone="muted"><Loader2 .../>{verb}…</Tag>` snippet across 7 sub-tabs.
- **`fbd351b` Phase 2.1** `useDetachColumnsState` covers the duplicated detach-dialog selection logic (concordance / quotation / topic-modeling); concordance picks up an implicit bug-fix (Set-based toggle).

Net: ~7 commits, lint/typecheck clean throughout, tests at baseline (2 pre-existing filter-tab failures, unchanged).

### Additional Phase 2 work landed in this session

- **`d68ba38` Phase 2.1** `<AnalysisCardLayout>` adopted by Sequential + Quotation. Concordance still hand-rolls (deferred to Phase 3 since the layout move overlaps with the planned ParameterPanel/ResultsPanel split).
- **`a17c077` Phase 2.1** `<PageSizeSelect>` + `features/analysis/common/constants.ts` (`PAGE_SIZE_OPTIONS_DEFAULT`, `PAGE_SIZE_OPTIONS_SMALL`); concordance + quotation footers migrated.
- **`179f57e` Phase 2.1** Quotation's anonymous per-node pagination type aligned with the shared `NodePaginationState`.

### Additional Phase 2 work landed

- **`65696a6` Phase 2.1** `useMaterializeLifecycle` lands in `features/analysis/common/hooks`. Concordance + Quotation now share the watcher skeleton; feature-specific success/failure logic moves into caller-supplied callbacks (concordance multi-node + SSE-aware via `useConcordanceMaterializedEvents`; quotation single-node). Concordance's task-id-change reset effect and `analysis_materialized` SSE consumer remain feature-specific. (Same commit as Phase 3.1 (4/4) above.)
- **`b6b8789` Phase 2.1** `SortableHeader` lifted out of `ConcordanceFeature.tsx`. (Bundled with Phase 3.1 (1/4); originally listed as a Phase 2.1 trivial item.)
- **`ab1ddfb` Phase 2.1** `<MetadataColumnSelector>` UX collapse (Concordance / Quotation / AI Annotator). The "Show metadata" checkbox + label disappears and the dropdown trigger absorbs the count: "Show metadata (n)". The dropdown is always active unless a `disabledReason` is supplied (Concordance combined view with no shared metadata columns) — that tooltip moves from the checkbox onto the dropdown trigger. All three consumers stop pre-selecting a "document" column: Quotation's `selectedMetadataColumns` initial state changes from `null` to `[]` (so the `reconcileMetadataColumnSelection` fall-back to default no longer fires), `showMetadata` becomes derived UI state (`selectedMetadataColumns.length > 0`), and the `show_metadata` server-side preference is no longer hydrated or persisted. Hook signatures (`persistResultPreferences`, `useConcordanceMaterializedEvents` props) drop the `showMetadata` field. Side fix in the Concordance test fixture: column names switched from uppercase (`CONC_LEFT_CONTEXT`) to canonical lowercase (`CONC_left_context`) so they actually match `ALL_CONC_COLS_SET` instead of falling through to an `allCols` fallback that previously only passed because sortable headers carry a "▲▼" suffix that broke the exact-match regex.

### Remaining Phase 2 work (deferred for a fresh session)

- **2.1** `usePerNodePagination` hook (full extraction) — concordance and quotation interleave per-node pagination updates with feature-specific request flows (handleSearch, handlePageSizeChange) that aren't mechanically separable without a wider refactor. Defer until those flows are simplified.
- **2.1** Concordance `<AnalysisCardLayout>` migration. Deferred — Phase 3.1 used inline `<Card>` structures inside the new `<ConcordanceParameterPanel>` / `<ConcordanceResultsPanel>`. Migrating now would touch the just-extracted components; revisit when the shared layout sees a non-trivial change.
- ~~**2.1** Delete the now-unused `reconcileMetadataColumnSelection` + `getDefaultMetadataColumnSelection` exports.~~ Done in `d1b4e9b` — file collapsed to just `normalizeMetadataColumns`; the dead test file removed; private helpers folded inline.
- **2.2** `<ApplyFooter>` — extracts the 30-line "New data block name + Apply button + tooltip" CardFooter shared by 6 sub-tabs. Big LoC win but invasive (6 files, 6 different prop shapes to harmonize).
- **2.2** `buildApplyDisabledReason`, `useResetOnNodeChange`, `useSingleNodeSelectionPanel` — smaller utilities with low ROI relative to complexity; deferred until natural touchpoints.

### 2.1 Analysis-feature shared infra

- [x] Build `features/analysis/common/hooks/useMaterializeLifecycle.ts` covering the "track materialize task → on terminal: prune → refetch parent → reset pagination" sequence. Concordance (multi-node) and Quotation (single-node) both consume; concordance pairs it with the SSE consumer in `useConcordanceMaterializedEvents`. `65696a6`.
- [ ] Build `features/analysis/common/hooks/useDetachColumnsState.ts` returning `{ selectedDetachColumns, toggle, selectAll, deselectAll, reset }`. Migrate concordance, quotation, topic-modeling.
- [ ] Build `features/analysis/common/hooks/usePerNodePagination.ts` (or just stabilize the shape). Migrate concordance/quotation/ai-annotator.
- [ ] Build `features/analysis/common/components/PageSizeSelect.tsx` with the `[10,20,50,100,200,400,800]` default. Migrate concordance and quotation.
- [ ] Build `features/analysis/common/constants.ts` exporting `PAGE_SIZE_OPTIONS_DEFAULT` and `PAGE_SIZE_OPTIONS_SMALL` (the latter is `[5,10,20,50,100]` used by AI Annotator).
- [ ] Migrate AI Annotator to `useAnalysisLock` (currently uses `useAnalysisLockMachine` directly with no documented reason).
- [x] ~~Migrate Concordance to use shared `reconcileMetadataColumnSelection`~~ — superseded by `ab1ddfb`: the auto-pick-document-column behaviour was removed from all three consumers (Concordance / Quotation / AI Annotator), so the helper itself is now dead code. See deferred item above for the cleanup follow-up.
- [x] `<MetadataColumnSelector>` UX collapse — checkbox removed; dropdown trigger reads "Show metadata (n)" and is always active unless a `disabledReason` is supplied (Concordance combined view with no shared columns), in which case the disabled-tooltip lives on the dropdown trigger. `ab1ddfb`.
- [ ] Migrate Concordance/Quotation/Sequential to use `<AnalysisCardLayout>` for parameter+results cards (currently only AI Annotator and Token Frequency use it).
- [x] Lift `SortableHeader` out of `ConcordanceFeature.tsx` to its own file. `b6b8789`.
- [ ] Add `useAiAnnotatorTaskFlow` hook (currently the only feature missing this hook).

### 2.2 Preprocessing sub-tab shared infra

- [ ] Build `features/preprocessing/hooks/useNodePreviewWithRawFallback.ts` consolidating the 5-copy preview-fetcher with raw-fallback (filter/aggregate/slice/replace) into a single `{ nodeId, operationPayload, operationFetch, signaturePrefix }` API.
- [ ] Build `features/preprocessing/components/ApplyFooter.tsx` for the duplicated "New data block name + Apply button + tooltip" CardFooter (currently 6 copies). Driven by `applyMode: 'create-node' | 'mutate-node'` for the "Add to Workspace" / "Add to Data Block" copy split.
- [ ] Build `features/preprocessing/components/SubTabActivityTag.tsx` for the duplicated "Running…" / "Joining…" / "Adding…" header chip (currently 7 copies).
- [ ] Build `features/preprocessing/utils/applyDisabledReason.ts` (`buildApplyDisabledReason({ isBusy, isOperationLoading, hasSelection, configIssue, hasPreviewError, emptyPreview })`) replacing the 7 hand-rolled IIFEs.
- [ ] Build `features/preprocessing/hooks/useResetOnNodeChange.ts` for the duplicated "reset on selectedNodeId change" effects.
- [ ] Build `features/preprocessing/hooks/useSingleNodeSelectionPanel.ts` returning the panel config for single-node sub-tabs (filter/aggregate/slice/replace/expression).
- [ ] Migrate all 5 single-color `DEFAULT_PALETTE = ['#2563eb']` shadowed locals (aggregate/slice/replace/expression) to use this hook (or rename to `SINGLE_NODE_PALETTE` to stop shadowing the multi-color `DEFAULT_PALETTE` from `analysis/common/palette.ts`).
- [ ] Move `dedupeNodeIds` (duplicated in `useConcatSubTab.ts:202-209` and `useJoinSubTab.ts:87-94`) to `utils/selectionUtils.ts` (or add a `unique` option to `takeMostRecent`).
- [ ] Move `MAX_JOIN_NODES` from `useJoinSubTab.ts:13` to `features/preprocessing/types.ts` next to `MAX_CONCAT_NODES`.
- [ ] Delete dead `previewColumnsToRender` IIFEs in filter/concat/join (`PreviewTable.tsx` already does the same fallback).

### 2.3 Doc-icon unification

- [ ] Build `components/help/DocLinkIcon.tsx` driven by `kind: 'tutorial' | 'info' | 'warning' | 'reference'` + a config map of `{Icon, defaultColor, openAction, getTarget}`. Replace `HelpIcon`, `InfoIcon`, `ReferenceIcon`. (`WarningIcon` already deleted in Phase 1.)
- [ ] Optionally: collapse the 3 remaining registries into one `tutorials/registry.ts` with `getTarget(kind, key)` keyed by `${kind}.${key}`.

### 2.4 Type duplication consolidation

- [ ] **Pagination** — settle on two canonical shapes: server-shape (snake_case, used in API responses) and client-state (camelCase, with sort/filter). Migrate the six existing variants (`NodeDataPagination`, `PreviewPagination`, `PaginationInfo`, `ConcordancePagination` ≡ `QuotationPagination`, `PaginationState`).
- [ ] **`User`** — keep one in `types/index.ts:11`; delete from `api/auth.ts:12`.
- [ ] **`FileTreeFile/Directory/Node`** — keep in `api/files.ts`; have `types/index.ts` re-export.
- [ ] **`FilterCondition` / `FilterRequest`** — pick one home and re-export.
- [ ] **`NodeColumnSelection`** — keep `features/analysis/common/nodeSelectionTypes.ts:15` as canonical; remove the three private aliases.
- [ ] **`DetachDialogNodeOption`** — keep canonical in `features/analysis/components/DetachColumnsDialog.tsx:17`; remove the three feature-local aliases. Reconcile with the three independent types in `api/text.ts` (`Quotation/Concordance/TopicModelingDetachNodeOption`).
- [ ] **`normalizeTypeName`** — three definitions (`utils/columnTypes.ts:54`, `data-view/services/schemaMutations.ts:32`, `preprocessing/utils/typeUtils.ts:4`); the test file already imports two side by side. Document why or consolidate.

### 2.5 Magic literal cleanup

- [ ] Export `TaskState` union and `PENDING_STATES` / `TERMINAL_STATES` / `RUNNING_STATES` from `stores/analysisStore.ts`. Replace ~140 inline string-equality comparisons (`isTerminalTaskState` already exists in `policies.ts:5` but isn't used everywhere).
- [ ] Move `DEBUG_GRAPH_KEY` constant from `useWorkspaceQueries.ts:18` to a shared `lib/debugFlags.ts`. Have `useWorkspaceGraph.ts:72` and `useWorkspaceNodeMutations.ts:613` use it.
- [ ] Add `queryKeys.filePreview(filename, page, pageSize, sheet)` and `queryKeys.columnUniqueValues(workspaceId, nodeId, column)` to `lib/queryKeys.ts`. Migrate the two ad-hoc inline keys in `useFilePreview.ts:23` and `UniqueValueCount.tsx:16`.
- [ ] Move `analysisServerRequestLockQueryKey` from features into `lib/queryKeys.ts`.

---

## Phase 3 — God-file decomposition — 🟡 PARTIALLY DONE

Per-file split plans. Each file gets its own focused PR. **Effort: ~1 week.**

### Landed this session

- **`cb14ceb` Phase 3.6** App.tsx 613 → 385 LoC. Extractions: `<DocumentModalHost>`, `<ViewRouter>`, `<RefreshStatusBanner>`, `<LoginScreen>`, `authPhaseCopy.ts`. (One regression fixed mid-flight: nested object literals inside a `useShallow` selector caused a `Maximum update depth exceeded` crash; replaced with primitive selectors. Lesson saved to memory.)
- **`0b48657` Phase 3.10** Literal-union types for tutorial / info / reference target keys. `LooseAutoComplete` pattern keeps dynamic pass-throughs working while giving autocomplete + typo-detection on direct uses.
- **`db16915` Phase 3.7** Sidebar.tsx 733 → 628 LoC. `<ClearEmbeddingCacheMenuItem>` (topic-modeling-specific, owns its dialog state), `useTaskCardActions` (filesApi/workspacesApi branching), `formatBytes` hoisted to `lib/utils.ts`.
- **`d39098d` Phase 3.5** `useSequentialResultSummary` hook replaces 30 lines of `((results?.analysis_params)?.X) ?? localValue` plumbing in SequentialAnalysisFeature.
- **`8608c91` Phase 3.4** Quotation pure helpers moved to siblings: `quotationTextClip.ts` (clipTextAroundSpans + word-boundary maths, ~150 LoC) and `quotationRemoteUrl.ts` (URL normalization). QuotationFeature 1499 → 1351 LoC.
- **`db894fc`** (cross-cutting) hydration `Failed to fetch` errors classified as `ApiError(NETWORK)` so they log at debug; recharts `width(-1)/height(-1)` warnings silenced via `minWidth={0}`.

### Additional Phase 3 work landed

- **`57d32e0` Phase 3.8 (partial)** WorkspaceTable.tsx 725 → 612 LoC. `<RenameInput>` and `<ColumnFilterForm>` extracted, TanStack `ColumnMeta` augmentation moved to `tableMeta.d.ts`, `columns` and `wideColumns` memoized.
- **`77c196a` Phase 3.9 (partial)** Memoized `actions` in useWorkspaceNodeMutations + `authHeaders` in useWorkspaceCore. The single largest re-render fix in the audit (H6 + H7) — the four-slice WorkspaceProvider value no longer churns on every parent render, cascading through ~30 consumers.

### Phase 3.1 Concordance decomposition landed (this session)

ConcordanceFeature.tsx **2344 → 1070 LoC** (-54%) across four focused commits. The split deviated from the original plan on one important axis: instead of `<ConcordanceCombinedTable>` + `<ConcordanceSeparatedTable>` (combined-vs-separated layout split), the decomposition split on the **functional view axis** — instance-row table vs document-aggregated dispersion — because the data shape genuinely differs by view (`flattenConcordanceGroups` produces one row per hit; `buildDispersionRows` produces one row per source-document with hits aggregated). The combined/separated branching is a layout detail handled internally by each view block; this leaves a clean seam for the future per-document chunked detach in dispersion view.

- **`b6b8789` Phase 3.1 (1/4)** Mechanical extractions, 2344 → 1946 LoC. `SortableHeader` lifted to its own file (was redefined inside the component every render). Four hooks extracted: `useConcordanceMetadataColumns` (the L380-459 IIFE; result memoized), `useConcordanceMaterializedEvents` (terminal task watcher + task-id ref reset + `analysis_materialized` SSE consumer; returns the live task-id ref + a `resetProcessedEvents` callback the hydration path calls), `useConcordancePendingHandoff` (queue + apply effects for TokenFrequencyTab handoffs), `useConcordanceViewModeSwap` (auto-revert to separated when `combinable === false`, scroll-preserving `handleViewModeChange`, combined-page-change refetch). `labelToNodeId` and `sourceColorMap` memoized; `resolveNodeIdForKey` wrapped in `useCallback`.
- **`dd91802` Phase 3.1 (2/4)** The view split, 1946 → 1444 LoC. `renderConcordanceTable` (500-LoC closure) replaced by `<ConcordanceTableNodeBlock>` (instance rows, sortable metadata header, Process All / Add to Workspace footer; combined and per-node both rendered here) and `<ConcordanceDispersionNodeBlock>` (document-aggregated rows + `<ConcordanceDispersionLegend>` + `<ConcordanceDispersionSummary>`; combined and per-node both rendered here). Each block owns its own Detach button — the seam for future per-document detach divergence in dispersion view. Dispersion-only state (`proportionalDispersionBars`, `colourMatches`, `lowercaseMatches`, `hiddenMatchedTexts`, `binCount`, `combinedSourceMode`, `materializedBins`) stays in the parent for this commit; hoisting into the dispersion view is deferred (would let the Bin No. / Colour matches / etc. controls move into a `ConcordanceDispersionControls` component owned by the dispersion view).
- **`8b3c8f1` Phase 3.1 (3/4)** Panel extractions, 1444 → 1070 LoC. `<ConcordanceParameterPanel>` (search inputs, regex/whole-word/case-sensitive checkboxes, Run/Update + Clear buttons, page-size selector) and `<ConcordanceResultsPanel>` (results card frame with Separated/Combined view tabs, Table/Dispersion view tabs, dispersion controls row, MetadataColumnSelector, and the iteration loop dispatching to the per-block components). The `results.state === 'failed'` branch stays as a tiny inline Card (6 lines, no extraction value).
- **`65696a6` Phase 3.1 (4/4)** = **Phase 2.1** — shared `useMaterializeLifecycle` in `features/analysis/common/hooks` finally lands. Concordance (multi-node) supplies a success callback that merges per-node materialized paths + summaries, resets globalPageSize to 20 + nodePagination, calls `persistResultPreferences`, and a failure callback that toasts the state. Quotation (single-node) supplies a success callback that writes the singular `materialized_path` + summary and calls `handlePageSizeChange(20)`; no failure handler. The watcher skeleton is now shared. Concordance's task-id-change reset effect and SSE consumer remain in `useConcordanceMaterializedEvents` (concordance-specific). Net –56 LoC across the two consumers; the Concordance hook drops its private `processedMaterializeTaskIdsRef`.

### Phase 3.3 DataLoader decomposition landed (this session)

DataLoaderFeature.tsx **1517 → 734 LoC** (-52%) across seven focused commits. The directory move from `features/analysis/data-loader/` to `features/data-loader/` happened first (Data Loader manages workspaces/files/imports — not analysis), then two hooks, four components, and two utility modules came out of the god-file in dependency order. Each commit is independently lint/typecheck/test clean; the 11-test data-loader suite passes after every step.

- **`2e685de` Phase 3.3 (1/7)** Directory relocation. `src/features/analysis/data-loader/` → `src/features/data-loader/`. Lazy import in `ViewRouter.tsx` updated; tests/imports unchanged.
- **`8d3fcfc` Phase 3.3 (2/7)** `useResizableSplit` hook (top-bottom splitter for the data-loader vertical split). Returns `{ containerRef, topRatio, splitterProps }`; the component spreads `splitterProps` onto the separator div. Behaviour preserved (min 0.15 / max 0.85, 0.05 keyboard nudge, Home/End jump to bounds, Enter/Space + double-click reset to 0.5). 1517 → 1459 LoC.
- **`3f96e9d` Phase 3.3 (3/7)** `usePendingWorkspaceDownloads` hook. Encapsulates the start-download → watch-tasks → fetch-artifact flow. Owns its state (`pendingDownloads`, `startingWorkspaceId`), subscribes to the analysis-store tasks, and triggers the artifact download + toast on terminal task state. Component reads `isStarting(id)` / `isPending(id)` predicates. `notify` wrapped in stable `useCallback`. 1459 → 1410 LoC.
- **`6e8c02a` Phase 3.3 (4/7)** `<FileTree>` component owns the recursive file/folder rendering and the in-tree DnD state (`draggingFilePath` / `fileMoveTarget`); side-effects exposed via callbacks (onPreviewFile / onAddFile / onSelectFile / onDownloadFile / onDeleteFile / onCreateFolderInside / onOpenCitation / onMoveFile / onWarnNoWorkspace). Pure helpers move to `utils/fileTreeHelpers.ts` (`README_FILENAME`, `FILE_DRAG_MIME_TYPE`, `countFilesInNode`, `getCitationFile`, `getVisibleDirectoryChildren`, `getParentDirectoryPath`); data-loader-local formatters to `utils/format.ts` (1024-based `formatBytes`, distinct from `lib/utils.formatBytes`'s 1000-based variant; `formatTimestamp`; `getWorkspaceId`). 1410 → 1143 LoC.
- **`c21e891` Phase 3.3 (5/7)** `<WorkspaceManagerCard>` owns its own zip-input ref and the favorites read; parent supplies upload-zip / refresh / load / delete callbacks plus the workspace list and pending-downloads handle. The `openWorkspaceZipPicker` indirection collapses into the card's local `zipInputRef.current?.click()`; `handleWorkspaceZipInputChange` becomes a single-arg `handleUploadWorkspaceZip(file)`. 1143 → 1001 LoC.
- **`c1af023` Phase 3.3 (6/7)** `<ActiveWorkspaceCard>` owns its rename / description / new-workspace-name / new-workspace-description input state; resets via the React-blessed render-time derived-state pattern (not `useEffect`) when the active workspace switches or its persisted name/description change. Parent's create handler now returns `Promise<boolean>` so the card knows whether to clear the create-form inputs. 1001 → 872 LoC.
- **`26c762d` Phase 3.3 (7/7)** `<DataLoaderDialogs>` consolidates the 6 inline dialogs (no-workspace alert, invalid-name alert, invalid-folder-name alert, delete-workspace confirm, LDaCA import, create-folder, citation viewer) into a single component. Props are grouped per-dialog so the parent passes `{ open, onClose, ... }` bundles instead of a flat list of ~25 individual props. `react-markdown` + `remark-gfm` and the Dialog/AlertDialog primitive imports move with the dialogs. 872 → 734 LoC.

### Phase 3.4 + 3.5 panel extractions landed (this session)

- **`bec4df5` Phase 3.4 (rest)** QuotationFeature.tsx 1309 → 1165 LoC. `quotation/quotationHighlight.ts` for the pure `TYPE_COLORS` / `hexToRgba` / `buildUnderlineStyle` helpers; `quotation/components/QuotationHighlightedCell.tsx` replaces the 116-LoC closure-capturing `renderHighlightedText`. `hoverState` and `setHoverState` stay on the parent (typed via the exported `QuotationHoverState`) and pass through as props. Behaviour preserved (priority-order hover, segment boundary union, error fallback to plain text).
- **`eabbc9a` Phase 3.5 (a)** SequentialAnalysisFeature.tsx 1147 → 1061 LoC. `<SequentialAnalysisResultsPanel>` covers the 130-line Results card (Min Group Size + Chart Type + Download header, six-stat summary grid, SequentialChart). Props bundled into `summary` + `counts` records; container ref typed as `React.RefObject<HTMLDivElement | null>`.
- **`6f47e55` Phase 3.5 (b)** 1061 → 863 LoC. `<SequentialAnalysisParameterPanel>` covers the NodeSelectionPanel + the frequency / numeric / group-by / case-sensitive configuration block. The surrounding `<AnalysisCardLayout>` frame stays in the parent (run/clear actions are orchestration state). `FREQUENCY_OPTIONS` / `CUSTOM_INTERVAL_UNIT_OPTIONS` move with the panel; the parent retains a smaller `VALID_CUSTOM_INTERVAL_UNITS` array for the hydration-path type guard. `inputsDisabled` is computed once at the call site instead of duplicated three times in the original JSX.

Net Phase 3.5: SequentialAnalysisFeature 1147 → 863 LoC (-25%).
Net Phase 3.4: QuotationFeature 1309 → 1165 LoC (-11%).

### Phase 3.7 + 3.8 follow-ups landed (this session)

- **`caaaf22` Phase 3.7 (rest)** Sidebar.tsx 628 → 507 LoC. `useStackedSplits` lifted to `components/layout/sidebar/useStackedSplits.ts` — owns the N-pane state (collapsed map, ratio map, ResizeObserver-backed container height), exposes `containerRef` / `isCollapsed(key)` / `toggleSection(key)` / `getSectionFlexStyle(key)` / `assignSectionScrollRef(key, node)` / `handleResizeStart(upper, lower, event)`. Behaviour preserved exactly (same `MIN_SECTION_HEIGHT` clamp, same overflow-scroll-on-overpressure trick, same window mousemove/mouseup teardown). Side cleanup: small `nodes` IIFE → `useMemo`. `<SidebarSection>` deferred — section-specific elements (views' edit-views dropdown + clear-embedding-cache, nodes' count badge, tasks' connection indicator) weave into the shared header, so a generic component would either need 6+ render-prop slots or collapse to a thin wrapper that buys nothing.
- **`2f0b96b` Phase 3.8 (a)** WorkspaceTable.tsx 611 → 547 LoC. `useColumnMutations` owns all column-mutation state (`columnTypes`, `loadingCast`, `columnActionLoading`, `renamingColumn`, `datetimeModal`, `deleteColumnDialogOpen`, `columnToDelete`) plus the schema-bootstrap effect. WorkspaceTable consumes the API and stays focused on rendering. Stable mutation callbacks: the four async functions previously inlined into the `WorkspaceTableProps` literal are now `useCallback`-wrapped on `selectedNode.id` in `useWorkspaceDataTable.ts` — resolves the audit's "schema refetches more than intended" note. `columns` derived first from data and only falls back to `Object.keys(columnTypes)` to break the cycle with the hook. `<DeleteColumnConfirmDialog>` extraction skipped intentionally — after the hook owns its state, the inline `<ConfirmDialog>` is 8 lines.
- **`e237638` Phase 3.8 (b)** WorkspaceTable.tsx 547 → 411 LoC. The 160-LoC TanStack column-header render-prop becomes its own `<WorkspaceColumnHeader>` component. Pin / inline-rename / sort indicator / data-type cast / wide-column expand / settings dropdown (Rename / Delete / Filter) / active-filter clear badge — all with ~25 props but no state. Lots of imports drop from the parent.

Net Phase 3.7: Sidebar 733 → 507 LoC (-31%) across `db16915` + `caaaf22`.
Net Phase 3.8: WorkspaceTable 725 → 411 LoC (-43%) across `57d32e0` + `2f0b96b` + `e237638`.

### Remaining Phase 3 work

- **3.5 (rest)** Tame the 36-line `eslint-disable react-hooks/set-state-in-effect` block at L450-485. Deferred — the effect synchronises `selectedNodeId` + `timeColumnOptions` into both `nodeColumnSelections` and a local `timeColumn` useState. A clean derived-state conversion would require either eliminating the local `timeColumn` (deriving from the selection) or restructuring the analysis-lock contract; both touch the hydration path. Risk/reward not aligned without the Phase 5 hook tests as a safety net.
- **3.7 (rest)** `<SidebarSection>` extraction. Deferred — section-specific JSX in the SECTION_KEYS.map weaves directly into the shared header, so a generic component would either need 6+ render-prop slots or collapse to a thin wrapper that buys nothing.
- **3.1 (deferred)** Dispersion-only state hoisting into `<ConcordanceDispersionNodeBlock>` (or a `<ConcordanceDispersionControls>` sibling) so the Bin No. / Colour matches / Lowercase / Sources controls live where their state lives. Today they're in `<ConcordanceResultsPanel>` reading parent-owned state. Low ROI in isolation.
- **3.1 (deferred)** Replace H8 result-prefs hydration `requestAnimationFrame(setX)` pattern with derived state. Couldn't be cleanly converted in this pass: users can override `globalPageSize` post-hydration so the value can't be derived; the rAF wrap exists only to dodge the `react-hooks/set-state-in-effect` lint rule. Revisit when the rule's intent is reviewed for one-shot hydration effects.
- **3.9 (rest)** useWorkspaceNodeMutations.ts: move 6 text mutations from useWorkspaceInternal.ts:101-228 here (or a peer `useWorkspaceTextMutations.ts`).

### 3.1 ConcordanceFeature.tsx (2344 → 1070 LoC)

Landed across `b6b8789`, `dd91802`, `8b3c8f1`, `65696a6`. View axis swapped from combined-vs-separated to instance-vs-dispersion (see "Phase 3.1 Concordance decomposition landed" above).

- [x] `concordance/components/ConcordanceParameterPanel.tsx` (search inputs, regex/whole-word, page-size). `8b3c8f1`.
- [x] ~~`ConcordanceCombinedTable.tsx` / `ConcordanceSeparatedTable.tsx`~~ → split on the **view axis** instead: `ConcordanceTableNodeBlock.tsx` (instance rows) + `ConcordanceDispersionNodeBlock.tsx` (document-aggregated rows + Legend + Summary). Each handles combined and per-node internally. `dd91802`.
- [x] `concordance/components/ConcordanceResultsPanel.tsx`. `8b3c8f1`.
- [x] `concordance/components/SortableHeader.tsx`. `b6b8789`.
- [x] `concordance/hooks/useConcordancePendingHandoff.ts`. `b6b8789`.
- [x] `concordance/hooks/useConcordanceMaterializedEvents.ts` (SSE seq tracking + paths; composes the shared `useMaterializeLifecycle` after `65696a6`).
- [x] `concordance/hooks/useConcordanceMetadataColumns.ts`. `b6b8789`.
- [x] `concordance/hooks/useConcordanceViewModeSwap.ts`. `b6b8789`.
- [x] Memoize `availableMetadataColumns` (now inside the metadata hook) and `sourceColorMap`; also memoize `labelToNodeId` and wrap `resolveNodeIdForKey` in `useCallback`. `b6b8789`.
- [ ] Replace H8 result-prefs hydration `requestAnimationFrame(setX)` pattern with derived state. Deferred — users override `globalPageSize` post-hydration so it can't be derived; the rAF wrap exists only to dodge the lint rule.
- [ ] Hoist dispersion-only state (`proportionalDispersionBars` / `colourMatches` / `lowercase` / `hiddenMatchedTexts` / `binCount` / `combinedSourceMode` / `materializedBins`) into `ConcordanceDispersionNodeBlock` (or a sibling `ConcordanceDispersionControls`). State stays in parent for now.

### 3.2 AiAnnotatorFeature.tsx (1558 → ~600 LoC)

- [ ] `ai-annotator/components/AiAnnotationTab.tsx` (annotation tab, L939-1148)
- [ ] `ai-annotator/components/ReviewTab.tsx` (review tab, L1151-1206 + L1316-1553)
- [ ] `ai-annotator/hooks/useReviewEditing.ts` (extracts ~10 useStates + per-cell save logic at L740-846)
- [ ] Convert 11 LLM-config useStates (L141-153) to a `useReducer<AiAnnotatorParams>` with `RESET`/`SET_FIELD` actions.
- [ ] Add `useAiAnnotatorTaskFlow` (Phase 2.1).
- [ ] Extract `buildAiAnnotationCommonPayload(state)` for the 9-field shared payload between `handleDetach` and `handleRun` (L411-428, L451-470).

### 3.3 DataLoaderFeature.tsx (1517 → 734 LoC)

Landed across `2e685de`, `8d3fcfc`, `3f96e9d`, `6e8c02a`, `c21e891`, `c1af023`, `26c762d`. See "Phase 3.3 DataLoader decomposition landed" above for per-commit details.

- [x] **Move out of `features/analysis/`** — relocated to `features/data-loader/`. `2e685de`.
- [x] `data-loader/components/DataLoaderDialogs.tsx` (6 inline dialogs consolidated). `26c762d`.
- [x] `data-loader/components/FileTree.tsx` (recursive renderer + DnD state owner). `6e8c02a`.
- [x] `data-loader/components/WorkspaceManagerCard.tsx` (zip-input + favorites read are owned here; workspace-download polling lives in `usePendingWorkspaceDownloads`). `c21e891`.
- [x] `data-loader/components/ActiveWorkspaceCard.tsx` (owns rename/description/new-workspace input state; render-time derived-state reset on workspace switch). `c1af023`.
- [x] `data-loader/hooks/useResizableSplit.ts`. `8d3fcfc`.
- [x] `data-loader/hooks/usePendingWorkspaceDownloads.ts`. `3f96e9d`.
- [x] `data-loader/utils/fileTreeHelpers.ts` + `data-loader/utils/format.ts` (pure helpers + 1024-based formatters). `6e8c02a`.

### 3.4 QuotationFeature.tsx (1599 → 1165 LoC)

- [x] Move pure helpers (`clipTextAroundSpans`, `findWordIndexBeforeOrAt`, `findWordIndexAfterOrAt`, `clampContextLength`) to `quotation/quotationTextClip.ts`. `8608c91`.
- [x] Move `normalizeRemoteUrl` to `quotation/quotationRemoteUrl.ts`. `8608c91`.
- [x] Hoist `TYPE_COLORS`, `hexToRgba`, `buildUnderlineStyle` to `quotation/quotationHighlight.ts`. `bec4df5`.
- [x] Extract `<QuotationHighlightedCell>` from the 116-LoC closure-capturing `renderHighlightedText`. `bec4df5`.
- [x] Use shared materialize-lifecycle hook (Phase 2.1). `65696a6`.

### 3.5 SequentialAnalysisFeature.tsx (1188 → 863 LoC)

- [x] `sequential-analysis/hooks/useSequentialResultSummary.ts`. `d39098d`.
- [x] `sequential-analysis/components/panels/SequentialAnalysisParameterPanel.tsx`. `6f47e55`.
- [x] `sequential-analysis/components/panels/SequentialAnalysisResultsPanel.tsx`. `eabbc9a`.
- [ ] Replace the 36-line `eslint-disable react-hooks/set-state-in-effect` block at L450-485 with derived state. Deferred — see "Remaining Phase 3 work" above for rationale.

### 3.6 App.tsx (618 → ~150 LoC)

- [ ] Extract `<ViewRouter>` — the 9-way `currentView === 'X' && <…>` chain at L404-413.
- [ ] Extract `<DocumentModalHost>` — the 4 near-identical `<Dialog>` blocks at L271-317.
- [ ] Extract `useResizableSplit({ axis, min, max, container })` — currently implemented 3× in App.tsx (L112-149, L177-219) and `WorkspaceView.tsx:20-48`.
- [ ] Extract `<RefreshStatusBanner>` from L319-345 + L151-167.
- [ ] Move `LoginScreen` (L582-615) and `getBlockingCopy` to `components/startup/`.
- [ ] Reuse `useUIStore.feedbackModal` instead of local `feedbackOpen` useState in pre-auth screen (L494).
- [ ] Move `LAG_HINT_DELAY_MS` and `REFRESH_CHIP_DELAY_MS` to a `config/timings.ts`.

### 3.7 Sidebar.tsx (725 → 507 LoC)

- [x] Move embedding-cache business logic to `ClearEmbeddingCacheMenuItem`. `db16915`.
- [x] Move `formatBytes` to `lib/utils.ts`. `db16915`.
- [x] Move task-clear branching into `useTaskCardActions`. `db16915`.
- [x] Extract `useStackedSplits<KeyT>(keys, opts)` to `components/layout/sidebar/useStackedSplits.ts`. `caaaf22`.
- [ ] Extract `<SidebarSection>` from the SECTION_KEYS.map loop. Deferred — section-specific JSX (views' edit-views dropdown, nodes' count badge, tasks' connection indicator) weaves directly into the shared header; a generic component would either need 6+ render-prop slots or collapse to a thin wrapper.
- [x] Convert `nodes` IIFE to `useMemo`. `caaaf22`.

### 3.8 WorkspaceTable.tsx (725 → 411 LoC)

- [x] Lift `RenameInput` and `ColumnFilterForm` to sibling files. `57d32e0`.
- [x] Extract `<WorkspaceColumnHeader>` from the 160-line render-prop. `e237638`.
- [x] Extract `useColumnMutations` for cast/rename/delete schema-mutation flows. `2f0b96b`.
- [x] ~~Extract `<DeleteColumnConfirmDialog>`~~ — skipped intentionally; after the mutations hook owns `columnToDelete`/`deleteColumnDialogOpen`, the inline `<ConfirmDialog>` is 8 lines and earns no own file.
- [x] `useMemo` the `wideColumns` IIFE. `57d32e0`.
- [x] Move global TanStack module augmentation to `data-view/tableMeta.d.ts`. `57d32e0`.
- [x] Wrap `onRefreshSchema` (and the other 3 mutation callbacks) in `useCallback`. `2f0b96b`.

### 3.9 useWorkspaceNodeMutations.ts (637 → ~450 LoC)

- [ ] Wrap the `actions` object (L544-634) in `useMemo` keyed on the mutation refs. Currently rebuilt every render → cascades through `WorkspaceProvider` context.
- [ ] Move 6 text mutations from `useWorkspaceInternal.ts:101-228` here (or to a peer `useWorkspaceTextMutations.ts`).

### 3.10 tutorialRegistry.ts (456 → 0 LoC of TS)

- [ ] Either: move to `public/tutorials/registry.json` (loaded once on app start, merged with the other registries).
- [ ] Or: Vite plugin / build script that scans `public/tutorials/**/*.md` for `<a id="help-…">` markers and emits the registry at build time, eliminating drift entirely.
- [ ] Either way: make `TutorialTargetKey` a string literal union for type safety so typos in `targetKey` are compile errors instead of runtime toasts.

---

## Phase 4 — Architecture (state/data layer)

The biggest perf wins concentrate here. **Effort: ~1 week.** Optional — codebase works fine without these but they're the structural debt that grows fastest.

### 4.1 Single source of truth for `currentWorkspaceId`

Currently in three places: `useState` in `useWorkspaceCore.ts:49`, react-query cache via `setQueryData` in `useWorkspaceNodeMutations.ts:73`, and a server-fetched query at `useWorkspaceQueries.ts:55`. Reconciler effect at `useWorkspaceInternal.ts:66-79` tries to keep them in sync.

- [ ] Pick the Zustand `selectionStore` as canonical alongside `selectedNodeId`.
- [ ] Drop the `useState` from `useWorkspaceCore`.
- [ ] Remove the `setQueryData(queryKeys.currentWorkspace, …)` write.
- [ ] Treat the `current.get` query as one-shot bootstrap that hydrates the store.

### 4.2 WorkspaceProvider re-render fix

`WorkspaceProvider.tsx:16-41` builds 4 slices as fresh literals every render. The four `useWorkspaceData/Selection/Status/Actions` wrappers don't narrow re-render scope (they read the same context). Combined with `useWorkspaceInternal.ts:272-286` (fresh `actions`/`isLoading`/`errors` literals) and `useWorkspaceCore.ts:126-130` (auth headers recreated every render → all 25 mutation `mutationFn`s change identity), this is the single biggest re-render source.

- [ ] Either split into 4 separate React contexts so a `useWorkspaceActions()` consumer doesn't re-render on `data` change.
- [ ] Or use `use-context-selector` so consumers can subscribe to specific keys.
- [ ] Wrap `authHeaders` in `useMemo([isAuthenticated, getAuthHeaders])`.
- [ ] Wrap `actions`/`isLoading`/`errors` in `useMemo` with the right deps (or migrate to `useCallback` per action).
- [ ] Freeze the `EMPTY_NODE_DATA` fallback at module scope (`useWorkspaceQueries.ts:116`).
- [ ] `useShallow` selector pattern in `DataLoaderFeature.tsx:251` (currently uses `usePreferencesStore()` with no selector, re-renders on `syncing` flag).

### 4.3 Replace `lib/nodeInfoCache.ts` with react-query

`nodeInfoCache` is a parallel cache (`Map<key, T>` + in-flight-promise dedup) duplicating what react-query already does. Consumers: `useNodeColumnInfos.ts:76`, `useSchemaManagement.ts:46/171`, `useWorkspaceNodeMutations.ts:619`.

- [ ] Build a `useNodeInfo` hook around `useQuery({ queryKey: queryKeys.nodeInfo(...), queryFn: nodesApi.info })`.
- [ ] For non-hook async sites (mutation success handlers), use `queryClient.fetchQuery({queryKey, queryFn})` for built-in dedup.
- [ ] Delete `lib/nodeInfoCache.ts`. This also resolves the dep-loop in `useNodeColumnInfos` (B9).

### 4.4 Split api/text.ts (478 → 6 files)

- [ ] Split into `api/text/{concordance,quotation,sequential,tokenFrequency,topicModeling,aiAnnotation}.ts`.
- [ ] Re-export from `api/text/index.ts` to keep import sites stable.
- [ ] Reformat single-line interface declarations (one field per line) for diff readability.

### 4.5 Eliminate quotationEngineStore mirror

`quotationEngineStore.ts:57-99` is a manually-mirrored shadow of `preferencesStore`. Every setter calls `usePreferencesStore.getState().setQuotationEngine(...)` then `syncFromPrefs()`. No subscription to the source → goes stale if prefs change elsewhere.

- [ ] Either subscribe `quotationEngineStore` to `preferencesStore` via `usePreferencesStore.subscribe`.
- [ ] Or simpler: delete `quotationEngineStore.ts`, have `QuotationFeature.tsx` (the only consumer at L322-330) read `preferencesStore` with selectors.

### 4.6 preferencesStore sync side effects

`preferencesStore.ts:65-94` setters fire `syncToBackend().catch(() => {})` synchronously. Setters become silently effectful, debouncing fails, auth headers are missing.

- [ ] Move sync to a debounced `preferencesStore.subscribe(...)` registration.
- [ ] Or do sync at the component level where auth context is available.

### 4.7 useAuth singleton → store

`useAuth.ts:33-40` keeps 8 module-level globals; `useSyncExternalStore` bridges to React. Tests need to reset all 8 globals; HMR preserves stale state.

- [ ] Migrate to a Zustand store with the same external-store contract.
- [ ] Move the URL-rewrite at L105-115 into a `useEffect` (B6).

### 4.8 Hook layer cleanup

- [ ] Decide on the four 6-line `useWorkspaceData/Actions/Selection/Status` wrappers: either delete (inline `useWorkspaceContext().X`) or keep for context-split (Phase 4.2).
- [ ] Move 6 text mutations from `useWorkspaceInternal.ts` to `useWorkspaceNodeMutations.ts` (also Phase 3.9).
- [ ] After 4.1, `useWorkspaceCore.ts:79-87` workspace-change reset effect can become a Zustand `subscribe(state => state.currentWorkspaceId, …)` callback. Removes a useEffect.

### 4.9 features/workspace structural alignment

- [ ] Add `features/workspace/common/` mirroring the `features/analysis/common/` and `features/preprocessing/{components,utils,hooks}/` patterns.
- [ ] Move `lib/workspaceName.ts`, `lib/nodeInfoCache.ts` (or its replacement), `hooks/useWorkspace*`, `hooks/workspace/*`, `providers/Workspace*`, `components/layout/sidebar/types.ts` into it.
- [ ] Move `components/AnalysisPagination.tsx`, `components/AnalysisTableScrollArea.tsx` to `features/analysis/common/components/`.
- [ ] Move `components/CustomNode.tsx` to `features/workspace/graph-view/components/`.
- [ ] Move `components/NodeSelectionPanel.tsx` to `features/analysis/common/components/`.
- [ ] Move `components/CodeEditor.tsx` to `features/preprocessing/expression/`.
- [ ] Move `components/tabs/{AnalysisTaskBanner,AnalysisLockedNotice,tokenFrequencyHelpers}` to `features/analysis/common/`.

### 4.10 Pagination components consolidation

- [ ] Merge `AnalysisPagination.tsx:38-91 buildPaginationRange` and `ServerTablePagination.tsx:20-46 buildPaginationRange` (currently identical) into `components/ui/Pagination.tsx`.
- [ ] Same for `PaginationJump` popover-input (`AnalysisPagination.tsx:103-214` ≡ `ServerTablePagination.tsx:49-142`).
- [ ] Optionally collapse the two components into one with a `mode: 'server' | 'tanstack'` adapter.

---

## Phase 5 — Tests (interleaved with Phases 3 & 4)

`src/hooks/` has zero tests today. The big ones deserve smoke tests **before** their refactors land so Phase 3/4 can ride the safety net.

- [ ] `useAuth.ts` (305 LoC, complex global singleton + `useSyncExternalStore`).
- [ ] `useWorkspaceInternal.ts` (308 LoC).
- [ ] `useWorkspaceNodeMutations.ts` (637 LoC).
- [ ] `useNodeColumnInfos.ts` (127 LoC, has the dep-loop bug B9).
- [ ] `useSchemaManagement.ts` (283 LoC).
- [ ] `useAutoNodeColumns.ts` (281 LoC).
- [ ] Add unit tests for the new extracted hooks in Phase 2 (`useMaterializeLifecycle`, `useDetachColumnsState`, `useNodePreviewWithRawFallback`, `buildApplyDisabledReason`).
- [ ] Add tests for aggregate's token-builder index arithmetic (`useAggregateSubTab.ts:438-500`) before Phase 2 extraction — easy to break silently.

---

## What's explicitly out of scope

- **Backend.** Audit was frontend-only.
- **Submodules** (`backend`, `docworkspace`, `ldaca-tabulator`, `polars-text`). Refactor branch in this repo doesn't touch them.
- **Dependency upgrades.** Separate concern.
- **CSS / Tailwind cleanup.** A handful of low-priority items (vendor-prefixed scrollbar-hide repeated 4×, inline styles where Tailwind classes exist) are deferred to a styling-only sweep.
- **Routing redesign.** `router.tsx` is a near-no-op (one route at `/`); deciding whether to add real routes is a product decision, not a refactor.

---

## Audit reports

Five focused audits backed this plan; see git history of `docs/refactoring/` if archived. Total findings: ~250 concrete items. Phase 1–4 above incorporate the highest-value subset; LOW-priority cosmetic items (~50) are deferred until they're touched by the relevant Phase.
