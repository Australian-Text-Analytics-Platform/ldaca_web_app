# Feature Structure

The frontend uses feature-first folders. Shared UI primitives live under
`src/components/`, but workflow logic belongs in the owning feature directory.

## App Shell

`src/App.tsx` is the app composition point. It:

- hydrates the documentation registry,
- waits for backend health,
- initializes auth and preferences,
- sets up the query and workspace providers,
- renders the sidebar, active feature route, and right-side workspace panel.

`ViewRouter.tsx` maps the current view id from `uiStore` to a lazy feature
component.

## Workspace Features

`src/features/workspace/` contains the persistent right-side workspace surface:

- `common/` provides `WorkspaceProvider` and workspace hooks.
- `graph-view/` maps backend graph data into React Flow nodes and edges.
- `data-view/` renders the selected node's paginated table and column actions.
- `task-stream/` owns the SSE client and task event integration.

Workspace code should consume the slice hooks from `WorkspaceContext`, not a
monolithic workspace object.

## Data Loader

`src/features/data-loader/` owns workspace and file management:

- active workspace card,
- workspace manager card,
- file tree, preview, upload, and add-to-workspace flows,
- sample data and demo snapshot import,
- LDaCA Oni search and import task submission.

The LDaCA import dialog is an `AlertDialog` driven by
`hooks/useLdacaImport.ts`. It loads staff-picked records from the backend,
supports keyword or identifier searches, derives collection and file-type
filters from returned results, and submits the selected record ID to
`/files/import-ldaca`. Keep Oni tokens and portal requests behind the backend
API.

It blocks destructive workspace changes while active tasks exist.

## Preprocessing

`src/features/preprocessing/` contains reusable preprocessing subfeatures:

- filter,
- sample/slice,
- join,
- stack/concat,
- find/replace,
- create/aggregate,
- Polars expression.

Each subfeature owns its form state and preview/apply hooks, then delegates the
actual workspace mutation to `useWorkspaceActions()`.

Use TanStack Form for preprocessing forms when it reduces scattered scalar
state or validation plumbing. Keep existing hook/component contracts stable
during migration, and preserve preview payload derivation in the owning
subfeature hook so tests can validate behavior at the feature level.

## Analysis

`src/features/analysis/` contains text-analysis tabs:

- token frequency,
- concordance,
- sequential analysis/trends,
- topic modeling,
- quotation,
- AI annotator,
- export.

Shared analysis lifecycle code lives in `analysis/common/`. New analysis tabs
should start there before introducing feature-local task, color, or result
hydration logic.

## Hints, Docs, And Help

`src/features/hints/` and `src/tutorials/` support contextual docs. Help/info
icons reference literal registry keys. `frontend/scripts/check-docs-drift.mjs`
scans those literals and fails if a key is missing from the bundled registry.
