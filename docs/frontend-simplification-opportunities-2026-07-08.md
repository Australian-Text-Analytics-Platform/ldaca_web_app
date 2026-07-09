# Frontend Simplification Opportunities - 2026-07-08

## Scope

This scan covered the handwritten frontend under `frontend/src`, with generated
API files excluded except where they affect the handwritten API boundary. The
goal is to remove unnecessary intermediate layers, reduce duplicated wiring,
and improve modularity where a file currently owns too many responsibilities.

Completed work is removed from the open TODO list and recorded in `Done`.

## Open TODOs

No open TODOs remain from this scan. New findings from the follow-up endpoint
rescan should be added here before implementation.

## Done

1. Remove unused and duplicate exports reported by `knip`
   - Done 2026-07-09. Removed unused annotation AI default exports, made
     topic-modeling constants file-local where appropriate, stopped exporting
     `MultiSeriesChartType`, removed follow-up unused preprocessing metadata
     exports, and verified `pnpm -C frontend knip`.

2. Remove the unused `WorkspaceNodeList` batch-delete path
   - Done 2026-07-09. Removed the list-view batch-delete props, state,
     confirmation dialog, imports, and dead tests. Batch deletion remains in
     graph view only.

3. Replace preprocessing one-row metadata queries with node info
   - Done 2026-07-09. Removed the production `page=1&page_size=1` metadata
     request; remaining preprocessing `getNodeData` calls are row-preview
     flows.

4. Replace the single-use `@tanstack/react-form` dependency in Sample Rows
   - Done 2026-07-09. `useSliceSubTab` now uses local React state and
     `sliceFormModel.ts`; `@tanstack/react-form` was removed from
     `frontend/package.json` and `pnpm-lock.yaml`.

5. Consolidate view metadata and remove tabbed wrapper duplication
   - Done 2026-07-09. Added light `viewIds.ts` for store/router ids,
     centralized labels/icons/workspace gating/tabbed-main flags in
     `viewRegistry.ts`, moved lazy feature loading into the component-only
     `viewComponents.tsx` Fast Refresh boundary, and deleted the six
     one-purpose `*TabbedFeature.tsx` wrappers plus `tabbedMainViews.ts`.

6. Centralize analysis task/tab group identifiers
   - Done 2026-07-09. `analysisIds.ts` now owns tab-group, task-type, and
     last-run identifiers used by the view registry, analysis feature configs,
     hydration, aliasing, and task-stream filtering.

7. Split `AnnotationFeature` around real ownership boundaries
   - Done 2026-07-09. Extracted tab-persisted AI settings into
     `useAnnotationTabSettings`, moved class-description fetching and row
     normalization into `useAnnotationClassDescriptions`, moved the compact class
     editor/dialog into `AnnotationClassDescriptionsEditor.tsx`, and kept
     `AnnotationFeature.tsx` focused on selector, run, preview, and result
     orchestration. Added focused hook tests and kept the existing annotation
     feature coverage passing.

8. Add a narrow helper for analysis run envelopes
   - Done 2026-07-09. `runAnalysisTaskEnvelope.ts` now owns the shared submit
     envelope for token-frequency and topic-modeling runs while request
     construction and result shaping stay feature-specific.

9. Add a small operation-lifecycle helper for workspace mutations
   - Done 2026-07-09. `workspaceMutationLifecycle.ts` centralizes operation
     start, success cleanup, and error reporting for workspace mutation hooks.

10. Modularize `CustomNode` without changing its interaction model
    - Done 2026-07-09. `CustomNode.tsx` now delegates toolbar ownership, menu
      placement, settings menu rendering, and inline rename rendering to focused
      helpers/components. Added focused menu-placement tests.

11. Trim unused `components/ui/sidebar.tsx` primitives
    - Done 2026-07-09. Sidebar UI exports now only include primitives used by
      the app shell/sidebar code and tests; unused shadcn-template primitives
      and imports were removed.

12. Reduce mechanical comments that add navigation noise
    - Done 2026-07-09. Removed repeated generated boilerplate phrases from
      handwritten frontend comments, kept comments that explain real behavior,
      and reduced the high-noise `rg` pattern set to zero matches.

13. Fix stale frontend developer-guide API docs
    - Done 2026-07-09. The frontend state/data-flow guide now describes the
      generated hey-api boundary, runtime base resolver, and limited raw-fetch
      exception for streaming downloads.

14. Resolve the `stores/index.ts` barrel policy mismatch
    - Done 2026-07-09. The barrel comment now says it is only for the UI
      store/type used by layout routing; other stores remain imported from
      their owning modules.

15. Simplify Data Loader file-list scaffolding
    - Done 2026-07-09. Added a local `FileListShell` for the shared root-folder
      toolbar, file-list frame, and drop-state styling.

16. Add `knip` as an explicit maintenance check
    - Done 2026-07-09. Documented `pnpm -C frontend knip` in the frontend
      developer workflow as an unused-export/dependency guard.

17. Collapse `useSchemaManagement` onto node info
    - Done 2026-07-08. `useSchemaManagement` now subscribes to canonical node
      info, Sequential Analysis no longer passes row/graph-node schema
      fallbacks, `queryKeys.nodeSchema` is gone, and node snapshot fetch
      failures surface to callers.

18. Remove legacy workspace-node identity fallbacks
    - Done 2026-07-09 for live workspace-node helpers. Live helpers now use
      generated `WorkspaceNodeInfo.id` directly; `node_id` remains only for
      explicit request/tab DTO contracts such as `AnalysisTabInput` and
      backend result/request payloads.

19. Simplify join/concat created-node selection
    - Done 2026-07-08. Join/concat success handlers now select
      `createdNode.id` directly; the graph-diff fallback helper was removed.

20. Remove row-derived column fallbacks in preview tables
    - Done 2026-07-08. File preview and preprocessing preview tables now trust
      backend `columns`; join/stack schema compatibility uses node-info-derived
      column metadata.

21. Centralize export download URL construction
    - Done 2026-07-09. Export downloads now use `buildExportNodesDownloadUrl`,
      typed against generated export path/query types, while preserving raw
      browser/Tauri blob streaming.

22. Remove remaining legacy analysis payload adapters
    - Done 2026-07-09. Removed frontend reads/writes of the legacy
      `AnalysisTab.inputs` mirror, switched all tab-mounted analysis features to
      named `input_sets`, removed task-type alias expansion, removed quotation
      `nodeId`/flat-engine hydration fallbacks, removed Sequential Analysis
      `nodeId` comparison fallback, removed concordance `num_tokens_left/right`
      request fallbacks, and made Annotation AI provider models depend on the
      current `aiProviderModels` map instead of the old scalar `aiModel` tab
      setting.

23. Centralize task-stream URL construction
    - Done 2026-07-09. `useWorkspaceTaskStreamClient` now uses
      `buildTaskStreamUrl`, typed against generated `StreamTasksData`, for the
      native `EventSource` URL. The stream client still uses raw EventSource
      because browsers cannot attach SDK headers there, but the endpoint path
      and `token` query shape now come from one helper.

## Endpoint And Source-Of-Truth Notes

The original production `page=1&page_size=1` preprocessing metadata misuse is
gone. Remaining handwritten `getNodeData` calls are row-content flows:
workspace table data, annotation preview/results rows, preprocessing raw-preview
fallback, and language sampling for stop-word/tokenizer recommendations.

Live workspace-node identity is now `WorkspaceNodeInfo.id`. Keep `node_id` only
where the backend contract explicitly uses that field, such as path params,
request bodies, `AnalysisTabInput`, and detach-option/result DTOs.

Raw frontend URL construction is limited to boundaries that need URL strings or
external resources: health checks, document/file rendering, remote tutorial
registry reads, OpenRouter model discovery, export blob downloads, and native
EventSource task streaming. Backend export and task-stream URL builders are
typed against generated endpoint contracts.

## Layers Checked And Not Recommended For Flattening

- `WorkspaceProvider` slice contexts: the data/selection/status/action split is
  a real identity boundary for frequent consumers. Removing it would likely
  increase rerenders and coupling.
- `useWorkspaceTabs` and `tabStateOps`: this is real sidecar persistence and
  optimistic read-modify-write logic. The legacy `inputs` mirror has been
  removed; named `input_sets` are now the tab input source of truth.
- `useAnalysisFeature`: this is shared task hydration, clear/stop handling,
  tab-owned task id resolution, and task banner state. It is not an unnecessary
  wrapper.
- Task stream hooks: `useWorkspaceTaskStreamClient` owns SSE connection/retry,
  while `useWorkspaceTaskInbox` owns event ordering, terminal-state regression
  guards, store merging, and graph invalidation. This split is justified.
- Manual `useMemo`, `useCallback`, and `React.memo`: do not remove these
  broadly. The repo uses React Compiler, but several current memoization sites
  are around context values, React Flow, TanStack Table, effects, and d3/cloud
  rendering where identity can still matter.

## Suggested Verification By Change Type

- View registry/tab wrapper changes: `pnpm -C frontend test -- --run`,
  `pnpm -C frontend lint`, `pnpm -C frontend build`, plus manual smoke of view
  switching and multi-tab analysis.
- Annotation extraction: focused annotation tests plus `pnpm -C frontend test
  -- --run`, `pnpm -C frontend lint`, and `pnpm -C frontend build`.
- Legacy adapter removal: frontend tests, backend tests for affected persisted
  request/task readers, OpenAPI/client regeneration if route contracts change,
  and `git diff --check`.
