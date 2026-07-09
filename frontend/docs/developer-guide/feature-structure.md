# Feature Structure

The frontend uses feature-first folders. Shared UI primitives live under
`src/components/`, but workflow logic belongs in the owning feature directory.

## Directory Layout (Top Level)

```text
src/
├── api/              Generated SDK + barrel
├── components/       App shell + layout + shared UI (shadcn primitives)
├── config/           Environment vars and layout constants
├── features/         Domain modules
│   ├── auth/         Authentication and startup gating
│   ├── feedback/     Feedback survey modal
│   ├── hints/        In-app hint/tutorial system
│   ├── views/        All sidebar-tab features (see below)
│   └── workspace/    Right-side workspace surface (graph, data view, tasks)
├── hooks/            Globally shared hooks (non-feature-specific)
├── lib/              Shared utility/business logic
├── providers/        App-level providers (QueryClient, etc.)
├── stores/           Zustand stores (one per file)
├── test/             MSW handlers and test setup
└── tutorials/        Documentation registries
```

## Feature Module Convention

Every non-trivial feature module uses subdirectories for internal structure:

```text
features/<feature>/
├── index.ts          Public barrel export
├── components/       Feature-specific components
├── hooks/            Feature-specific hooks
├── utils/            Feature-specific utilities
└── types.ts          Shared types for the feature
```

Small feature modules may stay flat until they grow enough to warrant
subdirectories.

## App Shell

`src/App.tsx` is the app composition point. It:

- hydrates the documentation registry,
- waits for backend health,
- delegates auth gating to `features/auth/`,
- renders the sidebar, active feature route, and right-side workspace panel.

`ViewRouter.tsx` maps the current view id from `uiStore` to a lazy feature
component.

Auth gating (login screen, blocking screen, refresh banner) is owned by
`features/auth/`.

`WorkspaceShell` keeps the desktop app as a resizable sidebar/main/workspace
split, but stacks the main feature pane above the workspace pane below the `md`
breakpoint. Keep resize-only inline widths behind responsive overrides so mobile
screens do not inherit the desktop split and create horizontal overflow.

## Views — Sidebar-Tab Features

`src/features/views/` holds every tab rendered in the left sidebar. Each
subdirectory maps to one `ViewType`:

| ViewType          | Directory                    | Purpose                                                                                 |
| ----------------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| `data-loader`     | `views/data-loader/`         | File/workspace management, file tree, upload, LDaCA import                              |
| `filter`          | `views/preprocessing/`       | DataFrame preprocessing tabs (filter, slice, join, concat, find, aggregate, expression) |
| `token-frequency` | `views/token-frequency/`     | Word frequency + word clouds                                                            |
| `concordance`     | `views/concordance/`         | Keyword-in-context search with dispersion                                               |
| `analysis`        | `views/sequential-analysis/` | Time-series trends                                                                      |
| `topic-modeling`  | `views/topic-modeling/`      | BERTopic topic modeling + bubble chart                                                  |
| `quotation`       | `views/quotation/`           | Quotation extraction                                                                    |
| `annotation`      | `views/annotation/`          | Annotation setup and class-description selection                                        |
| `export`          | `views/export/`              | Data block export/download                                                              |

Shared code used by multiple views lives in `views/common/`:

- `common/components/` — shared dialogs (`DetachColumnsDialog`, `DatetimeFormatPanel`),
  pagination, row detail, chart, metadata/tokenizer selectors.
- `common/hooks/` — shared hooks (`useAnalysisFeature`, `useLastRunRequest`,
  `useDetachColumnsState`, `useMaterializeLifecycle`, etc.).
- `common/tasks/` — task-stream and submit-envelope helpers used by analysis
  task-flow hooks.
- `common/tabs/` — Chrome-style analysis tab host and `tabs.json` sidecar
  bridge. Each tab owns an optional `task_id`, required named `input_sets` for
  node selectors, and required string `settings` for small per-view controls.
  The reusable strip lives in `src/components/tabs/`: `chromeTabsLayout.ts`
  keeps DOM-free geometry helpers, while `chromeTabsInteractionState.ts` owns
  the coupled drag-preview and inline-rename reducer state.
- `common/nodeInputs/` — add-node-as-needed input resolution, validation, and
  persistence helpers used by analysis tabs and preprocessing subtabs.
- `common/utils/` — shared utilities (`datetimeFormatInfer`).
- `common/` root — shared helpers (`analysisTaskUtils`, `generatedColumns`,
  `runOrUpdate`, `palette`, etc.).

New views should start their shared code in `views/common/` before introducing
view-local task, visualization-colour, or result hydration logic.

### Data Loader

`views/data-loader/` is the workspace and file-ingestion surface. The feature
component wires workspace/file hooks and passes modal state to
`DataLoaderDialogs`, while hook modules own the workflows. LDaCA Oni import
state is centralized in `useLdacaImport` and its reducer so staff picks, search
filters, row-level import progress, and error state transition together instead
of being split across independent dialog state cells. The import search UI,
record cards, filters, and user-token subdialog live in
`components/LdacaImportDialog.tsx`; `DataLoaderDialogs` should stay the
top-level modal collector. Folder creation follows the same rule:
`useFolderCreation` owns the selected parent, draft name, submit state, and
invalid-name alert, while `DataLoaderDialogs` only renders that state.
File-browser citation preview state follows the same pattern:
`hooks/fileBrowserCitationState.ts` owns open/loading/content/close transitions,
and `useFileBrowserActions` only performs the README fetch side effect.

### Preprocessing Tab

`views/preprocessing/` is unusual: it hosts the `DataPreprocessingFeature` tab
component AND all the reusable sub-tab implementations (filter, slice, join,
concat, replace, aggregate, expression). Sub-tabs own their form state and
preview/apply hooks, then delegate actual workspace mutations to
`useWorkspaceActions()`.

Shared preview loading, cancellation, pagination, and refresh behavior belongs
in `hooks/usePreprocessingPreview.ts`; its reducer state lives in
`hooks/preprocessingPreviewState.ts`. Single-node tabs that need a raw-data
fallback before a valid operation payload exists should route through
`hooks/useNodePreviewWithRawFallback.ts` instead of rebuilding disabled/raw/json
signature branches locally.

Preprocessing uses the same `NodeInputsPanel` as task-backed analysis views,
but persists inputs per `(workspaceId, subtab)` in `preprocessingInputsStore`
instead of `tabs.json`. `DataPreprocessingFeature` owns that state and passes a
single `renderNodeInputsPanel` slot into each subtab; the subtab renders it at
the top of its parameter card so preprocessing follows the same layout as the
functional analysis tabs. The shared input selector hydrates selected-node
column metadata through the batched node-info query
(`POST /workspaces/{workspace_id}/nodes:batchGet` with body
`{ "nodes": [...] }`), then passes resolved column options into subtabs so
Filter does not fetch a data page just to populate schema controls.

The Polars expression subtab is the only preprocessing path that needs
CodeMirror. Keep it behind the lazy `PolarsExpressionSubTab` boundary in
`DataPreprocessingFeature.tsx` so the common filter/sample/join/stack/find/create
paths do not pay for the editor bundle until users open the expression tab.
Expression draft transitions and request serialization belong in
`expression/hooks/polarsExpressionDraftState.ts` so editor row add/remove/update
behavior and backend payload rules stay testable without rendering CodeMirror.

The Aggregate subtab keeps its visual builder helpers under
`views/preprocessing/aggregate/hooks/`. `aggregateExpressionModel.ts` owns
token-to-Polars serialization and request shaping, while
`aggregateBuilderUiState.ts` owns coupled drag/drop and inline custom-token UI
state. Browser drag payload transport and drop-index routing live in
`useAggregateBuilderDrag.ts`, so `useAggregateSubTab` remains the orchestration
layer for node selection, preview, expression, and apply flows.

Single-node preprocessing tabs share `utils/nodeMetadata.ts` for node lookup and
the fixed one-node `NodeInputsPanel` model. Node identity there accepts both
`id` and `node_id` backend shapes, so subtab hooks should reuse
`buildWorkspaceNodeMap()`, `getNodeKey()`, and
`buildSingleNodeSelectionPanelModel()` instead of rebuilding palette, color,
empty-column selection state, or id fallback rules locally.

The Slice subtab keeps numeric parsing, validation copy, preview readiness, and
slice/random-sample payload shaping in `slice/hooks/sliceFormModel.ts`.
`useSliceSubTab` should stay focused on local form state, preview fetching, and
the apply mutation. Reuse `deriveSliceFormModel()` when adding Sample Rows UI
state so preview and Add to Workspace continue to share the same request rules.

The Filter subtab keeps branchy condition value controls in
`filter/components/FilterConditionValueInput.tsx`, while
`useFilterSubTabSections` owns condition state, preview, and apply behavior.
`filter/hooks/useFilterCategoricalOptions.ts` owns lazy checklist option
loading, per-condition option search text, and workspace/node cache resets.
Categorical/list/topic unique-value normalization lives in
`filter/utils/categoricalOptions.ts`; reuse that helper when adding new
checklist-backed filter modes instead of rebuilding keys in the hook.
Pure filter row transition rules live in `filter/utils/conditionState.ts`.
Keep operator/value defaulting, checklist-load decisions, and stat-prefill
requests there so `useFilterSubTabSections` can stay focused on state updates
and async effects.

The Find subtab keeps backend payload rules in
`replace/hooks/replaceRequestModel.ts`. Preview and Add-to-Data-Block actions
must both use `buildReplaceRequest()` so output-column defaulting, match-count
translation, and extract connector handling cannot drift.

## Workspace Features

`src/features/workspace/` contains the persistent right-side workspace surface:

- `common/` provides `WorkspaceProvider`, workspace hooks, and selection utils.
- `common/hooks/` holds column/selection hooks (`useAutoNodeColumns`,
  `useSchemaManagement`, `useNodeColumnInfos`, etc.).
- `common/utils/` holds workspace-wide utilities (`selectionUtils`).
- `graph-view/` maps backend graph data into React Flow nodes and edges.
- `data-view/` renders the selected node's paginated table and column actions.
- `data-view/hooks/` holds workspace data-table hooks (`useColumnMutations`, `useWorkspaceDataTable`). The shared server-pagination hook (`useServerTable`) and footer (`ServerPaginationFooter`) live in `features/views/common/`.
- `data-view/utils/` holds column-type and persistence utilities (`columnTypes`,
  `columnPersistence`).
- `task-stream/` owns the SSE client and task event integration.

Workspace code should consume the slice hooks from `WorkspaceContext`, not a
monolithic workspace object.

## Hints, Docs, And Help

`src/features/hints/` and `src/tutorials/` support contextual docs. Help/info
icons reference literal registry keys. `frontend/scripts/check-docs-drift.mjs`
scans those literals and fails if a key is missing from the bundled registry.
