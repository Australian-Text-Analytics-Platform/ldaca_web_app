# Frontend Simplification Opportunities - 2026-07-08

> Refreshed 2026-07-10. This keeps the original 2026-07-08 report date and the
> completed-work history below while replacing the exhausted first-pass TODO
> list with the broader follow-up audit.

## Scope

The refresh covers handwritten React code, tests, documentation, configuration,
scripts, release workflows, and the Tauri shell. Generated API files remain
excluded except where handwritten code violates or duplicates their contracts.
The goal is still deletion and simpler ownership, but the scan also records
correctness-sensitive seams and deep modules that should be improved without
flattening intentional architecture.

This is a report-only backlog. Every proposed action or future interface below
is a **recommendation**, not a public API or type change made by this refresh.
Completed work remains in `Done` exactly as originally recorded.

## Audit Method And Evidence Baseline

The follow-up used complementary checks so that a single static-analysis result
did not decide architecture by itself:

- Read the root and frontend developer guides, then checked Git history around
  the affected boundaries to distinguish current contracts from abandoned
  experiments.
- Traced the route import graph and other import cycles, plus dependency and
  export usage from both package metadata and call sites.
- Ran configured Knip and a second Knip pass without the blanket UI exclusion,
  then classified hits as production dead code, test seams, generated ownership,
  or product-contract questions.
- Ran clone detection over handwritten sources and inspected the production
  bundle and source maps for duplicated work and optional-code weight.
- Followed state and query ownership end-to-end across stores, providers,
  TanStack Query keys/fetchers, React Flow reconciliation, analysis task streams,
  and Data Loader navigation.
- Followed Tauri packaging from Python runtime preparation through staging,
  resource configuration, Rust runtime discovery, process launch, and desktop
  workflows. Rust source validation was not inferred from a build that stopped
  before compiling the shell.

### 2026-07-10 Evidence Snapshot

| Check | Current baseline |
| --- | --- |
| Configured Knip | Passed. |
| Frontend lint | Passed. |
| Frontend tests | 163 test files and 772 tests passed. |
| Production build | Passed; 4,826 modules transformed; main entry 520.13 kB raw / 160.66 kB gzip. |
| Documentation drift | Passed for 70 literal targets. |
| Version check | All five configured sources agreed on 0.6.0, but the check missed `Cargo.lock` and release-tag drift. |
| `git diff --check` | Passed for the audited tree. |
| Clone scan | 28 clones across 365 files, about 1.06% duplicated tokens / 0.84% duplicated lines. |
| Format check | Currently reports 49 files. This is recorded debt, not a passing gate. |
| Tauri test/clippy | Could not reach useful source validation: the ignored generated runtime resource and stale/coupled lock/resource contracts stop the build first. |

## Open TODOs

Findings are ordered by risk and leverage within each group. `Strong` means the
evidence already supports implementation planning; `Worth exploring` means the
direction is promising but needs comparison or a bounded spike; `Worth
confirming` means a product, release, or external-consumer contract must be
settled before deletion.

### Correctness-sensitive ownership seams

#### C11. Validate packaged Python exactly as production resolves it

- **Evidence / strength — Strong:** [package_backend_runtime.py](../scripts/package_backend_runtime.py#L236-L259), [stage-backend-runtime.mjs](../frontend/scripts/stage-backend-runtime.mjs#L67-L109), and [main.rs](../frontend/src-tauri/src/main.rs#L366-L637) disagree about the runtime path contract; staging describes a relative `pyvenv.cfg` home but writes an absolute staging path, while desktop workflows execute different interpreter paths.
- **Recommended direction:** validate the same resolved interpreter, `PYTHONHOME`, `PYTHONPATH`, and environment that production launches, from a relocated bundle rather than the source staging tree.
- **Deletion test:** CI-specific interpreter guesses and the absolute-path rewrite are replaced by one consumed runtime-layout contract.
- **Validation:** relocate a staged bundle on macOS/Windows, launch health and representative imports, verify no checkout paths leak, and compare CI resolution to Rust launch resolution.

### Deletion and simplification

### Deep modularity opportunities

#### M6. Split `main.rs` into deep internal modules

- **Evidence / strength — Strong:** [main.rs](../frontend/src-tauri/src/main.rs#L126-L1156) combines runtime resolution, backend process/environment/port lifecycle, native download, platform behavior, and Tauri assembly; nested mutex/optional-child ownership obscures shutdown invariants.
- **Recommended direction:** keep a thin assembly entrypoint and extract runtime, backend-process, platform, and download modules; simplify to one process owner and testable lifecycle transitions.
- **Deletion test:** each module owns substantial cohesive behavior and `main.rs` becomes assembly rather than a collection of forwarding wrappers.
- **Validation:** startup failure, port collision, double-close, graceful timeout, process-tree termination, app exit, macOS/Windows resolution, and large native download.

#### M7. Resolve the Tauri runtime-layout contract once

- **Evidence / strength — Strong:** [package_backend_runtime.py](../scripts/package_backend_runtime.py#L236-L259) writes `python_executable`, [stage-backend-runtime.mjs](../frontend/scripts/stage-backend-runtime.mjs#L67-L96) reparses/rewrites it, and [main.rs](../frontend/src-tauri/src/main.rs#L210-L519) ignores the value and rescans layout.
- **Recommended direction:** either consume a relative manifest as the runtime contract or declare it diagnostic and delete path rewrites; resolve interpreter/home/site-packages once.
- **Deletion test:** repeated scans and manifest-field rewrites are gone, with one authoritative layout result passed to launch/validation.
- **Validation:** packaged and development layouts, relocated bundle, missing/corrupt manifest, free-threaded interpreter, site-packages imports, and both desktop platforms.

### Build, dependency, and maintenance improvements

### Direct Deletion Wins

These are compact implementation candidates with confirmed zero-callers or
unreachable callers. Product/external-contract caveats remain where noted.

| Candidate | Evidence / deletion guard |
| --- | --- |

### Worth Confirming

- **Release/signing policy:** tag rules, signing identity, and bundle targets are
  policy decisions. Record the chosen policy rather than calling these surfaces
  dead code.

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
   - Done 2026-07-09 and narrowed 2026-07-10.
     `workspaceMutationLifecycle.ts` centralizes operation start and terminal
     loading cleanup; rejected promises remain with owning feature feedback
     rather than being copied into an unread global error map.

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
      setting. The shared hydration preference helper now only normalizes
      current snake_case fields and no longer maps camelCase token-frequency
      preference aliases.

23. Centralize task-stream URL construction
    - Done 2026-07-09. `useWorkspaceTaskStreamClient` now uses
      `buildTaskStreamUrl`, typed against generated `StreamTasksData`, for the
      native `EventSource` URL. The stream client still uses raw EventSource
      because browsers cannot attach SDK headers there, but the endpoint path
      and `token` query shape now come from one helper.

24. Centralize auth redirect URL construction
    - Done 2026-07-09. Google and CILogon login components now use
      `authRedirectUrls.ts`, typed against generated redirect endpoint data,
      instead of manually joining `getApiBase()` with `/auth/...` paths.

25. Remove row-derived column fallback from workspace data table
    - Done 2026-07-09. `WorkspaceTable` now receives `NodeDataResponse.columns`
      from `useWorkspaceDataTable` and uses those backend columns for ordering
      and mutation validation instead of inferring column names from the first
      row.

26. Remove graph-node `node_id` identity alias
    - Done 2026-07-09. React Flow `CustomNode` data now carries the generated
      workspace node `id` directly instead of remapping it to an internal
      `node_id` field and reading that alias for graph actions.

27. Remove legacy workspace-summary aliases in Data Loader
    - Done 2026-07-09. Data Loader workspace cards and actions now consume
      generated `WorkspaceSummary` fields directly (`id`, `modified_at`,
      `total_nodes`) instead of accepting `unique_id`, `updated_at`, or
      `dataframe_count` fallbacks.

28. Remove selected-node `node_id` aliases in concordance view models
    - Done 2026-07-09. Concordance source/colour/materialization helpers now
      resolve selected workspace nodes by generated `id` plus backend
      `label_to_node_map`; they no longer accept an extra `node_id` alias on
      selected-node objects.

29. Upgrade frontend TypeScript compiler and modernize TS config
    - Done 2026-07-09. The frontend now runs TypeScript 7.0.2 for `tsc` via
      the `typescript-7` package alias, keeps `typescript` on the official
      `@typescript/typescript6` compatibility API for `typescript-eslint`, and
      enables `moduleDetection: "force"`, `erasableSyntaxOnly`, and
      `verbatimModuleSyntax` in `tsconfig.json`.

30. Remove the legacy analysis tab `inputs` contract
    - Done 2026-07-09. The backend tab sidecar model now accepts only named
      `input_sets` plus `settings`; the removed top-level `inputs` mirror is
      rejected instead of silently ignored, OpenAPI was regenerated, and
      generated `AnalysisTab` now requires `input_sets`/`settings`.

31. Remove legacy token-frequency clear API from the generated client
    - Done 2026-07-09. The backend no longer exposes the broad
      `DELETE /api/workspaces/{workspace_id}/token-frequencies` endpoint, and
      regenerated frontend API files no longer export `clearTokenFrequencies`.

32. Separate ordered selection membership from the active node (C1)
    - Done 2026-07-10. `selectionStore` now owns independent `activeNodeId` and
      ordered `selectedNodeIds` through semantic activate, reorder, remove,
      replace, toggle, and clear actions. Data View no longer mirrors or repairs
      tab order, and successful node deletion always removes the deleted id so
      active and non-active deletion share one tested fallback path.

33. Make node-table query identity equal the request identity (C2)
    - Done 2026-07-10. Data View now owns per-workspace/node table request state
      and its selected-node query. One complete generated query object,
      including `filter_op`, drives both `queryKeys.nodeData` and the SDK call;
      workspace selection contexts and Quotation no longer carry/fall back to
      Data View pagination, sorting, or filtering.

34. Define one serializable React Flow presentation projection (C3)
    - Done 2026-07-10. React Flow reconciliation now serializes every rendered
      backend node and edge field, including node colour and edge label/style,
      while leaving drag position and selection on their identity-sensitive
      paths. Cached node commands read current action/workspace/view context at
      invocation time, and the duplicate empty-selection effect is gone.

35. Scope fresh-node observation to a workspace (C4)
    - Done 2026-07-10. Freshness baselines are keyed by workspace, overlapping
      node ids remain independent, removed ids are pruned automatically so
      recreation is fresh, and the zero-caller `forgetNodeIds` action was
      deleted. Focused regressions plus lint, 167 files / 782 tests, build,
      Knip, and `git diff --check` passed.

36. Scope analysis status to workspace and owned task ids (C5)
    - Done 2026-07-10. `useAnalysisTaskStatus` now treats task type as a
      classifier and filters by workspace plus the actual task ids owned by the
      active tab. The task store has no backend tab id; an explicitly empty
      task-id list represents an unrun tab and cannot inherit a sibling task.
      Materialization lifecycles use their workspace and tracked per-node task
      ids instead of observing every same-type task globally.

37. Expose only the synchronized safe result setter (C6)
    - Done 2026-07-10. `useSafeResult` now returns one
      `Dispatch<SetStateAction<T | null>>`-compatible setter beside state and
      its synchronized ref. Direct values and functional updates share the
      stale-result guard, and analysis callers can no longer bypass ref
      synchronization through the raw React setter.

38. Bind preprocessing previews to complete request identity (C7)
    - Done 2026-07-10. Preview signatures always include the serialized request,
      including workspace and operation-shaping fields. Join, Stack, raw
      fallback, Filter, Sample, Find, Create, and expression fetchers consume
      request-owned workspace data and pass the hook's `AbortSignal` through the
      generated SDK, so workspace switches cancel old requests and stale
      completions cannot win.

39. Apply exact preprocessing limits and neutral helper ownership (D24)
    - Done 2026-07-10. The active preprocessing subtab now supplies Join's
      two-node cap, Stack's six-node cap, or the one-node default to the shared
      selector. Restored over-limit state is immediately capped to the most
      recent allowed inputs and persisted by that shared boundary, so Join and
      Stack no longer truncate or warn independently. Checklist search and
      placeholder-on-Tab moved wholesale to `views/common`, while only
      sampling-name construction moved out of the preprocessing-specific
      expression/filter naming module; no compatibility re-exports remain.

40. Own workspace-download completion above Data Loader navigation (C8)
    - Done 2026-07-10. `WorkspaceDownloadsProvider` now owns pending artifact
      tasks inside the persistent workspace shell, reads auth headers live, and
      matches terminal work by workspace plus returned task id. It claims each
      terminal outcome before asynchronous artifact download/save, so navigation
      and repeated success/failure/cancel emissions cannot orphan or duplicate a
      save/toast; Data Loader only consumes the provider handle.

41. Delete the orphan data-folder dialog shell (D8)
    - Done 2026-07-10. Settings now imports the live
      `DataFolderSettingsPanel` from its correctly named module, while the
      zero-production-caller `DataFolderDialog` shell and shell-only test are
      gone. Direct panel coverage preserves workspace unload, admin data-root
      update, auth refresh, and workspace/file query refresh behavior.

42. Give Data Loader mutations and dialogs one owner (D23)
    - Done 2026-07-10. Upload, delete, move, folder creation, and sample import
      each invalidate the file query once through their mutation owner; LDaCA
      keeps terminal task-owned invalidation and claims successful task ids from
      both reconnect snapshots and incremental events, so replayed records
      cannot refresh twice. The explicit Refresh button remains a separate
      refetch command. `refetchFiles` prop threading and duplicate immediate
      refetches are gone. File preview has one Dialog owner, and the disabled
      no-workspace Add action no longer carries an unreachable alert/state
      facade.

43. Let the generated client and one app owner own auth (D1)
    - Done 2026-07-10. `AuthBootstrap` now mounts once after backend health,
      while `useAuth` is subscription-only. A dependency-light token module is
      shared by `authStore` and generated fetch configuration, preserving stale
      token suppression in single-user mode without the dynamic store import.
      Ordinary generated SDK calls and their auth-only parameter ladders no
      longer pass headers; explicit auth remains only for raw file/export,
      native download, and `EventSource` boundaries, while custom Oni and
      timeout headers remain call-site owned.

44. Derive view visibility instead of mirroring it into UI state (D2)
    - Done 2026-07-10. `useVisibleViews` derives registry order directly from
      `preferencesStore.hiddenViews`, defensively retaining Data Loader even
      for stale persisted input. Sidebar and Settings write the preference
      directly, `uiStore` retains only `currentView`, and `ViewRouteSync`
      remains the sole hidden/workspace-gated active-view repair owner.

45. Delete workspace error state with no reader (D3)
    - Done 2026-07-10. Removed the UI-store operation error map, setter,
      workspace status `errors` field, query-error projection, and mutation
      plumbing. Mutation promises still reject to their owning feature/toast
      boundary, while the shared lifecycle always clears operation loading on
      success and failure.

46. Persist preferences through one codec/projection (D4)
    - Done 2026-07-10. `preferencesCodec.ts` now owns server normalization,
      the durable local projection, generated update encoding, and equality.
      Store hydration/sync, Zustand `partialize`, and the debounced subscriber
      all consume that one field contract.

47. Remove compact-panel state that cannot affect layout (D5)
    - Done 2026-07-10. The right-panel collapse remains a real zero-width shell
      mode but no longer mutates or remembers a second split ratio. Removed the
      collapsed-ratio constant, last-ratio state, unreachable compact toolbar
      rendering, unused node-schema callback, and unused public split setter.

48. Mount global feedback, docs, and toaster hosts once (D6)
    - Done 2026-07-10. `GlobalHosts` is mounted once outside backend/auth
      branches and owns the single lazy feedback panel, docs end-of-life
      banner, and toast queue. Startup feedback and workspace/sidebar feedback
      now share the same modal intent and host.

49. Remove zero-caller `uiStore` state and actions (D7)
    - Done 2026-07-10. Removed the independent sidebar-collapse state/actions,
      mirror visibility actions, operation errors, `closeAllModals`, and
      `setModalOpen`. Every remaining UI-store field/action has a production
      consumer, with shadcn sidebar state kept in its live local provider.

50. Collapse documentation registry and modal contracts (D9)
    - Done 2026-07-10. `documentationRegistry.ts` now resolves bundled, cached,
      and remote entries into one target carrying kind, key, file, anchor, and
      label. Help/info/reference icons, hints, Sidebar, `uiStore`, and
      `DocumentView` consume that contract through one accessor and one dialog
      host; the three registry shims, parallel modal maps/slots, impossible
      warning path, dead refresh status fields, and orphan warning/information/
      reference index documents are gone. The 43 zero-literal entries were
      classified as 18 live dynamic targets and 25 retained by the explicit
      full offline fallback contract. The executable drift check now validates
      literal keys, registered files/anchors, relative links/assets, document
      reachability, the tutorial index, and workflow triggers/execution.

51. Give contextual hints one policy, state, and measurement owner (D10)
    - Done 2026-07-10. `hintsStore` owns permanent/session dismissals and upload
      follow-up context while persisting only durable user choices. One pure
      registry-order policy selects eligible anchors; unused priority,
      `oneShot`, and action fields were removed. `HintOverlay` installs one
      scroll listener, one resize listener, and one `ResizeObserver` shared by
      the presentational ring and bubble; polling requests a remeasurement
      without recreating that lifecycle. Focused tests cover ordering,
      dismissal persistence, route/modal conditions, target changes, and
      single observer/listener ownership. The full 190-file / 832-test suite,
      lint, Knip, production build, docs drift, and `git diff --check` passed.

52. Consolidate canonical workspace-node and schema metadata (D11)
    - Done 2026-07-10. `workspaceNodeMetadata.ts` now projects generated graph
      and node-info responses once into a required feature-facing contract.
      Legacy `WorkspaceNodeLike`, id/name aliases, document/schema resolvers,
      preprocessing metadata builders, and the handwritten schema response
      mirror are gone. Schema refresh returns generated `WorkspaceNodeInfo`
      directly, and Concordance source helpers accept canonical `id`/`name`
      identities plus the explicit backend `label_to_node_map` only.

53. Replace Topic Modeling transport mirrors with generated types (D12)
    - Done 2026-07-10. Topic result panels, bubble-chart hooks, zoom/brush
      controls, and adapters now consume generated topic/result contracts or
      narrow `Pick` projections. Handwritten types remain only where the chart
      owns a transformed domain model.

54. Require the live sidebar and graph node shapes (D13)
    - Done 2026-07-10. Sidebar lists consume generated graph nodes with required
      selection and action renderers. React Flow projects one explicit card
      model with required callbacks and freshness, while duplicate selection,
      schema, preview, table, and legacy node fallback fields were removed.

55. Remove the Knip UI blind spot and hidden exports (D14)
    - Done 2026-07-10. The blanket `components/ui/**` exclusion is gone.
      Twenty-one unused UI exports and four unused exported types were removed;
      twelve zero-caller primitives were deleted and nine live helpers became
      private. Configured Knip now scans the shared UI directory normally.

56. Render the shared detach dialog from feature owners (D15)
    - Done 2026-07-10. Quotation, Topic Modeling, and both Concordance detach
      variants now render `DetachColumnsDialog` directly with feature-owned
      copy and handlers. Four pass-through wrappers and their wrapper-only
      tests were deleted while hook/payload coverage remains at the owners.

57. Delete impossible Concordance read-only branches (D16)
    - Done 2026-07-10. The hardcoded false prop chain, unreachable control
      branches, disabled-reason constants, pagination gates, and action-state
      branches are gone from parameter, table, dispersion, and result owners.
      Concordance exposes only the supported interactive mode.

58. Remove verified zero-caller helpers (D17)
    - Done 2026-07-10. The topic minimum-size helper, recent-selection clear,
      unused zoom return, test-only tokenizer ordering helper, raw workspace
      query returns, dead task-flow outputs/actions, and obsolete schema-hook
      returns were deleted with their orphaned exports/tests. Deliberate
      behavioral test seams remain.

59. Narrow internal hook and schema surfaces (D18)
    - Done 2026-07-10. Analysis task/hydration hooks now return only consumed
      lifecycle behavior; the unused preference-persistence hydration branch,
      raw task/query fields, test-only schema snapshot builders, batch node-info
      helper, and public argument types with no external consumer were removed.
      Automatic terminal refresh and workspace-scoped hydration have direct
      regression coverage.

60. Make Knip authoritative and resolve PostCSS ownership (B6)
    - Done 2026-07-10. Knip scans shared UI code without broad ignores, and the
      unused direct `postcss` dependency/importer entry was removed. A frozen
      install confirms PostCSS remains transitively owned by Vite and Tailwind;
      the shared lockfile package records remain because those live dependencies
      still consume them.

    - Implementation validation: 189 test files / 811 tests, lint, configured
      Knip, production build, docs drift (70 literals), frozen install, and
      `git diff --check` passed. The separately tracked format baseline still
      reports the same 49 files.

61. Break the route import cycle without duplicating URL state (D19)
    - Done 2026-07-11. Pure view-search validation and canonical search shaping
      now live in the dependency-light `features/views/viewSearch.ts` contract.
      `ViewRouteSync` uses TanStack's typed route hooks directly, so the former
      `router -> App -> WorkspaceShell -> ViewRouteSync -> router` cycle is
      gone while the sync component remains the sole URL/store state machine.
      Invalid, hidden, and explicit-default URL states are repaired with history
      replacement; store/sidebar changes use push navigation. Route regressions
      cover cold deep links, workspace-gated hydration, back/forward to the
      default URL, cancellation of pending links, and auth-owner remounts.

62. Replace generated comment boilerplate with verified ownership notes (D20)
    - Done 2026-07-11. Structured scans removed the named placeholder families
      and their mechanically equivalent hook, component, library, object,
      interaction, and test-fixture variants from handwritten code. Trivial
      test/mock narration was deleted; non-trivial units now name verified
      consumers, callback roles, lifecycle effects, or branch flow. Existing
      third-party, listener, cancellation, task-lifecycle, and identity
      explanations were preserved instead of being flattened into generic
      caller prose.

63. Remove only compiler-owned local memoization (D21)
    - Done 2026-07-11. `ChromeTabs` no longer wraps four local rename/drag
      helpers in `useCallback`, and `useStackedSplits` now computes its small
      active-section total plus local collapse/style accessors directly. The
      resize ref and window-listener callbacks remain explicitly stable, as do
      `useResizableSplit`'s pointer/rAF chain and React Flow, TanStack,
      Recharts/d3, context, effect, and drag-integration identity boundaries.
      Focused tab rename/reorder and stacked collapse/resize tests passed.

64. Remove the over-broad internal analysis barrel (D22)
    - Done 2026-07-11. All analysis features and tests now import shared hooks,
      types, policies, and utilities from their owning modules. The residual
      one-consumer Token Frequency imports were made direct and
      `features/views/common/index.ts` was deleted. The intentional handwritten
      `@/api` application seam and focused feature/module entrypoints remain.

    - Implementation validation: 191 test files / 830 tests, lint, configured
      Knip, production build, docs drift (70 literals), handwritten import-cycle
      scan (616 files / zero cycles), comment-template/path/empty-block scans,
      and staged plus unstaged `git diff --check` passed. The separately tracked
      format baseline still reports the same 49 files.

65. Extract an Annotation AI preview-session boundary (M1)
    - Done 2026-07-11. `useAnnotationAiPreviewSession` now owns one exact
      preview generation from open/hydration through serialized overrides,
      page-aligned predictions, detach, annotate-all, cache removal, explicit
      close, and close-before-reopen ordering. `AnnotationAiPreviewPanel` is a
      renderer; manual and AI tables share `useAnnotationNodePage`, and setup,
      editor, and preview reuse `useAnnotationClassDescriptions`. Exact
      annotation targets persist per source node, so remounts neither guess a
      replacement nor recreate a column; an invalid saved target can still
      hydrate and clear its orphaned session.
    - The upstream preview store now issues opaque generation ids and includes
      ordered source-text content, normalized class names/descriptions, provider
      configuration, and the target column in exact ownership. Override, clear,
      detach, and annotate-all require that id. Stale generations and currently
      materializing generations have distinct semantic 409 codes preserved by
      the generated transport; explicit Close forgets only a proven stale id and
      retries a busy/network-failed clear before reopen. Materialization claims
      one immutable snapshot and either consumes or releases it. Paginated node
      data exposes a stable plan revision so source mutations recheck backend
      identity without turning page changes into new sessions.

66. Move Sequential result shaping into the chart model (M2)
    - Done 2026-07-11. The pure `sequentialChartModel.ts` now validates saved
      parameters and rows, preserves raw period-boundary identity, aggregates
      duplicate buckets, backfills sparse series, assigns collision-safe tuple
      ids and deterministic colors, and returns the one render/export/selection/
      detach domain. Null, blank, reserved-name, and delimiter-looking group
      values stay distinct; numeric axes use declared raw coordinates; malformed
      rows and aggregate metadata are diagnosed rather than cast or guessed.
    - `SequentialChart`, result summary cards, chart export, and detach consume
      that model directly. The former `useSequentialResultSummary` and
      `sequentialResultVisibility` layers and tests are deleted, dead read-only
      branches/aliases remain absent, generated detach types now preserve null
      group values without a compatibility cast, and stale/all/all-hidden
      selections cannot materialize an unintended node.

    - Implementation validation: 193 frontend test files / 869 tests, lint,
      configured Knip, production build (4,824 modules), docs drift (70
      literals), 534 backend tests with one optional tokenizer test skipped,
      backend type checking, focused backend Ruff checks, generated OpenAPI
      regeneration, and staged plus unstaged `git diff --check` passed. The
      separately tracked format baseline now reports 43 files; no Milestone 8
      file is among them.

67. Normalize Quotation rows, spans, highlights, and materialization once (M3)
    - Done 2026-07-11. `quotationResultsModel.ts` is now the sole raw response
      boundary. It normalizes scalar cells, converts backend Python code-point
      offsets to JavaScript code-unit offsets, validates custom or generated
      speaker/quote/verb spans, segments overlaps in canonical palette order,
      and parses materialized path/summary metadata. Table, clipped-cell, and
      full-detail adapters consume the same typed row; Unicode, empty text,
      overlapping spans, row detail, remote-engine validation, palette, and
      materialization behavior have focused coverage.
    - The duplicated `quotationCellText.ts` and `quotationHighlight.ts` layers
      are deleted. Renderers no longer inspect `__spans` or generated index
      columns and cannot fall back to a second payload interpretation.

68. Establish one Concordance result session and cohesive domains (M4)
    - Done 2026-07-11. `useConcordanceResultSession` now owns guarded result
      identity, canonical `metadata.task_id`, page-size hydration, pagination,
      loading/detach/materialize maps, materialized paths/summaries/bin caches,
      abortable whole-corpus bin queries, source/color derivation, and atomic
      clear. The adjacent result-controls and result-view-model hooks are
      deleted; camelCase task-id compatibility is explicitly rejected.
    - The former 803-line view model is split into table/combined,
      dispersion, and source/materialization domains. The results panel now
      accepts six named domain contracts instead of roughly 61 independent
      props, while its child block interfaces stay explicit rather than hiding
      behavior in an untyped context or `Record` bag.

69. Make the analysis host contract required and canonical (M5)
    - Done 2026-07-11. `AnalysisTabsHost` passes every analysis feature one
      `AnalysisFeatureHost` with normalized task/input/settings state and
      closure-bound persistence commands. All six repeated feature interfaces,
      tab-id guards, optional task writers, redundant `?? null` hydration
      adapters, and optional task-assignment/materialization branches are gone.
      Direct feature tests now construct the real host contract instead of
      relying on a standalone compatibility mode.

    - Implementation validation: 193 frontend test files / 875 tests, lint,
      configured Knip, production build (4,823 modules), docs drift (70
      literals), focused Quotation/Concordance/host characterization suites,
      feature import-cycle scan (477 files / zero cycles), and staged plus
      unstaged `git diff --check` passed. The separately
      tracked repository-wide format gate still fails (45 current diagnostics);
      every newly added or substantively rewritten Milestone 9 file passes the
      formatter, while the four touched baseline files remain in the existing
      format-debt set scheduled under B9.

70. Load stopwords only after the user asks for them (B1)
    - Done 2026-07-11. Compact language-picker metadata remains eager, but
      `loadMergedStopwords` imports the package behind one shared promise only
      after a supported choice. Concurrent and repeated requests reuse the
      module; a failed chunk clears the promise for a later retry. The feature
      rejects empty or missing lists, and the dialog closes only on success,
      keeping an accessible retry message visible for offline/chunk failures.
    - Production inspection moved the package into a distinct 117.33 kB lazy
      chunk and reduced `TokenFrequencyFeature` from about 225.09 kB to 108.21
      kB without duplicating the curated picker metadata.

71. Omit source maps from distributable artifacts (B2)
    - Done 2026-07-11. Vite now explicitly disables production source maps.
      There is no release upload/symbolication consumer, so backend and Tauri
      packaging no longer copy roughly 15 MiB of unused maps or ship frontend
      source text. Production artifact inspection found zero `.map` files.

72. Localize optional Sentry, Google, and Settings ownership (B3)
    - Done 2026-07-11. The error-monitoring adapter dynamically imports Sentry
      only for a configured DSN, buffers pre-root browser errors during SDK
      initialization, and is the sole capture surface used by React error
      boundaries. Google OAuth and client-id resolution now live in the lazy
      Google login module, so CILogon and no-auth paths never mount its provider.
      Sidebar Settings is rendered through a lazy dialog boundary only after
      the user opens it.
    - DSN-off, pre-root, caught-render, CILogon-only, Google-only, first Settings
      open, and production chunk boundaries have focused or existing coverage.

73. Remove the measured Vite 8 CSS residue (B13)
    - Done 2026-07-11. The forced esbuild CSS minifier and direct esbuild
      development dependency are removed; Vite 8's default CSS path produced
      the same three stylesheet surfaces with smaller emitted files (143.26,
      28.48, and 15.28 kB versus 143.79, 28.93, and 15.86 kB). The React
      Compiler Babel bridge remains because it is an active semantic contract.

    - Milestone 10 implementation validation: 197 frontend test files / 887
      tests, focused optional-boundary tests,
      TypeScript and targeted lint, two production builds, zero emitted source
      maps, explicit lazy stopword/Google/Settings/Sentry chunks, CSS output
      comparison, and staged plus unstaged `git diff --check`.

74. Remove private npm publication and CLI residue (B4)
    - Done 2026-07-11. The private workspace package retains only the name and
      version consumed by build/release tooling. Its unshipped `bin` aliases,
      package `files`, `prepublishOnly`, CLI implementation, `.npmignore`, and
      fictional npm publishing guide are deleted; no repository or workflow
      consumer remained.

75. Mock the handwritten API boundary instead of generated internals (B5)
    - Done 2026-07-11. All 19 application tests that mocked
      `generated/sdk.gen` now partially mock the stable `@/api` seam. The sample
      catalogue/import test uses request-level MSW for the generated query
      helper and mutation, proving payload transport rather than replacing a
      generator-owned closure. No handwritten test imports or mocks a generated
      path; the focused 19-file / 95-test migration suite passes.

76. Provide one executable frontend verification contract (B7)
    - Done 2026-07-11. `pnpm -C frontend check` is the non-mutating acceptance
      contract for formatting, source/config lint and type checking, tests,
      Knip, production build, and documentation drift. The pull-request
      workflow installs the frozen pnpm workspace and invokes that same command;
      the development guide no longer carries a second command list.

77. Add lint and type coverage for tooling configuration (B8)
    - Done 2026-07-11. `tsconfig.tooling.json` owns Vite/OpenAPI configuration
      types and the ESLint Node override uses that explicit project. The normal
      lint command covers both configs as well as `src`, exposing and fixing
      unsafe package JSON parsing, unchecked month indexing, template coercion,
      and an unnecessary Babel assertion without adding rule suppressions.

78. Resolve the format-check baseline (B9)
    - Done 2026-07-11. Biome mechanically formatted the 44 files remaining in
      the live baseline (the original audit recorded 49 before intervening
      milestone rewrites). Generated, build, and vendor content remain outside
      the configured `src/` surface. `format:check` now passes without mutation
      and is the first gate in the shared frontend `check` contract.

79. Use one Tauri development command and port contract (C9)
    - Done 2026-07-11. Tauri now invokes the pnpm-owned `dev:tauri` command and
      waits on its exact `127.0.0.1:3001` URL. Vite binds `0.0.0.0:3001` with
      `--strictPort`, so an occupied port fails immediately instead of silently
      moving while Tauri waits elsewhere. The general web dev command remains
      independently configurable on its normal port.

80. Cover Cargo lock and release-tag identity (C10)
    - Done 2026-07-11. Release verification now includes the local Tauri package
      entry in `Cargo.lock` and accepts an expected release tag that must be
      exactly `v<stamped version>`. The stale 0.5.0 lock entry was regenerated
      to 0.6.0; matching, mismatched, malformed, empty manual-dispatch, and
      prerelease parsing have executable fixtures.

81. Consolidate the release-version registry (B10)
    - Done 2026-07-11. `version-targets.mjs` is the sole six-surface registry
      consumed by bump and check commands, including extraction and replacement
      for Cargo manifest/lock. Adding a version source no longer requires two
      synchronized script edits, and the shared frontend check runs the live
      registry plus its Node test fixtures.

82. Consolidate Python runtime preparation (B11)
    - Done 2026-07-11. `prepare-backend-runtime.mjs` owns the one `3.14t`
      selector, clean packager invocation, and staging sequence. Local desktop
      scripts and both platform workflows invoke `pnpm prepare:backend-runtime`;
      the two lower-level package scripts and duplicated workflow commands are
      gone. A pure command-model test guards ordering and arguments.

83. Delete retired workflow and Tauri surfaces (B12)
    - Done 2026-07-11. Unconsumed `build-notes`, plugin HTTP, direct serde and
      dotenv dependencies, global Tauri injection, broad window/webview/HTTP
      capabilities, and `__BACKEND_PORT__` are removed. Repository and packager
      tracing found no staged `.env` producer; the ignored root secret file is
      a development input, not a packaged-runtime contract, so implicit
      `.env`/`.env.desktop` loading was deleted while explicit process
      environment overrides remain. Opener, dialog, downloads filesystem,
      native streaming, and backend URL injection remain live.

    - Milestone 11 implementation validation: the unified frontend contract
      passed with 198 test files / 891 tests, formatting, lint, source/tooling
      type checks, Knip, production build, docs drift, six-source version and
      tag fixtures, runtime-preparation/desktop config fixtures, Cargo metadata
      and formatting, strict-port collision rejection, and diff checks. Cargo
      source compilation now advances to the known generated-resource gate,
      which C11/M6/M7 remove in the next milestone.

## Endpoint And Source-Of-Truth Notes

The 2026-07-09 cleanup remains the starting contract for this refresh:

- The original production `page=1&page_size=1` preprocessing metadata misuse is
  gone. Remaining handwritten `getNodeData` calls fetch row content for workspace
  tables, annotation, preprocessing raw-preview fallback, or language sampling.
- Workspace and preview table columns come from `NodeDataResponse.columns`, not
  first-row inference.
- Live workspace-node identity is `WorkspaceNodeInfo.id`; `node_id` remains only
  where an explicit backend path/request/result DTO owns that spelling.
- Data Loader consumes generated `WorkspaceSummary`, and Concordance resolves
  selected nodes by generated `id` plus backend `label_to_node_map`.
- `clearTokenFrequencies` remains absent from the generated client.
- Raw URL/auth handling is justified only at boundaries that need a URL string
  or cannot use the generated transport: health/external resources, browser or
  native streaming downloads, auth redirects, and `EventSource`. Ordinary SDK
  calls should follow generated configuration rather than duplicate headers.

## Layers Checked And Not Recommended For Flattening

- **`WorkspaceProvider` slice contexts:** retain the data/selection/status/action
  contexts. Call-site tracing shows many consumers need only one slice; a single
  context would broaden update fan-out and erase a useful identity boundary.
- **URL synchronization behavior:** retain deep links, back/forward handling,
  pending-workspace resolution, and invalid-route repair in `ViewRouteSync`.
  D19 broke the router import cycle through the pure view-search contract;
  replacing the remaining state machine with local mirror state would duplicate
  router truth.
- **View ID / registry / component split:** retain light IDs for stores/routes,
  metadata for navigation, and lazy component loading in a Fast Refresh-safe
  module. The three layers have different import and runtime constraints; the
  earlier one-wrapper-per-view layer is already gone.
- **`QueryProvider`:** retain the app-level TanStack client/error-policy owner.
  It establishes one cache lifetime and does not merely forward props.
- **Analysis lifecycle and tab persistence:** retain `useAnalysisFeature`,
  `useWorkspaceTabs`, and `tabStateOps`. They own hydration, clear/stop behavior,
  task ID resolution, optimistic sidecar read-modify-write, and named
  `input_sets`; removing them would redistribute stateful behavior across six
  features.
- **Task stream client/inbox split:** retain the SSE connection/retry client and
  the independent inbox that orders events, rejects terminal-state regression,
  merges stores, and invalidates the graph. Transport lifetime and event-domain
  reduction are separate responsibilities.
- **Direct node-input queue plus explicit consume opt-out:** retain the simple
  request queue and `consumeNodeInputRequests: false` for multi-selector owners.
  The prior registration layer was removed because it introduced hidden
  coordination; do not restore it.
- **`CustomNode` decomposition:** retain toolbar, menu placement/settings, and
  inline rename components. Each owns interaction or geometry and has focused
  tests; recombining them would rebuild a large branchy React Flow node.
- **Nested error boundaries:** retain app/workspace/view boundaries because they
  isolate failures at different recovery scopes. Global feedback/docs/toast
  hosts are now consolidated separately at the app boundary.
- **Identity-sensitive memoization:** retain memoization around React Flow,
  TanStack Table, Recharts/d3, context values, and effect/listener identities.
  React Compiler does not remove third-party identity contracts; only the narrow
  local candidates in D21 should be tested.
- **API barrel and generated-code boundary:** retain `@/api` as the handwritten
  application seam and generated code as generator-owned output. Direct internal
  imports in tests are cleanup targets, but generated files should not be
  manually simplified.
- **React Compiler Vite/Babel bridge:** retain it. The compiler integration is a
  build contract, not residue from manual memoization.
- **Runtime-config classic-script ordering:** retain the classic bootstrap script
  before the module entry so the API/backend base exists before module
  evaluation in web and desktop packages.
- **Tauri runtime staging concept:** retain a prepared Python resource, but make
  its layout contract singular and testable. Also retain the native large-file
  download path, PID reaping and runtime-search fallbacks until production-path
  tests cover their startup/crash cases, `build.rs` because Tauri requires it,
  and Vite's relative asset base for backend/desktop static loading.
- **Live Tauri plugins:** retain opener, dialog, and filesystem plugins. Source
  tracing found real consumers; only unused HTTP/global/window-webview surfaces
  are deletion candidates.
- **Existing deep/lazy boundaries:** retain CodeMirror, MediaPipe,
  `DocumentView`/`WorkspaceView`, analysis feature chunks, and split-layout
  primitives. Bundle/import tracing shows these defer meaningful work or own
  reusable behavior rather than serving as cosmetic wrappers.

## Suggested Verification By Change Type

- Run the focused validation scenarios written under each finding first, then
  the repository's frontend lint, tests, build, and Knip gates. Do not use this
  report refresh as evidence that a future implementation passed those gates.
- Any backend/API contract change additionally needs backend type/tests and
  OpenAPI/client regeneration; generated files remain generator-owned.
- Tauri changes need clean-checkout Rust source checks that do not depend on a
  generated runtime, plus staged/relocated bundle tests on macOS and Windows for
  packaging behavior.
- Release and source-map changes need artifact inspection and policy-specific
  workflow checks, not only a successful frontend build.
- Broad deletion/comment passes should repeat dependency/export/cycle checks and
  targeted caller verification, preserving deliberate test seams and the
  retained layers above.
