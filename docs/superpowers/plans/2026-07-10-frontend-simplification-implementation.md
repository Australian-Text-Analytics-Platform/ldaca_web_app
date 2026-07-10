# Exhaustive Frontend Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement every open finding in `docs/frontend-simplification-opportunities-2026-07-08.md`, move each completed finding into `Done`, and leave a verified milestone commit history.

**Architecture:** Work from correctness-sensitive ownership seams outward: first establish canonical state/query identities, then simplify feature and app ownership, then deepen cohesive analysis modules, and finally tighten build/release/Tauri contracts. Each milestone is independently testable and updates the audit report in the same commit so the report remains the durable implementation ledger.

**Tech Stack:** React 19 with React Compiler, TypeScript 7/6 tooling, Zustand, TanStack Query/Table, React Flow, Vitest/MSW, Vite 8, pnpm, Tauri 2/Rust, Node scripts, GitHub Actions.

## Global Constraints

- Preserve the user's pre-existing staged frontend diff; its starting SHA-256 is `ea1b9386c68f363db2e3ee11a4777c777b97b5bcc0444bad7e2c5ca9a2912fad`.
- Do not manually edit generated API files. Regenerate them only when a backend/OpenAPI contract intentionally changes.
- Keep `@/api` as the handwritten API boundary and retain explicit auth only for raw `fetch`, `EventSource`, and native streaming/download paths.
- Use React Compiler-first code. Do not add routine `useMemo`, `useCallback`, or `React.memo`; preserve memoization where effects, listeners, providers, React Flow, TanStack, Recharts, or d3 require identity.
- Preserve `WorkspaceProvider` slice contexts, URL/deep-link behavior, view ID/registry/component separation, QueryProvider, analysis/tab persistence, task stream client/inbox separation, the direct node-input queue, CustomNode decomposition, nested error boundaries, runtime-config ordering, Tauri staging, native large downloads, PID reaping, `build.rs`, relative assets, and live opener/dialog/filesystem plugins.
- Every changed non-trivial unit must have accurate caller/why/flow documentation; remove placeholder comments instead of replacing them with narration.
- Each finding moves from `Open TODOs` to a dated `Done` entry only after its focused acceptance tests and milestone gates pass.
- Each milestone ends in a Git commit. Commit only milestone-owned paths; never absorb unrelated staged changes.
- Frontend milestones run focused tests, `pnpm -C frontend lint`, `pnpm -C frontend test -- --run`, `pnpm -C frontend build`, `pnpm -C frontend knip`, and `git diff --check` unless the task explicitly establishes a narrower pre-gate followed by the full milestone gate.
- Python changes run `uvx ty check` and `uv run pytest` from each affected package. Tauri milestones run decoupled Rust tests/clippy plus staged runtime/package validation appropriate to the changed contract.

---

### Task 0: Freeze the audit and execution baseline

**Findings:** report infrastructure only; no implementation finding is closed.

**Files:**
- Modify: `docs/frontend-simplification-opportunities-2026-07-08.md`
- Create: `docs/superpowers/plans/2026-07-10-frontend-simplification-implementation.md`
- Scratch only: `.superpowers/sdd/progress.md`

**Interfaces:**
- Consumes: the 55 findings `C1-C11`, `D1-D24`, `M1-M7`, and `B1-B13`.
- Produces: milestone ordering, staged-diff guard, and per-milestone acceptance contract.

- [ ] Verify all report links/anchors, exact strength labels, four required finding fields, and the immutable 31-entry historical `Done` block.
- [ ] Record the branch, HEAD, staged-path list, staged content hash, frontend baseline gates, and report checks in the scratch progress ledger.
- [ ] Run `git diff --check -- docs/frontend-simplification-opportunities-2026-07-08.md docs/superpowers/plans/2026-07-10-frontend-simplification-implementation.md`.
- [ ] Commit only the two documentation paths with `docs: plan exhaustive frontend simplification`.

### Task 1: Canonical workspace selection, table request, graph projection, and freshness

**Findings:** C1, C2, C3, C4.

**Files:**
- Modify: `frontend/src/stores/selectionStore.ts`
- Modify: `frontend/src/features/workspace/data-view/hooks/useWorkspaceDataTable.ts`
- Modify: `frontend/src/features/workspace/common/hooks/useWorkspaceGraphMutations.ts`
- Modify: `frontend/src/lib/queryKeys.ts`
- Modify: `frontend/src/features/workspace/common/hooks/useWorkspaceQueries.ts`
- Modify: `frontend/src/features/workspace/graph-view/hooks/useWorkspaceGraph.ts`
- Modify: `frontend/src/stores/freshNodesStore.ts`
- Test: colocated store/hook/graph/query-key tests under the corresponding `__tests__` directories.

**Interfaces:**
- Produces selection actions `activateNode(id)`, `reorderSelectedNodes(ids)`, `removeNode(id)`, `replaceSelectedNodes(ids, activeId)`, `toggleNode(id)`, and `clearSelection()` with independent `activeNodeId`.
- Produces a canonical node-table request parameter object whose complete value, including `filter_op`, drives both query key and SDK request.
- Produces serializable node/edge presentation signatures containing every visible projected field; volatile command context is read at invocation time.
- Produces workspace-keyed freshness state and removes unowned `forgetNodeIds`.

- [ ] Add failing tests for active/non-active deletion, reorder fallback, operator-only query-key changes, graph colour/edge-label resync, workspace-switch callback freshness, and overlapping fresh-node IDs across workspaces.
- [ ] Implement the semantic selection actions and delete table-local tab-order reconciliation.
- [ ] Introduce the canonical table request projection and remove table query state from the selection slice and quotation fallback path.
- [ ] Make React Flow signatures derive from the rendered serializable projection and remove duplicate empty-selection reconciliation without changing identity-sensitive drag/selection behavior.
- [ ] Scope fresh-node baselines by workspace and delete the zero-caller action.
- [ ] Run focused tests, full frontend milestone gates, update developer-guide state-flow docs where ownership changed, move C1-C4 to `Done`, and commit `refactor(frontend): canonicalize workspace interaction state`.

### Task 2: Scope analysis tasks/results and preprocessing previews

**Findings:** C5, C6, C7, D24.

**Files:**
- Modify: `frontend/src/features/views/common/useAnalysisTaskStatus.ts`
- Modify: `frontend/src/features/views/common/tasks/useAnalysisTaskFlow.ts`
- Modify: `frontend/src/features/views/common/useSafeResult.ts`
- Modify: preprocessing preview hooks under `frontend/src/features/views/preprocessing/**`
- Modify: `frontend/src/features/views/common/components/NodeInputsPanel.tsx`
- Move shared helpers currently imported from preprocessing by topic-modeling/sequential code into a neutral common owner.

**Interfaces:**
- Corrected contract: `useAnalysisTaskStatus` consumes
  `{ taskTypes, workspaceId, taskIds }` and never treats task type as unique
  identity. The backend task store has no tab id; tab ownership is represented
  by the actual task ids persisted by the owning tab. An explicitly empty
  `taskIds` list must not fall back to another same-type task, while non-tab
  flows may omit `taskIds` and remain scoped by workspace and type.
- `useSafeResult<T>` exposes one `Dispatch<SetStateAction<T | null>>`-compatible setter plus synchronized ref; no raw state setter escapes.
- Preview request signatures contain workspace and every request-shaping field; fetchers consume request data and `AbortSignal`, not closed-over workspace state.
- Node-input limits are supplied by the active feature: join `2`, concat `6`; no generic cap `12` overrides them.

- [ ] Add failing tests for same-task-type cross-tab/workspace isolation, functional safe-result updates, stale completion, workspace-switch preview cancellation, and 2/6 input caps.
- [ ] Implement scoped status resolution and migrate all analysis callers.
- [ ] Replace the raw safe-result setter and migrate callers that currently bypass ref synchronization.
- [ ] Derive preview signatures/fetchers from full request data and propagate cancellation through SDK options.
- [ ] Move truly cross-feature helpers to neutral ownership and apply exact active-feature caps.
- [ ] Run focused/full gates, update analysis/preprocessing developer docs, move C5-C7 and D24 to `Done`, and commit `refactor(frontend): scope analysis and preprocessing sessions`.

### Task 3: Make Data Loader tasks, cache mutations, and dialogs single-owner

**Findings:** C8, D8, D23.

**Files:**
- Modify: `frontend/src/features/views/data-loader/DataLoaderFeature.tsx`
- Modify: `frontend/src/features/views/data-loader/hooks/usePendingWorkspaceDownloads.ts`
- Modify: `frontend/src/features/views/data-loader/hooks/useFiles.ts`
- Modify: Data Loader dialog/panel hooks and components.
- Delete: `frontend/src/components/dialogs/DataFolderDialog.tsx` and shell-only test.

**Interfaces:**
- A shell/workspace-level pending-download coordinator owns `{ taskId, workspaceId, artifactName, status }` through completion and exposes commands/views to Data Loader.
- File mutations use one cache policy: mutation-owned invalidation/refetch; manual refresh remains explicit.
- A file-preview dialog has one dialog owner and one focus/cancel lifecycle.

- [ ] Add failing tests for completion after navigation, one save/toast, mutation refresh count, nested-dialog removal, and missing-workspace routing.
- [ ] Lift pending downloads above feature unmount and remove local completion ownership.
- [ ] Consolidate mutation cache policy and delete `refetchFiles` prop threading.
- [ ] Remove orphan/nested dialog shells, unreachable alert state, and unused facade props.
- [ ] Run focused/full gates, update Data Loader docs, move C8/D8/D23 to `Done`, and commit `refactor(frontend): simplify data loader ownership`.

### Task 4: Establish one app owner for auth, navigation, status, preferences, and global hosts

**Findings:** D1, D2, D3, D4, D5, D6, D7.

**Files:**
- Modify: `frontend/src/api/generatedClientConfig.ts`, handwritten auth provider/store/hooks, and generated-SDK call sites.
- Modify: `frontend/src/App.tsx`, `frontend/src/index.tsx`, `frontend/src/components/layout/WorkspaceShell.tsx`.
- Modify: `frontend/src/stores/uiStore.ts`, `frontend/src/stores/preferencesStore.ts`, `frontend/src/hooks/usePreferences.ts`.
- Modify: compact/resizable panel hooks and consumers.
- Modify: workspace operation status/lifecycle owners.

**Interfaces:**
- `AuthBootstrap` is mounted once and generated SDK auth is supplied by a dependency-light header/token provider.
- Navigation derives visible views from preferences plus registry; UI store retains active view only.
- Preferences expose one durable projection/normalizer/equality boundary shared by persistence and transport.
- Global feedback, docs banner, and toaster each mount once.

- [ ] Add tests proving ordinary SDK calls receive generated config auth without manual headers and auth lifecycle starts once.
- [ ] Derive visible views and remove mirrored visibility actions/effects.
- [ ] Delete workspace error maps with no reader while preserving mutation feedback/loading cleanup.
- [ ] Implement the canonical preference codec/projection/equality path.
- [ ] Remove collapsed/last-ratio residue and dead UI-store methods/actions after caller proof.
- [ ] Consolidate global hosts and update ownership comments/docs.
- [ ] Run focused/full gates, move D1-D7 to `Done`, and commit `refactor(frontend): consolidate app state ownership`.

### Task 5: Consolidate documentation and hint contracts

**Findings:** D9, D10 and bundled-doc/external-link confirmation work related to them.

**Files:**
- Modify/delete: tutorial/info/reference registry shims and `frontend/src/tutorials/registryStore.ts`.
- Modify: document target/type/modal/view owners.
- Modify: `frontend/scripts/check-docs-drift.mjs` and its tests.
- Modify: hints store/controller/registry/conditions/bubble/highlight components.

**Interfaces:**
- One documentation contract owns target type/kind/path and one accessor owns bundled/remote lookup.
- Docs drift validation checks target files, anchors, relative links, and workflow triggers, not only literal keys.
- One hints store persists only durable dismissal state; one measurement owner installs shared observers/listeners; retained policy fields must affect behavior.

- [ ] Add failing docs-drift tests for missing files/anchors/relative links and failing hint tests for duplicate measurement/listener ownership.
- [ ] Collapse registry shims/types, delete impossible warning/dead status paths, and classify 25 zero-literal bundled entries by actual dynamic/offline contract before pruning.
- [ ] Consolidate hint durable/transient state and DOM measurement; remove unused priority/oneShot/action policy.
- [ ] Run focused/full gates and docs-drift check, move D9-D10 plus resolved documentation confirmation notes to `Done`, and commit `refactor(frontend): consolidate docs and hint contracts`.

### Task 6: Remove compatibility types, wrappers, hidden exports, and dead internal surfaces

**Findings:** D11, D12, D13, D14, D15, D16, D17, D18, B6.

**Files:**
- Modify/move: workspace node/document/schema metadata helpers and re-export ladders.
- Modify: sidebar types/list/section owners.
- Modify: `frontend/knip.json`, `frontend/src/components/ui/**`, `frontend/package.json`, `pnpm-lock.yaml`.
- Delete/inline: four shallow detach-dialog wrappers, topic type mirrors, Concordance read-only props, verified zero-caller helpers, and narrow return/export surfaces.

**Interfaces:**
- Generated `WorkspaceNodeInfo` is the canonical transport identity; a neutral workspace metadata module owns document/schema projections.
- Topic result shapes use generated types or explicit `Pick<>` view types; no mirrored transport interface.
- Feature owners render `DetachColumnsDialog` directly with domain labels/options.
- Configured Knip runs without the blanket UI ignore; only imported UI primitives are exported.

- [ ] Write/adjust behavior tests before deleting wrappers/helpers; replace helper-only tests with rendered owner tests where appropriate.
- [ ] Consolidate node metadata and sidebar contracts, removing legacy/fallback shapes.
- [ ] Inline/delete shallow detach wrappers, topic mirrors, impossible read-only branches, and verified zero-callers.
- [ ] Remove the UI Knip exclusion, prune unused export modifiers, confirm clean-install PostCSS ownership, and remove the direct dependency only if the toolchain proves it unnecessary.
- [ ] Sweep narrow return fields/exports one owner at a time with caller proof; retain deliberate pure-model test seams.
- [ ] Run focused/full gates, move D11-D18/B6 to `Done`, and commit `refactor(frontend): remove compatibility and dead surfaces`.

### Task 7: Break the route cycle and remove compiler-safe structural residue

**Findings:** D19, D20, D21, D22.

**Files:**
- Modify: `frontend/src/router.tsx`, `frontend/src/components/layout/ViewRouteSync.tsx`, route-search contract modules/tests.
- Modify: placeholder-comment files identified by the structured audit.
- Modify: `ChromeTabs.tsx`, split/resize hooks, and `frontend/src/features/views/common/index.ts` consumers.

**Interfaces:**
- A pure typed route-search contract is dependency-light; URL sync retains deep links, history, pending workspace, and repair semantics.
- Manual memoization remains only where identity is a correctness/third-party contract.
- Internal feature code imports direct owning modules instead of a broad common barrel.

- [ ] Add route tests for cold deep links, invalid/pending workspace, replace/push, and back/forward before moving imports.
- [ ] Extract the dependency-light search contract and prove the cycle is gone.
- [ ] Run the structured comment/caller audit and replace/remove every named placeholder with verified ownership notes.
- [ ] Remove only high-confidence local memo/callback wrappers; retain and document identity-sensitive ones.
- [ ] Replace broad common-barrel imports with direct imports and run the cycle/export scans.
- [ ] Run full gates, move D19-D22 to `Done`, and commit `refactor(frontend): simplify routing and local boundaries`.

### Task 8: Deepen Annotation and Sequential domain modules

**Findings:** M1, M2.

**Files:**
- Modify/split: `AnnotationAiPreviewPanel.tsx` and adjacent query/session owners.
- Modify: Sequential result-summary/chart-control/chart-model files and tests.

**Interfaces:**
- `useAnnotationAiPreviewSession` owns session identity, hydration, signatures, overrides, queries, mutation commands, detach/cache lifecycle, and stale completion; the panel renders returned domain state/commands.
- `buildSequentialChartModel(input)` is pure and returns render-ready series, labels, selection metadata, and explicit empty/error state; hooks retain task/query ownership.

- [ ] Characterize current annotation session/refetch semantics and Sequential chart outputs with failing extraction tests.
- [ ] Extract the deep annotation session and shared node-page/class-description queries without adding pass-through wrappers.
- [ ] Move pure Sequential shaping into the chart model and simplify hooks/renderers.
- [ ] Run focused/full gates, update analysis developer docs, move M1-M2 to `Done`, and commit `refactor(frontend): deepen annotation and sequential domains`.

### Task 9: Canonicalize Quotation/Concordance domains and analysis host contracts

**Findings:** M3, M4, M5.

**Files:**
- Modify: quotation results/highlight/cell/materialization model files and renderers.
- Split: Concordance results session and view-model domains.
- Modify: `AnalysisTabsHost.tsx` and six analysis feature interfaces/callers.

**Interfaces:**
- One typed quotation row/span model owns payload normalization; pure segmentation, palette, and materialization helpers feed distinct table/detail adapters.
- Concordance exposes a deep results-session hook/context plus cohesive combined/table, dispersion, and source/materialization pure modules; it does not replace prop lists with an opaque bag.
- Analysis host captures workspace/tab commands in closures and passes a canonical minimal feature contract.

- [ ] Add characterization tests for quotation Unicode/overlapping spans/palette/materialization and Concordance combined/dispersion/session behavior.
- [ ] Normalize quotation payloads once and delete renderer fallback parsing.
- [ ] Extract Concordance session ownership and split the 803-line model by domain, sharing only real node-shell/model/scroll behavior.
- [ ] Consolidate six feature host interfaces and remove optional tab-ID guards.
- [ ] Run focused/full gates, update analysis docs, move M3-M5 to `Done`, and commit `refactor(frontend): canonicalize analysis result domains`.

### Task 10: Make optional and user-triggered bundles genuinely optional

**Findings:** B1, B2, B3, B13 plus source-map/minifier policy confirmations.

**Files:**
- Modify: `frontend/src/lib/loadMergedStopwords.ts` and token-frequency loading UX/tests.
- Modify: Sentry boundary, auth provider composition, Settings import/open owner.
- Modify: `frontend/vite.config.ts`, packaging copy scripts/workflows, dependency manifests as proven by comparison.

**Interfaces:**
- Stopword implementation loads through `import("stopword")` only after the user action; language metadata needed for rendering stays eager and small.
- Optional Sentry is accessed only through one adapter and loaded only when configured; Google provider mounts only for Google auth; Settings is a lazy dialog boundary.
- Distributable builds either omit source maps or upload hidden maps and exclude them from backend/Tauri artifacts. This plan selects omission unless an existing release integration proves upload is required.

- [ ] Add lazy-loading/provider tests and capture baseline chunk/map/CSS artifacts.
- [ ] Implement dynamic stopword loading and real loading/error behavior.
- [ ] Localize optional Sentry/Google/Settings ownership without weakening pre-root/render error handling.
- [ ] Disable distributable public maps and inspect backend/Tauri package contents.
- [ ] Compare Lightning CSS and esbuild outputs/representative visuals; remove the explicit override/direct esbuild only if equivalence is proven.
- [ ] Run full gates and artifact inspection, move B1-B3/B13 and resolved policy notes to `Done`, and commit `perf(frontend): defer optional frontend bundles`.

### Task 11: Make frontend maintenance gates executable and generator-resistant

**Findings:** B4, B5, B7, B8, B9, B10.

**Files:**
- Delete: private frontend npm CLI/publication files/docs and package metadata.
- Modify: 14 generated-SDK-mocking tests to use `@/api` and MSW.
- Modify: frontend/root package scripts, ESLint/TypeScript tooling config, PR/release workflows, developer guides.
- Modify/create: shared release version registry and script tests.
- Mechanically format the 49-file baseline in an isolated formatting commit within this milestone sequence if required for reviewability.

**Interfaces:**
- `pnpm -C frontend check` is the single non-mutating frontend gate and CI invokes it.
- Vite/OpenAPI configs belong to a Node/tooling TS+ESLint project.
- One version target registry drives bump/check; verification covers Cargo.lock and expected release tag.

- [ ] Replace generated module mocks with the real `@/api` client plus request-level MSW; verify regenerated SDK filenames do not affect tests.
- [ ] Remove private npm publication/CLI residue while retaining workspace name/version.
- [ ] Add the aggregate check and PR CI contract; include config lint/type coverage.
- [ ] Resolve the format baseline in a dedicated mechanical commit boundary, then make format part of the executable contract if it remains non-mutating.
- [ ] Consolidate version targets and add lock/tag mismatch fixtures.
- [ ] Run clean install where dependencies changed, full frontend gates, docs/version checks, move B4/B5/B7-B10 to `Done`, and commit the functional milestone(s) with the format-only commit kept separate.

### Task 12: Align desktop development, workflow, and runtime preparation

**Findings:** C9, C10 maintenance linkage, B11, B12 and external `.env` compatibility confirmation.

**Files:**
- Modify: `frontend/src-tauri/tauri.conf.json`, capabilities, Cargo manifest/lock, Rust assembly call sites.
- Modify: desktop/release workflows and shared runtime-preparation scripts.
- Modify: desktop/config developer docs.

**Interfaces:**
- Tauri invokes one pnpm dev command and waits on the same strict port Vite exposes.
- One repository command owns Python 3.14t runtime preparation; workflows retain platform setup and validation.
- Capabilities/dependencies expose only live opener/dialog/filesystem/native commands; dead HTTP/global/window-webview/port/input surfaces are absent.

- [ ] Add config/script tests for port and runtime-preparation contracts.
- [ ] Align dev command/port and remove npm drift.
- [ ] Consolidate runtime preparation across package scripts and macOS/Windows workflows.
- [ ] Delete verified retired workflow/Tauri surfaces and stale docs; preserve live capabilities.
- [ ] Search external/repository producers of `.env`/`.env.desktop`; remove runtime loading and `dotenvy` only when the search plus package contract proves no supported consumer.
- [ ] Run frontend gates, workflow/config checks, decoupled Rust checks, move C9/C10 linkage/B11/B12 to `Done`, and commit `build(desktop): align runtime preparation contracts`.

### Task 13: Resolve packaged runtime layout and split the Tauri shell

**Findings:** C11, M6, M7.

**Files:**
- Modify: `scripts/package_backend_runtime.py`, `frontend/scripts/stage-backend-runtime.mjs`.
- Split: `frontend/src-tauri/src/main.rs` into `runtime`, `backend_process`, `platform`, and `download` modules with a thin assembly entrypoint/library.
- Modify: desktop workflows/tests and Tauri build-resource gating.

**Interfaces:**
- A relative runtime manifest is the selected authoritative layout contract: interpreter, Python home, and site-packages resolve once relative to the staged resource root and are consumed by launcher plus validation.
- `BackendProcess` owns a child directly behind one Tauri-managed mutex; shutdown is idempotent and returns `Result`, with no production `unwrap`.
- Core Rust unit tests compile without the generated `backend-runtime`; actual packaging still requires/stages it.

- [ ] Add Rust/Node/Python contract tests for relative layout, relocation, corrupt/missing manifest, process double-close, timeout, tree termination, and native download.
- [ ] Make packager/stager emit one relative manifest and delete absolute rewrites/repeated runtime scans.
- [ ] Extract cohesive Rust modules and simplify child/mutex/error ownership, preserving platform fallbacks until covered.
- [ ] Decouple unit test/clippy configuration from generated resources while retaining the packaging gate.
- [ ] Validate a relocated staged bundle on available platforms and make CI execute the production resolver/environment.
- [ ] Run affected Python type/tests, Node/frontend gates, Rust fmt/test/clippy, staged runtime/package smoke, move C11/M6/M7 to `Done`, and commit `refactor(desktop): resolve and modularize runtime layout`.

### Task 14: Prove complete implementation

**Findings:** all remaining open IDs and all `Worth Confirming` decisions.

**Files:**
- Modify: audit report only if the completion audit finds stale/open wording.
- Scratch: progress ledger and review packages.

**Interfaces:**
- Produces an empty `Open TODOs` finding set, a complete dated `Done` ledger for all 55 findings, and a reviewed commit range.

- [ ] Re-read every original finding and map it to code, tests, docs, commit, and a dated `Done` entry; treat missing/indirect evidence as incomplete.
- [ ] Run configured and no-UI-exclusion Knip, import-cycle scan, clone/export/dependency checks, docs-drift, version/tag/lock fixtures, format, lint, all frontend tests, production build, and `git diff --check`.
- [ ] Run affected backend/Python gates and the now-decoupled Rust fmt/test/clippy plus staged runtime validation.
- [ ] Verify the user's pre-existing staged work remains present and was not accidentally absorbed into milestone commits.
- [ ] Dispatch a whole-branch review, fix every Critical/Important result, re-run covering tests, and repeat review until clean.
- [ ] Commit final report/verification corrections as `docs: complete frontend simplification audit` and use the finishing-development-branch workflow.
