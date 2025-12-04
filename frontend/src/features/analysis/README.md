# Analysis Features

Feature slices under `src/features/analysis/*` own the modern implementations of every analysis tab (Token Frequency, Concordance, Quotation, Sequential Analysis, Topic Modeling, etc.). Each slice should follow the same **container → view → hooks/services** layering so that UI is pure, logic is testable, and legacy routes can wrap the feature without reimplementing state.

## Standard layout

```
src/features/analysis/<feature>/
  README.md                # Optional per-feature notes
  index.ts                 # Public exports for the tab/view
  components/              # Pure presentational pieces (charts, tables, forms)
  hooks/                   # React hooks encapsulating orchestration logic
  services/                # API adapters, serializers, helpers
  common/                  # (optional) share-only-within-feature utilities
```

Cross-cutting helpers (colors, hydration, lock state, etc.) belong in `src/features/analysis/common` and are already shared through the `index.ts` barrel.

## Migration checklist

Use this checklist for every legacy tab that still lives under `src/components/tabs/*`:

1. **Inventory + plan**
   - [ ] Capture the tab’s responsibilities (data fetching, node selection, SSE handling, form state, visualization widgets).
   - [ ] Decide what becomes *container* logic (mutations + providers), *view* logic (JSX + props), and *hooks/services* (state machines, serializers, API calls).
   - [ ] Pre-create the folder skeleton (`components/`, `hooks/`, `services/`, `index.ts`).

2. **Extract orchestration hooks**
   - [ ] Migrate fetch/mutation logic into dedicated hooks (e.g., `useTokenFrequencyFeature`, `useConcordanceResults`).
   - [ ] Reuse shared helpers from `features/analysis/common` (`useAnalysisHydration`, `useAnalysisLockMachine`, `useNodeColorPalette`, `useNodeColumnOptions`, etc.) instead of duplicating state.
   - [ ] Keep side-effects (SSE subscriptions, polling) inside hooks; expose clean state + callbacks to the view.

3. **Build container + view**
   - [ ] Container component wires hooks together, handles routing params, and renders the primary Feature view.
   - [ ] View components stay dumb: accept props, render UI, and delegate events back up.
   - [ ] Use shared UI primitives (`NodeSelectionPanel`, `NodeSelectionList`, shadcn components) rather than recreating bespoke widgets.

4. **Bridge legacy entry points**
   - [ ] Replace the old `components/tabs/<Tab>.tsx` implementation with a thin wrapper that lazy-loads and renders the new feature component.
   - [ ] Delete unused helper files from `src/components` once no longer referenced.

5. **Testing & docs**
   - [ ] Add/extend unit tests for extracted hooks/services (use Vitest and the React Testing Library helpers already configured).
   - [ ] Run `npm run lint` and focused `npm run test -- <feature>` to ensure the slice passes.
   - [ ] Update `ldaca_web_app/docs/ARCHITECTURE.md` with any new shared utilities or data flows introduced.

6. **Verification**
   - [ ] Manually test the tab via `npm start` (or `vite`) plus the FastAPI backend, confirming: node selection, run/cancel flows, task banners, hydration after refresh, and error states.
   - [ ] Confirm the SSE stream continues updating `analysisStore` and that lock-state persistence survives reloads.
   - [ ] Ensure bundle boundaries are respected (feature folder exports only what the tab wrapper needs).

When the entire checklist passes, the feature is considered migrated. Future work (e.g., lazy-loaded routes, shared charting utilities) can layer on top without touching legacy code again.
