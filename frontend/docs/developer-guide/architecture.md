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
globals or environment, and renders the TanStack Router. `src/router.tsx` keeps
the single static route required by backend and Tauri packaging, but validates
the `view` search param so URLs can deep-link to a workspace view without
requiring path-based server fallback. `src/App.tsx` waits for backend health
and auth bootstrap before mounting the workspace shell.

## Main Layers

- `src/api/`: public barrel for generated backend SDK functions, generated
  TanStack Query helpers, and generated backend types.
- `src/providers/`: app-level providers such as the singleton QueryClient.
- `src/stores/`: Zustand stores for auth, UI, selection, preferences, tasks,
  pinned nodes, recent selections, and preprocessing inputs.
- `src/features/`: feature-first UI modules — `auth`, `feedback`, `hints`,
  `workspace`, and `views` (sidebar-tab features).
- `src/features/views/`: all left-sidebar view tabs (data-loader,
  preprocessing, token-frequency, concordance, sequential-analysis,
  topic-modeling, quotation, annotation, export) plus `views/common/` for shared analysis
  code.
- `src/hooks/`: globally shared hooks that are not feature-specific (e.g.
  `useBackendHealth`, `usePreferences`, `useResizableSplit`). Feature-specific
  hooks live in the owning feature module.
- `src/tutorials/`: bundled and remote documentation registries used by help,
  info, and reference icons.
- `src-tauri/`: Rust desktop shell and Tauri configuration.

## Data Flow

1. Feature code calls the backend through generated hey-api SDK functions,
   generated TanStack Query helpers, and generated types. Runtime support for
   the generated client lives under `src/lib/backend/`.
2. TanStack Query owns server state and cache invalidation.
3. Zustand owns client state that is not purely server-derived.
4. `WorkspaceProvider` composes workspace queries, selection, status, and
   mutation actions into slice contexts.
5. Workspace graph/table features consume those slices and specialized hooks.
6. Analysis features submit task requests, then update results from task stream
   terminal events.

## Routing

The frontend remains a client-side SPA with one route. Do not introduce
TanStack Start, SSR routes, or server functions unless the backend and desktop
packaging model changes. Use TanStack Router for typed app URL state that works
inside the existing static route. The active view is mirrored through the
validated `view` search param by `ViewRouteSync`, while `uiStore.currentView`
remains the UI source of truth for feature rendering and sidebar behavior.

## TypeScript Tooling

The build uses TypeScript 7 through the `tsc` binary exposed by the
`typescript-7` package alias. Type-aware ESLint still depends on the TypeScript
6 programmatic compiler API, so `typescript` is intentionally aliased to
`@typescript/typescript6`. Do not collapse these dependencies until
`typescript-eslint` supports the TypeScript 7 API directly.

`tsconfig.json` follows the modern TypeScript/Vite shape: strict mode,
`moduleResolution: "Bundler"`, `moduleDetection: "force"`,
`isolatedModules`, `erasableSyntaxOnly`, `verbatimModuleSyntax`,
`noUncheckedSideEffectImports`, and `noUncheckedIndexedAccess`.

## React Compiler Rule

The Vite React plugin uses React Compiler through the Babel compiler preset.
Do not add `useMemo`, `useCallback`, or `React.memo` for routine performance.
Manual memoization is reserved for identity-sensitive boundaries such as context
provider values, effects/subscriptions, TanStack/React Flow/table adapters, and
objects passed to external libraries.
