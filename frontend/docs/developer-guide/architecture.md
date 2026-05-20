# Frontend Architecture

The frontend is a React 19, Vite 8, TypeScript application. It renders the
workspace UI, talks to the FastAPI backend, listens to task events, and is also
the web content loaded inside the Tauri desktop shell.

## Runtime Shape

The browser build and desktop build use the same React app. The only important
runtime difference is API base discovery:

- web/dev mode resolves the backend from environment, injected base path, or
  localhost defaults;
- desktop mode reads `window.__BACKEND_URL__`, injected by Tauri before React
  boots.

`src/index.tsx` initializes the app, loads Google OAuth config from injected
globals or environment, and renders the TanStack Router. `src/App.tsx` waits
for backend health and auth bootstrap before mounting the workspace shell.

## Main Layers

- `src/api/`: typed HTTP wrappers around backend endpoints.
- `src/providers/`: app-level providers such as the singleton QueryClient.
- `src/stores/`: Zustand stores for auth, UI, selection, preferences, tasks,
  and node colors.
- `src/features/`: feature-first UI modules for loader, preprocessing,
  analysis, workspace graph/table, hints, and snapshots.
- `src/hooks/`: shared hooks that are not feature-specific.
- `src/tutorials/`: bundled and remote documentation registries used by help,
  info, and reference icons.
- `src-tauri/`: Rust desktop shell and Tauri configuration.

## Data Flow

1. API modules call the backend through `httpRequest()`.
2. TanStack Query owns server state and cache invalidation.
3. Zustand owns client state that is not purely server-derived.
4. `WorkspaceProvider` composes workspace queries, selection, status, and
   mutation actions into slice contexts.
5. Workspace graph/table features consume those slices and specialized hooks.
6. Analysis features submit task requests, then update results from task stream
   terminal events.

## React Compiler Rule

The Vite React plugin uses React Compiler through the Babel compiler preset.
Do not add `useMemo`, `useCallback`, or `React.memo` for routine performance.
Manual memoization is reserved for identity-sensitive boundaries such as context
provider values, effects/subscriptions, TanStack/React Flow/table adapters, and
objects passed to external libraries.
