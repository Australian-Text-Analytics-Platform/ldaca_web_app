# Preprocessing Features

Preprocessing subtabs (Filter, Slice, Concat, Join, Aggregate, etc.) are migrating from `src/components/preprocessing` into feature-first slices under `src/features/preprocessing/*`. Every subtab should expose the same container → view → hooks recipe so preview engines, serializers, and UI controls remain reusable.

## Standard layout

```
src/features/preprocessing/<subtab>/
  index.ts                # Public exports consumed by DataPreprocessingFeature
  components/             # Presentational widgets (forms, preview tables, modals)
  hooks/                  # Business logic (preview orchestration, validation)
  services/               # Payload builders, schema helpers, adapters to nodes API
  utils/                  # (optional) pure helpers shared only within the subtab
```

Shared pieces—`usePreprocessingPreview`, condition-builder primitives, schema helpers, and `PreviewTable`—live directly under `src/features/preprocessing` so each subtab can import them without deep relative paths.

## Migration checklist

1. **Assess the legacy subtab**
   - [ ] List the inputs/outputs (form controls, preview payload shape, node mutations, success toasts).
   - [ ] Identify which logic chunks belong in hooks/services (preview throttling, validation, unique value fetching) versus components.
   - [ ] Sketch new folder structure before moving code.

2. **Extract shared orchestration**
   - [ ] Use `usePreprocessingPreview` for debounced preview requests, pagination, and abort handling.
   - [ ] Move payload serializers and validation helpers into `services/` or `utils/` so they can be unit tested.
   - [ ] Keep React hook APIs small: expose derived state plus imperative helpers (`runPreview`, `applyMutation`).

3. **Rebuild the UI as container + view**
   - [ ] Container wires hooks to `NodeSelectionPanel`, preview tables, and form components.
   - [ ] View components stay stateless and accept props for values/handlers. Reuse shared condition-builder pieces to avoid duplicate dropdown logic.
   - [ ] Keep CSS limited to shadcn utilities and local classNames—no inline style copies.

4. **Legacy wrapper cleanup**
   - [ ] Update `DataPreprocessingFeature` (or the importing parent) to render the new feature component instead of the legacy subtab.
   - [ ] Delete the old `src/components/preprocessing/<SubTab>.tsx` file once the feature is confirmed stable.

5. **Testing + verification**
   - [ ] Add Vitest coverage for critical serializers, validation helpers, and hooks.
   - [ ] Manually test end-to-end: node selection, preview pagination, form validation, mutation success, and error handling (network + validation errors).
   - [ ] Re-run `npm run lint` and targeted `npm run test -- preprocessing` as needed.

6. **Documentation + follow-up**
   - [ ] Document any new shared helpers in `ldaca_web_app/docs/ARCHITECTURE.md` (Preprocessing section).
   - [ ] If the subtab introduces reusable UI, promote it into `src/features/preprocessing/components` and mention it here.

By following this recipe every preprocessing surface will share the same preview harness, making it trivial to add new steps or tweak validation without touching monolithic legacy files.
