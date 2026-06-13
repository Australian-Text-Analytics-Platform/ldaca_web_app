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
| `ai-annotator`    | `views/ai-annotator/`        | LLM-powered text annotation                                                             |
| `export`          | `views/export/`              | Data block export/download                                                              |

Shared code used by multiple views lives in `views/common/`:

- `common/components/` — shared dialogs (`DetachColumnsDialog`, `DatetimeFormatPanel`),
  pagination, row detail, chart, metadata/tokenizer selectors.
- `common/hooks/` — shared hooks (`useAnalysisFeature`, `useLastRunRequest`,
  `useDetachColumnsState`, `useMaterializeLifecycle`, etc.).
- `common/tabs/` — Chrome-style analysis tab host and `tabs.json` sidecar
  bridge. Each tab owns an optional `task_id` and an `inputs` node set.
- `common/nodeInputs/` — add-node-as-needed input resolution, validation, and
  persistence helpers used by analysis tabs and preprocessing subtabs.
- `common/utils/` — shared utilities (`datetimeFormatInfer`).
- `common/` root — shared helpers (`analysisTaskUtils`, `generatedColumns`,
  `runOrUpdate`, `palette`, etc.).

New views should start their shared code in `views/common/` before introducing
view-local task, color, or result hydration logic.

### Preprocessing Tab

`views/preprocessing/` is unusual: it hosts the `DataPreprocessingFeature` tab
component AND all the reusable sub-tab implementations (filter, slice, join,
concat, replace, aggregate, expression). Sub-tabs own their form state and
preview/apply hooks, then delegate actual workspace mutations to
`useWorkspaceActions()`.

Preprocessing uses the same `NodeInputsPanel` as task-backed analysis views,
but persists inputs per `(workspaceId, subtab)` in `preprocessingInputsStore`
instead of `tabs.json`. `DataPreprocessingFeature` owns that state and passes a
single `renderNodeInputsPanel` slot into each subtab; the subtab renders it at
the top of its parameter card so preprocessing follows the same layout as the
functional analysis tabs. The selected input node's schema is fetched by node id
from `GET /workspaces/nodes/{node_id}/data`, so preprocessing does not depend
on graph selection to populate column controls.

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
