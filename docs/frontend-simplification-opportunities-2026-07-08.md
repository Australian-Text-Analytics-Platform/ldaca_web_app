# Frontend Simplification Opportunities - 2026-07-08

## Scope

This scan covered the handwritten frontend under `frontend/src`, with generated API files excluded except where they affect the handwritten API boundary. I read the frontend developer-guide pages first, sampled the largest feature/workspace modules, ran source searches for stale compatibility and duplicate metadata, and ran `pnpm -C frontend knip`.

The goal was to find simplification opportunities that remove unnecessary intermediate layers, reduce duplicated wiring, or improve modularity where a file currently owns too many responsibilities. I did not treat every large module as a problem. Some layers are doing real work and should stay.

## Highest Confidence

### ~~1. Remove unused and duplicate exports reported by `knip`~~

Status 2026-07-09:

Implemented. The original unused default exports, unnecessary topic-modeling
constant export, and `MultiSeriesChartType` export were removed. A follow-up
`knip` rescan found two new unused preprocessing metadata exports
(`extractNodeColumns` and `extractNodeDtypes`); those were removed as well, and
`pnpm -C frontend knip` now passes.

Evidence:

- `pnpm -C frontend knip` reports unused default exports for seven annotation AI components:
  - `frontend/src/features/views/annotation/components/AiProvidersPreferencesPanel.tsx`
  - `frontend/src/features/views/annotation/components/AnnotationAiSettings.tsx`
  - `frontend/src/features/views/annotation/components/AnnotationInferenceSettings.tsx`
  - `frontend/src/features/views/annotation/components/AnnotationPromptInput.tsx`
  - `frontend/src/features/views/annotation/components/AnnotationProviderConfigDialog.tsx`
  - `frontend/src/features/views/annotation/components/CustomProviderDialog.tsx`
  - `frontend/src/features/views/annotation/components/ModelNameCombobox.tsx`
- Example: `AnnotationAiSettings` already has a named export at `frontend/src/features/views/annotation/components/AnnotationAiSettings.tsx:90` and an unused default export at `frontend/src/features/views/annotation/components/AnnotationAiSettings.tsx:220`.
- `DEFAULT_TOPIC_SAMPLE_PERCENT` is used internally but exported unnecessarily from `frontend/src/features/views/topic-modeling/hooks/topicModelingParameterState.ts:2`.
- `MultiSeriesChartType` is exported from `frontend/src/features/views/common/components/MultiSeriesChart.tsx:25`, but only needed by that module's own prop type.

Recommendation:

Remove the unused default exports, make `DEFAULT_TOPIC_SAMPLE_PERCENT` file-local, and stop exporting `MultiSeriesChartType` unless another module needs it. This is a low-risk cleanup with a direct verification path: `pnpm -C frontend knip`.

### ~~2. Remove or wire the unused `WorkspaceNodeList` batch-delete path~~

Status 2026-07-09:

Implemented. The list-view batch delete path is gone from `WorkspaceNodeList`;
batch deletion remains available from the graph view where it has a real
workflow.

Evidence:

- `WorkspaceNodeListProps` exposes `onDeleteSelected` at `frontend/src/components/layout/WorkspaceNodeList.tsx:27`.
- The component carries delete state, `Trash2`, and an `AlertDialog` for it at `frontend/src/components/layout/WorkspaceNodeList.tsx:128` and `frontend/src/components/layout/WorkspaceNodeList.tsx:183`.
- Production search found only the component and tests. `Sidebar.tsx` renders `WorkspaceNodeList` without `onDeleteSelected`.

Recommendation:

Pick one direction:

- If sidebar batch delete is not planned, delete `onDeleteSelected`, the confirmation dialog, delete state, imports, and tests that only cover that dormant path.
- If the feature is desired, wire it from `Sidebar` through existing workspace delete actions so the code is reachable.

The first option is the simpler default because there is no production caller today.

### ~~3. Gate the preprocessing one-row data query to the Filter subtab~~

Status 2026-07-09:

Implemented by the preprocessing metadata cleanup. The production
`page=1&page_size=1` metadata request is no longer present; remaining
preprocessing node-data calls are row-preview flows.

Evidence:

- `DataPreprocessingFeature` fetches page 1, size 1 for the selected node whenever any preprocessing subtab has a selected node: `frontend/src/features/views/preprocessing/DataPreprocessingFeature.tsx:118`.
- The fetched `nodeData` is only passed as data to `FilterSubTab`: `frontend/src/features/views/preprocessing/DataPreprocessingFeature.tsx:236`.
- The loading object, including `nodeData`, is passed to every subtab: `frontend/src/features/views/preprocessing/DataPreprocessingFeature.tsx:252`, `frontend/src/features/views/preprocessing/DataPreprocessingFeature.tsx:266`, `frontend/src/features/views/preprocessing/DataPreprocessingFeature.tsx:279`, `frontend/src/features/views/preprocessing/DataPreprocessingFeature.tsx:292`, and `frontend/src/features/views/preprocessing/DataPreprocessingFeature.tsx:307`.

Recommendation:

Enable the one-row `getNodeData` query only when `activeSubtab === 'filter'`, and narrow non-filter subtab loading props so they do not depend on `nodeData`. This removes an avoidable backend request and makes each subtab's data needs clearer.

### ~~4. Replace the single-use `@tanstack/react-form` dependency in Sample Rows~~

Status 2026-07-09:

Implemented. `useSliceSubTab` now keeps Sample Rows form values in local React
state and still delegates validation/request derivation to `sliceFormModel.ts`.
`@tanstack/react-form` was removed from `frontend/package.json` and
`pnpm-lock.yaml`.

Evidence:

- `@tanstack/react-form` is declared in `frontend/package.json`.
- It is imported only in `frontend/src/features/views/preprocessing/slice/hooks/useSliceSubTab.ts:2`.
- `useSliceSubTab` stores simple string/boolean fields at `frontend/src/features/views/preprocessing/slice/hooks/useSliceSubTab.ts:141` and uses `useStore` plus a deprecated-selector workaround at `frontend/src/features/views/preprocessing/slice/hooks/useSliceSubTab.ts:170`.
- The actual validation/request derivation is already pure in `sliceFormModel.ts`, so the form library is not carrying domain complexity.

Recommendation:

Replace `useForm` with local `useState` or a small reducer for the existing `SliceFormValues`, keep `sliceFormModel.ts` as the pure model, and remove `@tanstack/react-form` if `knip` then reports no remaining uses. This removes a dependency and a deprecated API comment without changing the user workflow.

### 5. Consolidate view metadata and remove tabbed wrapper duplication

Evidence:

- `ViewType` and `ALL_VIEWS` live in `frontend/src/stores/uiStore.ts:18`.
- Sidebar labels/icons are duplicated in `NAV_ITEMS` at `frontend/src/components/layout/Sidebar.tsx:105`.
- Settings labels are duplicated in `VIEW_LABELS` at `frontend/src/components/dialogs/SettingsDialog.tsx:40`.
- Lazy component mapping lives in `VIEW_COMPONENTS` at `frontend/src/components/layout/ViewRouter.tsx:47`.
- Tabbed-main framing is duplicated in `TABBED_MAIN_VIEWS` at `frontend/src/components/layout/tabbedMainViews.ts:10`.
- Each analysis view has a one-purpose `*TabbedFeature.tsx` wrapper that only supplies `AnalysisTabsHost` with a tab group id.

Recommendation:

Create a small view registry split by import weight:

- A light `viewIds` module exports `ViewType`, `ALL_VIEWS`, and default visibility for stores/router.
- A UI registry module maps view id to label, icon, whether it requires a workspace, whether it owns a tabbed main card, and how to lazy-load the feature.
- For tabbed features, use a helper that wraps the lazy feature with `AnalysisTabsHost` and its tab group id instead of keeping six near-identical wrapper files.

Keep icon/lazy imports out of `uiStore` and `router` so the registry does not increase startup work.

### ~~6. Centralize analysis task/tab group identifiers~~

Status 2026-07-09:

Implemented. `frontend/src/features/views/common/analysisIds.ts` now owns
`ANALYSIS_TAB_GROUPS`, `ANALYSIS_TASK_TYPES`, `LastRunAnalysisType`, and
`CanonicalAnalysisTaskType`. Tabbed wrappers, feature `useAnalysisFeature`
configs, task-request hydration, task-type aliasing, and workspace task-stream
filtering now import those constants instead of repeating production literals.

Evidence:

- The same string identifiers appear in tab wrappers, `useLastRunRequest`, and `useAnalysisFeature` configs. Examples include `concordance_analysis`, `token_frequencies`, `topic_modeling`, `quotation_analysis`, and `sequential_analysis`.
- `ConcordanceFeature` uses `concordance_analysis` for `useLastRunRequest` and `useAnalysisFeature`; the wrapper uses the same value as the tab group.
- This duplication is related to the view registry duplication above.

Recommendation:

Add shared constants for analysis ids and canonical task types, probably colocated with the view registry or under `features/views/common`. Use them from wrappers, feature configs, and task utilities. This reduces string drift without changing behavior.

### 7. Split `AnnotationFeature` around real ownership boundaries

Evidence:

- `AnnotationFeature.tsx` is 1,250 lines.
- The file contains a nested `AnnotationClassDescriptionsEditor` with its own query, mutation, dialog, and draft-row state starting at `frontend/src/features/views/annotation/AnnotationFeature.tsx:232`.
- The main feature owns tab-setting parsing and persistence for AI mode/provider/model/prompt/temperature/reasoning at `frontend/src/features/views/annotation/AnnotationFeature.tsx:543`.
- It also owns source/class/example node selectors, companion column maps, start/resume/reset lifecycle, AI preview lifecycle, and rendering.
- The AI provider card logic is already partly componentized; `AnnotationAiSettings` has a pure-ish `buildConfiguredProviderCards` helper at `frontend/src/features/views/annotation/components/AnnotationAiSettings.tsx:52`.

Recommendation:

Extract only meaningful units:

- `useAnnotationTabSettings` or `annotationTabSettings.ts` for parsing/stringifying tab settings.
- `useAnnotationClassDescriptions` plus a separate `AnnotationClassDescriptionsEditor` file, so the parent and editor share the same query key/fetcher.
- Optionally test/extract provider-card building from `AnnotationAiSettings` if provider behavior keeps growing.

Avoid splitting into tiny presentational wrappers. The payoff is moving state ownership and backend/query behavior out of the main feature shell.

## Medium Confidence

### 8. Add a narrow helper for analysis run envelopes

Evidence:

- `useAnalysisFeature` is a real shared lifecycle hook for hydration, task id resolution, clear, stop, and task banners: `frontend/src/features/views/common/hooks/useAnalysisFeature.ts:44`.
- Feature-specific task-flow hooks still repeat the same run envelope:
  - `lastFetchedRef.current = { taskId: null, state: null }`
  - set running flags
  - clear local result/error
  - call generated API
  - extract and report task id
  - clear running flags on failure
- Token frequency shows this pattern at `frontend/src/features/views/token-frequency/hooks/useTokenFrequencyTaskFlow.ts:132`.
- Topic modeling shows the same pattern at `frontend/src/features/views/topic-modeling/hooks/useTopicModelingTaskFlow.ts:141`.

Recommendation:

Do not merge the task-flow hooks. Their request builders, hydration side effects, result shaping, detach/materialize behavior, and navigation handoffs are domain-specific.

Instead, consider a narrow helper for just the run envelope, for example:

```ts
await runAnalysisSubmit({
  runningRef,
  setIsRunning,
  lastFetchedRef,
  clearBeforeRun,
  submit,
  setLocalTaskId,
  onTaskIdAssigned,
  onFailedState,
  onError,
});
```

Only do this if it makes two or three hooks shorter in practice. A too-generic task-flow abstraction would be worse than the current duplication.

### 9. Add a small operation-lifecycle helper for workspace mutations

Evidence:

- `useWorkspaceGraphMutations` repeats `startOperation`, `endOperation`, and `setOperationError` around each mutation, for example `renameNode`, `copyNode`, and `setNodeColor` at `frontend/src/features/workspace/common/hooks/useWorkspaceGraphMutations.ts:59`.
- `useWorkspaceTransformMutations` repeats the same pattern for preprocessing/table mutations at `frontend/src/features/workspace/common/hooks/useWorkspaceTransformMutations.ts:53`.
- `useWorkspaceAnalysisMutations` repeats the same pattern for detach/materialize actions.

Recommendation:

Keep the current hook boundaries because graph, transform, management, and analysis mutations have different cache/selection side effects. But add a tiny helper to build the common mutation callbacks:

- `onMutate` starts an operation id.
- `onError` stores the error and ends the operation.
- `onSuccess` runs caller-provided invalidation/selection work and ends the operation.

This can reduce boilerplate while preserving explicit per-mutation cache invalidation.

### 10. Modularize `CustomNode` without changing its interaction model

Evidence:

- `CustomNode.tsx` is 834 lines.
- It contains the UI reducer at `frontend/src/features/workspace/graph-view/components/CustomNode.tsx:59`, toolbar ownership singleton at `frontend/src/features/workspace/graph-view/components/CustomNode.tsx:154`, menu placement math at `frontend/src/features/workspace/graph-view/components/CustomNode.tsx:195`, and the main renderer starting at `frontend/src/features/workspace/graph-view/components/CustomNode.tsx:235`.
- The interaction design is deliberate: one visible hover toolbar across the graph, menu placement to avoid viewport clipping, and fixed-size React Flow toolbar controls.

Recommendation:

Extract around those ownership boundaries:

- `useCustomNodeToolbarOwner` for the singleton store and `useSyncExternalStore` bridge.
- `computeMenuPlacement` into a small tested utility.
- `CustomNodeActionMenu` and `CustomNodeRenameForm` as subcomponents.

Do not simplify away the singleton owner or placement logic unless Playwright/canvas checks prove the behavior remains intact.

### 11. Trim unused `components/ui/sidebar.tsx` primitives if shadcn compatibility is not a goal

Evidence:

- The app imports sidebar primitives only from `Sidebar.tsx` and `WorkspaceShell.tsx`.
- `components/ui/sidebar.tsx` exports many shadcn-compatible primitives at `frontend/src/components/ui/sidebar.tsx:673`, including group/action/badge/skeleton/submenu primitives that production code does not currently import.
- Those unused primitives also keep imports such as `Input`, `Separator`, and `Skeleton` in the file.

Recommendation:

If preserving a full shadcn sidebar template is intentional, leave it and document that policy. Otherwise, trim to the primitives the app actually uses:

- `Sidebar`, `SidebarContent`, `SidebarFooter`, `SidebarHeader`, `SidebarInset`, `SidebarMenu`, `SidebarMenuButton`, `SidebarMenuItem`, `SidebarProvider`, `SidebarRail`, `SidebarTrigger`.

This is a medium-confidence cleanup because template compatibility may be a local preference.

### 12. Reduce mechanical comments that add navigation noise

Evidence:

- There are 169 occurrences of generic phrases such as `because the caller needs one documented boundary`, `because the feature needs this step`, or `because the task flow needs this step` in handwritten frontend code.
- Some small helpers have comments longer than the helper, for example `router.tsx` and `queryKeys.ts`.
- `queryKeys.ts` has a useful top-level explanation, then repeats generic "Consumed by" comments on individual keys starting at `frontend/src/lib/queryKeys.ts:23`.

Recommendation:

Keep comments that explain real ownership, caller context, lifecycle, or non-obvious behavior. Remove or rewrite mechanical boilerplate on tiny helpers and obvious shadcn wrappers. This aligns with the repo rule that comments should help navigation and avoid empty narration.

### ~~13. Fix stale frontend developer-guide API docs~~

Status 2026-07-09:

Implemented. The frontend state/data-flow guide now describes the generated
hey-api boundary, the current `src/lib/backend/env.ts` base resolver, and the
limited raw-fetch exception for browser/Tauri streaming downloads.

Evidence:

- `frontend/docs/developer-guide/state-and-data-flow.md:5` says `src/api/http.ts` is the legacy low-level HTTP wrapper.
- That file no longer exists.
- Current handwritten runtime support is under `frontend/src/lib/backend/env.ts` and `frontend/src/lib/backend/generatedClientConfig.ts`.

Recommendation:

Update the guide to describe the current generated hey-api client boundary and remove the nonexistent `src/api/http.ts` reference. This is documentation-only but important because agents use the developer guide before code exploration.

### ~~14. Resolve the `stores/index.ts` barrel policy mismatch~~

Status 2026-07-09:

Implemented with the simpler option. `frontend/src/stores/index.ts` now says it
is a UI-store barrel for layout/routing consumers, and that other stores stay
imported from their owning modules until intentionally promoted.

Evidence:

- `frontend/src/stores/index.ts` says consumers should import stores from `@/stores`.
- It only exports `useUIStore` and `ViewType`.
- Many files import other stores directly, such as `@/stores/preferencesStore`, `@/stores/analysisStore`, `@/stores/hintsStore`, and `@/stores/freshNodesStore`.

Recommendation:

Use the simpler fix unless the team wants a real barrel:

- Update the comment to say the barrel is only for the UI store/type currently used by layout routing.

If a full barrel is desired, add all public stores and migrate imports carefully, watching for cycles.

## Lower Confidence Or Opportunistic

### 15. Simplify Data Loader file-list scaffolding

Evidence:

- `DataLoaderFeature.tsx` is already split into action hooks and panels, so its current structure is mostly justified.
- The empty and non-empty file-list branches repeat the root folder toolbar, drop-state classes, and outer panel shell.

Recommendation:

Consider extracting a small `FileListShell` or `FileUploadDropRegion` only if another Data Loader change touches this area. This is not urgent.

### ~~16. Add `knip` as an explicit maintenance check if unused exports keep returning~~

Status 2026-07-09:

Implemented. `pnpm -C frontend knip` already exists as a package script, and
`docs/developer-guide/development-workflow.md` now documents it as an
unused-export/dependency guard to run after export, dependency, or dead-code
cleanup.

Evidence:

- `pnpm -C frontend knip` already runs and found actionable unused exports.

Recommendation:

After the current findings are cleaned up, consider documenting `knip` in frontend checks or adding a package script. Treat it as an unused-export guard, not a replacement for build/lint/tests.

## Endpoint And Source-Of-Truth Addendum

This follow-up scan looked specifically for unorthodox frontend data access such as using `getNodeData` with tiny pagination to infer metadata. The original production `page=1&page_size=1` preprocessing metadata request is no longer present after the preprocessing cleanup. The remaining handwritten `getNodeData` calls are row-content flows: workspace table data, annotation preview/results rows, preprocessing raw-preview fallback, and language sampling for stop-word/tokenizer recommendations.

### ~~17. Collapse `useSchemaManagement` onto node info~~

Status:

Implemented on 2026-07-08. `useSchemaManagement` now subscribes to the canonical node-info query, Sequential Analysis no longer passes selected row/graph-node payloads as schema fallbacks, `queryKeys.nodeSchema` has been removed, and node snapshot fetch failures now surface to the caller.

Original evidence:

- `useSchemaManagement` stores schema under a separate `queryKeys.nodeSchema` key while its fetcher already calls `fetchNodeInfo`: `frontend/src/features/workspace/common/hooks/useSchemaManagement.ts:200`.
- The hook still accepts `nodeData` and `selectedNode` fallback props, then parses `columns`, `dtypes`, and `selectedNode.data.schema` when `effectiveSchema` is empty: `frontend/src/features/workspace/common/hooks/useSchemaManagement.ts:157`, `frontend/src/features/workspace/common/hooks/useSchemaManagement.ts:162`, and `frontend/src/features/workspace/common/hooks/useSchemaManagement.ts:223`.
- Production search found only one caller, Sequential Analysis, which passes both the selected table data and selected graph node into the hook.
- `createNodeSnapshots` catches per-node `fetchNodeInfo` failures and substitutes an empty snapshot, which can hide a real metadata problem before a task is submitted.

Recommendation:

Derive schema only from node-info through `nodeInfoQueryOptions` / `fetchNodeInfo` (now backed by the collection node-info endpoint). Remove the `nodeData` and `selectedNode` fallback props, remove `queryKeys.nodeSchema` if no callers remain, and let snapshot fetch failures surface instead of submitting empty schema placeholders.

### 18. Remove legacy workspace-node identity fallbacks

Status:

Partially implemented on 2026-07-08. Live graph consumers now use generated `WorkspaceGraphNode` summaries, and `ExportFeature` now reads selected-node `id`/`name` directly instead of walking legacy aliases. Shared node-input helpers still accept `node_id` and sparse fixture/request shapes because persisted analysis inputs and task/request payloads explicitly use `node_id`; those need a narrower follow-up rather than deletion inside the endpoint split.

Evidence:

- Live workspace graph nodes are generated `WorkspaceNodeInfo` records with a required `id`, but shared node helpers still check `node_id`, `data.id`, `data.node_id`, `unique_id`, and synthetic `node-${index}` fallbacks.
- Examples include `getNodeIdentifier` in `frontend/src/features/views/common/nodeSelectionTypes.ts:22`, `resolveNodeId` in `frontend/src/features/workspace/common/hooks/useNodeColumnInfos.ts:22`, and `resolveNodeId` in `frontend/src/features/workspace/common/hooks/useAutoNodeColumns.ts:39`.
- `ExportFeature` repeats the same fallback chain for selected workspace nodes even though its node type is `WorkspaceNodeInfo`: `frontend/src/features/views/export/ExportFeature.tsx:80`.

Recommendation:

Use `id` as the single live workspace-node identity. Keep `node_id` only where the backend contract explicitly uses that field, such as `AnalysisTabInput`, request bodies, generated path params, and persisted task payloads. This should simplify selection helpers and make test fixtures match production shapes.

### ~~19. Simplify join/concat created-node selection~~

Status:

Implemented on 2026-07-08. Join/concat success handlers now select `createdNode.id` directly, and the `workspaceCreatedNodeSelection.ts` graph-diff helper plus pre-mutation graph-id snapshot were removed.

Evidence:

- The generated `joinNodes` and `concatNodes` responses are `WorkspaceNodeInfo`, which has required `id`.
- `resolveCreatedNodeId` still checks `createdNode.node_id`, then `createdNode.id`, then invalidates the graph and diffs node ids as a fallback: `frontend/src/features/workspace/common/hooks/workspaceCreatedNodeSelection.ts:14`.
- `useWorkspaceGraphMutations` records previous graph ids only to support that fallback before join/concat success handling.

Recommendation:

Select `createdNode.id` directly in the join/concat success path. Remove the `node_id` response fallback, the graph-diff fallback, and the pre-mutation graph-id snapshot unless another current caller needs it.

### ~~20. Remove row-derived column fallbacks in preview tables~~

Status:

Implemented on 2026-07-08. File preview and preprocessing preview tables now trust backend response `columns`; join/stack schema compatibility uses node-info-derived column metadata rather than row/header inference.

Evidence:

- `useFilePreview` returns `data?.columns ?? Object.keys(data.preview[0])`, but `FilePreviewResponse` exposes `columns`: `frontend/src/features/views/data-loader/hooks/useFilePreview.ts:61`.
- `PreviewTable` renders `columns` when present, otherwise derives headers from `Object.keys(data[0])`: `frontend/src/features/views/preprocessing/components/PreviewTable.tsx:104`.
- Current preprocessing preview response types expose explicit `columns`, including filter, slice, replace, concat, join, and Polars-expression preview responses.

Recommendation:

Treat response `columns` as the source of truth in typed preview paths. Remove `Object.keys(firstRow)` header inference where the API contract already supplies column order, and let missing `columns` render an empty/invalid preview state rather than inventing metadata from row objects.

### ~~21. Centralize export download URL construction~~

Status 2026-07-09:

Implemented. Export downloads now use `buildExportNodesDownloadUrl`, typed
against `ExportNodesData['path']` and `ExportNodesData['query']`, for both the
bulk and single-node download paths. The helper also moved the raw streaming URL
to the generated workspace-scoped route,
`/api/workspaces/{workspace_id}/export`, instead of the stale global
`/workspaces/export` path while preserving browser/Tauri blob streaming.

Evidence:

- `ExportFeature` manually builds `/workspaces/export` URLs with `URLSearchParams` in both export-all and download-one paths: `frontend/src/features/views/export/ExportFeature.tsx:172` and `frontend/src/features/views/export/ExportFeature.tsx:220`.
- The generated API already exposes `exportNodes` and `ExportNodesData['query']`, but the feature cannot directly use the generated call for browser/Tauri blob streaming without preserving its raw `fetch` and `download_to_downloads` paths.

Recommendation:

Keep the raw `fetch`/Tauri streaming implementation for downloads, but move URL/query construction into one typed helper that accepts `ExportNodesData['query']`. Both export paths should call that helper so endpoint shape and query naming stay aligned with the generated client.

### 22. Inventory remaining legacy analysis payload adapters

Evidence:

- Quotation hydration accepts both `node_id` and `nodeId`, and reads nested or flat engine settings.
- Sequential Analysis hydration accepts both `node_id` and `nodeId`.
- Task utilities expand legacy task labels such as `token-frequency`.
- `tabStateOps` still mirrors the default `input_sets.source` value to legacy `AnalysisTab.inputs`.

Recommendation:

Treat these as migration-dependent cleanup rather than immediate deletion. If old persisted sidecars/tasks no longer need to hydrate, remove the compatibility paths and keep only the current generated request/tab shapes. If old workspaces must keep loading, document the compatibility boundary explicitly so it does not spread into unrelated live-node helpers.

Status 2026-07-09: Removed one legacy detach adapter. Concordance,
concordance-dispersion, and quotation detach requests now require explicit
non-empty `selected_columns`; the frontend task-flow handlers always submit the
dialog selection and reject empty direct calls before hitting the backend; and
the backend workers no longer interpret omitted generated-column selections as
"keep all generated columns." Remaining legacy payload adapters in this item are
the persisted task/request hydration aliases and tab `inputs` mirroring listed
above.

## Layers Checked And Not Recommended For Flattening

- `WorkspaceProvider` slice contexts: the data/selection/status/action split is a real identity boundary for frequent consumers. Removing it would likely increase rerenders and coupling.
- `useWorkspaceTabs` and `tabStateOps`: this is real sidecar persistence, legacy input mirroring, and optimistic read-modify-write logic. It should stay.
- `useAnalysisFeature`: this is shared task hydration, clear/stop handling, tab-owned task id resolution, and task banner state. It is not an unnecessary wrapper.
- Task stream hooks: `useWorkspaceTaskStreamClient` owns SSE connection/retry, while `useWorkspaceTaskInbox` owns event ordering, terminal-state regression guards, store merging, and graph invalidation. This split is justified.
- Manual `useMemo`, `useCallback`, and `React.memo`: do not remove these broadly. The repo uses React Compiler, but several current memoization sites are around context values, React Flow, TanStack Table, effects, and d3/cloud rendering where identity can still matter.

## Suggested Verification By Change Type

- Unused exports: `pnpm -C frontend knip`, `pnpm -C frontend lint`, `pnpm -C frontend test -- --run`.
- Preprocessing query/form dependency changes: `pnpm -C frontend test -- --run`, `pnpm -C frontend lint`, `pnpm -C frontend build`.
- View registry/tab wrapper changes: `pnpm -C frontend test -- --run`, `pnpm -C frontend lint`, `pnpm -C frontend build`, plus manual smoke of view switching and multi-tab analysis.
- Graph `CustomNode` modularization: frontend tests plus Playwright/manual checks for hover toolbar, menu placement, rename, delete confirmation, and add-to-selection after switching views.
- Docs-only changes: `git diff --check`.
