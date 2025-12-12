# Token Frequency Refactor Walkthrough

Welcome to the guided tour for breaking the existing `TokenFrequencyTab` monolith into a feature-first implementation. We'll move from understanding today's responsibilities to drafting the exact hooks, data flow, and TanStack-powered tables that will replace it.

## Lesson 1 – What does the current tab own?

1. **Selection Orchestration** – Locks nodes, captures snapshots, aligns node colors, and makes sure concordance hand-offs inherit the same context.
2. **Hydration & Persistence** – Pulls `current-request`/`current-result`, pipes stop words & token limits back to the backend, and reflects preference changes locally.
3. **Visualization** – Generates per-node word clouds, the comparative cloud, bar charts, and a custom stats table with head/tail trimming.
4. **Experience Glue** – Handles loading states, validation, stop word editing UX, and navigation to Concordance when a token is clicked. In the modern implementation, long-running runs are handled as **background tasks**: the tab tracks `metadata.task_id`, shows the shared `AnalysisTaskBanner` via `useAnalysisTaskLifecycle`, and auto-refreshes `current-result` when the task reaches a terminal state.

> **Checkpoint question:** Why isn't the existing component easy to reuse elsewhere?
>
> **Answer:** The component mixes API orchestration, lock management, visualization, and persistence concerns inside a single component, so nothing can be consumed independently (e.g., the concordance hand-off logic rewrites workspace selection directly instead of exposing a helper).

## Lesson 2 – Shared analysis hooks to extract first

We'll stand up a reusable toolbox under `src/features/analysis/common/` to centralize behavior other tabs will eventually share.

### `useAnalysisHydration`

- **Purpose:** Reconcile backend `current-request` + `current-result` payloads with local UI state and feature slices.
- **Inputs:** `workspaceId`, feature identifiers (e.g., `'token-frequency'`), `fetchRequest`, `fetchResult`, and state setters provided by the feature (like `setStopWords`).
- **Outputs:**
  - `hydrateFromServer()` async function guarded against concurrent calls.
  - `hydrationState` descriptor `{ status: 'idle' | 'loading' | 'error', error?: string }` for UI badges.
  - `persistPreferences(partial)` helper that automatically normalizes token limits (using `clampDisplayTokenLimit`) and propagates to both backend and local caches.
- **Notes:** Provide event listeners (`visibilitychange`, `focus`) internally, but expose callbacks so feature slices can plug into React Query invalidations later.

### `useAnalysisLockMachine`

- **Purpose:** Wraps `useAnalysisLockState`, snapshot helpers, and basic heuristics for locking nodes.
- **Inputs:** `workspaceId`, `maxNodes`, allowed data types, and `getAuthHeaders`.
- **Outputs:**
  - `lockWithCurrentNodes(columnsMap)` and `releaseLock()`.
  - Derived maps (`nodeIdToName`, `lockedNodeDisplayNames`) for visualization components.
  - `effectiveNodeColumnSelections` computed from locked vs current selections.
- **Implementation hint:** Internally call `createNodeSnapshots` and `applySelectedColumnsToSnapshots`, but surface a deterministic `lockState` object to simplify future testing.

### `useNodeColorPalette`

- **Purpose:** Issue deterministic colors per node selection and keep gradients consistent across features.
- **Inputs:** Selected node IDs, optional custom palette.
- **Outputs:** `getColor(nodeId, index)`, `setColor(nodeId, value)`, and `paletteLegend` metadata.
- **Bonus:** Emit a helper for generating gradient functions so the comparative cloud can live outside the Token Frequency feature.

> **Practice question:** When should we call `persistPreferences` from `useAnalysisHydration` versus from a local component?
>
> **Answer:** Call it whenever a user action changes backend-visible preferences (token limits, stop words). Purely visual toggles (like sorting) can stay local because they don't impact persisted state.

## Lesson 3 – Token Frequency feature package

We'll colocate everything under `src/features/analysis/token-frequency/`:

```text
features/analysis/token-frequency/
  api.ts            # Feature-scoped wrapper over textApi endpoints
  hooks.ts          # useTokenFrequencyState + derived selectors
  components/
    TokenFrequencyPanel.tsx     # Node selection + controls
    TokenFrequencyResults.tsx   # Word clouds, charts, TanStack Table
    StopWordEditor.tsx          # Focused textarea + helper actions
  table/
    columns.tsx     # TanStack column defs + formatters
    useStatsTable.ts # Sorting, head/tail trimming, modal pagination
  index.ts          # Re-export entry points for incremental adoption
```

### Core data flow

1. `TokenFrequencyFeature` parent composes:
   - `useTokenFrequencyState` (wraps the new shared hooks) for state + actions.
   - Visualization components configured by props (colors, click handlers).
2. Hydration occurs inside the hook via `useAnalysisHydration`, which exposes `hydrate()` and preference persistence helpers.
3. API interactions (`tokenFrequencies`, `defaultStopWords`, `clearTokenFrequencies`) live inside `api.ts` and return typed responses (including `metadata.task_id` on async runs) so components stay declarative.
4. Concordance hand-off becomes a dedicated helper, `launchConcordanceFromToken`, exported for other features.

### TanStack Table integration

- Use `@tanstack/react-table` v8 composed with the existing shadcn table styles.
- Column definitions (`columns.tsx`) replicate the current 13 metrics but leverage built-in sorting & pagination.
- `useStatsTable` should:
  - Accept raw statistics + active stop-word filter.
  - Provide `headTailN` trimming by slicing the sorted row model before render.
  - Drive the modal via TanStack's pagination state instead of bespoke `modalPageSize` state.
- Export `TokenFrequencyStatsTable` component that renders both the trimmed inline table and the modal, sharing the same column configuration.

> **Exercise:** Sketch how `useStatsTable` would expose TanStack state.
>
> **Answer:**
>
> ```ts
> const table = useReactTable({
>   data: filteredStats,
>   columns,
>   state: { sorting, pagination },
>   onSortingChange: setSorting,
>   getCoreRowModel: getCoreRowModel(),
>   getSortedRowModel: getSortedRowModel(),
>   manualPagination: false,
> });
> return { table, sorting, setSorting, pagination, setPagination, headTailRows };
> ```

## Lesson 4 – Migration checklist

1. **Week 0 (this PR):** Create the shared hook shells + feature package scaffolding (files above) and move pure utilities (formatting, clamp helpers) into `features/analysis/common/utils.ts`.
2. **Week 1:** Port hydration + preference logic into `useTokenFrequencyState`; components still render inside the old tab by importing the new feature component.
3. **Week 2:** Replace custom stats table with TanStack Table, add tests for `useStatsTable` head/tail logic.
4. **Week 3:** Delete legacy `TokenFrequencyTab.tsx`, wire routing directly to `features/analysis/token-frequency` entry points, and update docs/screenshots.

## Hands-on practice

1. **Question:** If the backend clamps `token_limit` to 500, where should that normalization occur?
   - **Answer:** Inside `useAnalysisHydration.persistPreferences`, so every feature benefits automatically.
2. **Question:** When the user right-clicks a token, which layer should add it to the stop-word list?
   - **Answer:** The visualization component should emit an event (e.g., `onTokenStopWordAdd`), but the mutation lives inside the feature hook to keep persistence consistent.
3. **Question:** How do we keep concordance navigation feature-local?
   - **Answer:** `launchConcordanceFromToken` should accept token + selections, call the shared store setters, and then request the workspace view switch. The `TokenFrequencyResults` component simply invokes it via props.

## Conclusion

By following this walkthrough, we separate responsibilities into testable hooks, adopt TanStack Table for statistics, and keep feature-specific logic inside `features/analysis/token-frequency`. Start with the shared hooks, wire up the feature package, and migrate rendering incrementally while legacy components re-export the new slices.
