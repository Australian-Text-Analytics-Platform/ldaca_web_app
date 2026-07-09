# Frontend Simplification Opportunities - 2026-07-08

## Scope

This scan covered the handwritten frontend under `frontend/src`, with generated
API files excluded except where they affect the handwritten API boundary. The
goal is to remove unnecessary intermediate layers, reduce duplicated wiring,
and improve modularity where a file currently owns too many responsibilities.

Completed work is removed from the open TODO list and recorded in `Done`.

## Open TODOs

### 7. Split `AnnotationFeature` around real ownership boundaries

Confidence: High

Evidence:

- `AnnotationFeature.tsx` is over 1,200 lines.
- The file contains a nested `AnnotationClassDescriptionsEditor` with its own
  query, mutation, dialog, and draft-row state.
- The main feature owns tab-setting parsing/persistence for AI mode, provider,
  model, prompt, temperature, and reasoning.
- It also owns source/class/example node selectors, companion column maps,
  start/resume/reset lifecycle, AI preview lifecycle, and rendering.
- The AI provider card logic is already partly componentized in
  `AnnotationAiSettings`.

Recommendation:

Extract only meaningful ownership units:

- `useAnnotationTabSettings` or `annotationTabSettings.ts` for
  parsing/stringifying tab settings.
- `useAnnotationClassDescriptions` plus a separate
  `AnnotationClassDescriptionsEditor` file, so the parent and editor share the
  same query key/fetcher.
- Optionally test/extract provider-card building from `AnnotationAiSettings` if
  provider behavior keeps growing.

Avoid splitting into tiny presentational wrappers. The payoff is moving state
ownership and backend/query behavior out of the main feature shell.

### 22. Remove remaining legacy analysis payload adapters

Confidence: Lower, migration-dependent

Progress:

- Removed one legacy detach adapter on 2026-07-09. Concordance,
  concordance-dispersion, and quotation detach requests now require explicit
  non-empty `selected_columns`; frontend task-flow handlers always submit the
  dialog selection and reject empty direct calls before hitting the backend; and
  backend workers no longer interpret omitted generated-column selections as
  "keep all generated columns."

Remaining evidence:

- Quotation hydration still accepts both `node_id` and `nodeId`, and reads
  nested or flat engine settings.
- Sequential Analysis hydration still accepts both `node_id` and `nodeId`.
- Task utilities still expand legacy task labels such as `token-frequency`.
- `tabStateOps` still mirrors the default `input_sets.source` value to legacy
  `AnalysisTab.inputs`.

Recommendation:

If old persisted sidecars/tasks no longer need to hydrate, remove the
compatibility paths and keep only the current generated request/tab shapes. If
old workspaces must keep loading, document the compatibility boundary
explicitly so it does not spread into unrelated live-node helpers.

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
      explicit request/tab DTO contracts and the legacy adapters tracked in
      item 22.

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

## Endpoint And Source-Of-Truth Notes

The original production `page=1&page_size=1` preprocessing metadata misuse is
gone. Remaining handwritten `getNodeData` calls are row-content flows:
workspace table data, annotation preview/results rows, preprocessing raw-preview
fallback, and language sampling for stop-word/tokenizer recommendations.

Live workspace-node identity is now `WorkspaceNodeInfo.id`. Keep `node_id` only
where the backend contract explicitly uses that field, such as path params,
request bodies, `AnalysisTabInput`, detach-option/result DTOs, and item 22's
persisted analysis payload adapters.

## Layers Checked And Not Recommended For Flattening

- `WorkspaceProvider` slice contexts: the data/selection/status/action split is
  a real identity boundary for frequent consumers. Removing it would likely
  increase rerenders and coupling.
- `useWorkspaceTabs` and `tabStateOps`: this is real sidecar persistence,
  legacy input mirroring, and optimistic read-modify-write logic. Keep it until
  item 22 decides the legacy `inputs` mirror can be removed.
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
