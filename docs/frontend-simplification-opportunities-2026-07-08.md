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

#### C9. Use one Tauri development command and port contract

- **Evidence / strength — Strong:** [tauri.conf.json](../frontend/src-tauri/tauri.conf.json#L6-L9) invokes npm and waits on port 3001, while [vite.config.ts](../frontend/vite.config.ts#L44-L51), [.env.example](../frontend/.env.example#L8-L12), and repository scripts use port 3000 and pnpm.
- **Recommended direction:** make Tauri call the repository's pnpm-owned dev command and derive the dev URL from the same port contract.
- **Deletion test:** the independent npm/3001 path disappears without adding another port adapter.
- **Validation:** clean `pnpm desktop:dev` startup, default and custom ports, readiness waiting, and desktop-to-backend connectivity.

#### C10. Make release version checks cover lock and tag identity

- **Evidence / strength — Strong:** [bump-version.mjs](../scripts/bump-version.mjs#L28-L93) and [check-versions.mjs](../scripts/check-versions.mjs#L18-L46) duplicate target registries; the current five-source 0.6.0 check misses `Cargo.lock`, and [release.yml](../.github/workflows/release.yml#L32-L48) does not prove the tag matches the stamped version.
- **Recommended direction:** share one version target registry and validate `Cargo.lock` plus expected release tag/version equality.
- **Deletion test:** one duplicated target list is removed and a stale lock or mismatched tag fails before desktop jobs.
- **Validation:** fixtures for source drift, lock drift, `vX.Y.Z` mismatch, manual dispatch, prerelease handling, and the normal bump path.

#### C11. Validate packaged Python exactly as production resolves it

- **Evidence / strength — Strong:** [package_backend_runtime.py](../scripts/package_backend_runtime.py#L236-L259), [stage-backend-runtime.mjs](../frontend/scripts/stage-backend-runtime.mjs#L67-L109), and [main.rs](../frontend/src-tauri/src/main.rs#L366-L637) disagree about the runtime path contract; staging describes a relative `pyvenv.cfg` home but writes an absolute staging path, while desktop workflows execute different interpreter paths.
- **Recommended direction:** validate the same resolved interpreter, `PYTHONHOME`, `PYTHONPATH`, and environment that production launches, from a relocated bundle rather than the source staging tree.
- **Deletion test:** CI-specific interpreter guesses and the absolute-path rewrite are replaced by one consumed runtime-layout contract.
- **Validation:** relocate a staged bundle on macOS/Windows, launch health and representative imports, verify no checkout paths leak, and compare CI resolution to Rust launch resolution.

### Deletion and simplification

#### D11. Consolidate canonical workspace-node and document/schema metadata

- **Evidence / strength — Strong:** workspace helpers still include legacy node types, re-export ladders, duplicated document/schema utilities, and test-only builders after generated `WorkspaceNodeInfo` became canonical; examples include [selectionUtils.ts](../frontend/src/features/workspace/common/utils/selectionUtils.ts), [nodeMetadata.ts](../frontend/src/features/views/preprocessing/utils/nodeMetadata.ts), and [schemaMutations.ts](../frontend/src/features/workspace/data-view/services/schemaMutations.ts).
- **Recommended direction:** project generated node metadata once at the handwritten boundary and keep only feature-specific derived helpers.
- **Deletion test:** legacy aliases, duplicate document/schema resolvers, and builders with no behavioral test purpose disappear.
- **Validation:** graph/list/table identities, document-column selection, schema mutation, preprocessing inputs, and persisted analysis inputs.

#### D12. Replace topic-modeling type mirrors with generated types

- **Evidence / strength — Strong:** [topicModelingAdapters.ts](../frontend/src/features/views/topic-modeling/topicModelingAdapters.ts) and feature hooks mirror generated request/result shapes, increasing adapter surface without a distinct domain invariant.
- **Recommended direction:** use generated types at the transport boundary and retain only genuinely transformed chart/view models.
- **Deletion test:** a field addition no longer requires matching handwritten transport interfaces and pass-through adapters.
- **Validation:** run/hydrate/clear, legacy persisted-result rejection, chart shaping, detach, and generated-client regeneration.

#### D13. Remove sidebar compatibility props and graph-node fallback shapes

- **Evidence / strength — Strong:** sidebar components still accept compatibility props with no live variation, and graph consumers retain fallback shapes after the canonical `id` migration; [Sidebar.tsx](../frontend/src/components/layout/Sidebar.tsx) and [useWorkspaceGraph.ts](../frontend/src/features/workspace/graph-view/hooks/useWorkspaceGraph.ts) are the central seams.
- **Recommended direction:** make the live shape required and delete fallback-only branches rather than carrying another adapter.
- **Deletion test:** removing the compatibility props/fallback objects changes no production call site and leaves one node identity shape.
- **Validation:** desktop/mobile sidebar, graph selection/actions, fresh highlights, node rename/settings, and persisted workspaces.

#### D14. Remove the Knip UI blind spot and prune hidden exports

- **Evidence / strength — Strong:** [knip.json](../frontend/knip.json#L9-L15) ignores all `src/components/ui/**`, masking unused modifiers/exports even after the first sidebar primitive cleanup.
- **Recommended direction:** remove or narrow the exclusion and export only primitives/modifiers used by handwritten production code or deliberate test seams.
- **Deletion test:** configured Knip passes without a blanket UI ignore and no barrel keeps unused UI exports alive.
- **Validation:** Knip, lint, tests, build, and visual smoke of every changed shared primitive.

#### D15. Replace four shallow detach-dialog wrappers with the shared dialog

- **Evidence / strength — Strong:** [QuotationDetachDialog.tsx](../frontend/src/features/views/quotation/components/QuotationDetachDialog.tsx), [TopicModelingDetachDialog.tsx](../frontend/src/features/views/topic-modeling/components/results/TopicModelingDetachDialog.tsx), [ConcordanceDetachDialog.tsx](../frontend/src/features/views/concordance/components/ConcordanceDetachDialog.tsx), and [ConcordanceDispersionDetachDialog.tsx](../frontend/src/features/views/concordance/components/ConcordanceDispersionDetachDialog.tsx) mostly forward props to the same shared dialog.
- **Recommended direction:** have feature owners call the shared dialog with feature-specific labels/options; retain a wrapper only where it owns real transformation.
- **Deletion test:** four files disappear or shrink to actual domain logic, with no new generic abstraction.
- **Validation:** open/close, default options, submit payloads, pending/errors, table and dispersion variants, and keyboard focus.

#### D16. Delete impossible Concordance read-only branches

- **Evidence / strength — Strong:** [ConcordanceFeature.tsx](../frontend/src/features/views/concordance/ConcordanceFeature.tsx) hardcodes false/undefined values into read-only branches threaded through [ConcordanceResultsPanel.tsx](../frontend/src/features/views/concordance/components/ConcordanceResultsPanel.tsx).
- **Recommended direction:** remove the unsupported mode and its props unless a product requirement first supplies a real caller.
- **Deletion test:** false/undefined prop plumbing and unreachable render branches vanish.
- **Validation:** combined and dispersion results, row detail, materialization, detach, source navigation, and empty/error states.

#### D17. Remove verified zero-caller helpers, not deliberate test seams

- **Evidence / strength — Strong:** confirmed candidates include [minTopicSize.ts](../frontend/src/features/views/topic-modeling/components/panels/minTopicSize.ts), recent-selection clear in [recentSelectionsStore.ts](../frontend/src/stores/recentSelectionsStore.ts), the unused return from [useZoom.ts](../frontend/src/hooks/useZoom.ts), tokenizer-order helpers, tutorial status fields, and compact/schema props.
- **Recommended direction:** delete each implementation with its now-orphaned test/export; keep seams whose tests protect a supported contract even if production has no direct caller.
- **Deletion test:** `rg`, dependency/export scans, and Knip show zero callers before deletion, and no replacement compatibility layer is added.
- **Validation:** focused owner tests plus configured Knip, lint, full frontend tests, and build in the implementation change.

#### D18. Sweep narrow internal return fields, actions, and exports

- **Evidence / strength — Strong:** hooks still expose raw query objects, dead task-flow outputs/actions, unused schema aliases/base-hook exports, and hydration/request helpers not consumed by production. Representative owners include [useWorkspaceQueries.ts](../frontend/src/features/workspace/common/hooks/useWorkspaceQueries.ts), [useAnalysisTaskFlow.ts](../frontend/src/features/views/common/tasks/useAnalysisTaskFlow.ts), and [useAnalysisHydration.ts](../frontend/src/features/views/common/useAnalysisHydration.ts).
- **Recommended direction:** return only the stable behavior each caller uses; remove one item at a time with call-site proof.
- **Deletion test:** each removed field/export has zero consumers and deleting it shortens both owner and adapter code.
- **Validation:** affected focused tests, typecheck/build, Knip without broad ignores, and persisted hydration scenarios.

#### D19. Break the route import cycle without removing URL behavior

- **Evidence / strength — Strong:** the cycle is [router.tsx](../frontend/src/router.tsx) → [App.tsx](../frontend/src/App.tsx) → [WorkspaceShell.tsx](../frontend/src/components/layout/WorkspaceShell.tsx) → [ViewRouteSync.tsx](../frontend/src/components/layout/ViewRouteSync.tsx) → `router.tsx`.
- **Recommended direction:** extract typed/pure search contracts or narrow router hooks; keep deep links, back/forward behavior, and pending-workspace synchronization intact.
- **Deletion test:** cycle detection no longer reports the chain and no second navigation state machine is introduced.
- **Validation:** cold deep links, invalid workspace/view, pending workspace load, replace vs push, back/forward, hidden views, and auth transitions.

#### D20. Replace stale boilerplate comments with verified ownership notes

- **Evidence / strength — Strong:** handwritten files still contain repeated placeholders such as `typed store boundary` in [selectionStore.ts](../frontend/src/stores/selectionStore.ts#L53-L99), `(rg call sites/imports)` in [HintsController.tsx](../frontend/src/features/hints/HintsController.tsx#L95), `internal event/effect/helper flow`, `parent component boundary`, and route boilerplate, alongside stale caller claims.
- **Recommended direction:** treat this as targeted regression cleanup: update the nearest changed unit with verified caller/why/flow context and remove only placeholder narration.
- **Deletion test:** placeholder patterns reach zero without reducing useful lifecycle, side-effect, or identity documentation.
- **Validation:** structured comment audit plus targeted `rg`; spot-check named callers against imports/tests before claiming coverage.

#### D21. Remove memo/callback residue only in local identity-insensitive code

- **Evidence / strength — Worth exploring:** local helpers such as [ChromeTabs.tsx](../frontend/src/components/tabs/ChromeTabs.tsx), [useResizableSplit.ts](../frontend/src/hooks/useResizableSplit.ts), and [useStackedSplits.ts](../frontend/src/components/layout/sidebar/useStackedSplits.ts) contain candidates the React Compiler can own, but other memoization is identity-sensitive.
- **Recommended direction:** make narrow removals after confirming no effect dependency, library contract, or expensive-model identity requirement; explicitly reject a blanket sweep.
- **Deletion test:** removed wrappers reduce code without increasing effects, listener churn, or third-party reconciliation.
- **Validation:** render-count/effect-focused tests where relevant, drag/reorder/resize smoke, full tests, and build.

#### D22. Narrow over-broad internal barrels

- **Evidence / strength — Strong:** [features/views/common/index.ts](../frontend/src/features/views/common/index.ts) exports unrelated feature helpers through one wide surface and can hide ownership/cycles.
- **Recommended direction:** prefer direct imports for internal feature code while retaining the deliberate public API barrel and meaningful feature seams.
- **Deletion test:** the common barrel exports only a coherent contract or is no longer used internally, with fewer cycle/unused-export edges.
- **Validation:** import-cycle scan, Knip, typecheck/build, and no change to generated/API barrel ownership.

### Deep modularity opportunities

#### M1. Extract an Annotation AI preview-session boundary

- **Evidence / strength — Strong:** [AnnotationAiPreviewPanel.tsx](../frontend/src/features/views/annotation/components/AnnotationAiPreviewPanel.tsx) owns query/session hydration, signatures, overrides, annotation, detach/cache/dialog/table behavior, while repeated node-page and class-description queries span adjacent annotation owners.
- **Recommended direction:** introduce a deep `useAnnotationAiPreviewSession`-style recommendation that owns the lifecycle and exposes domain commands/state; share repeated queries without changing signatures or refetch semantics.
- **Deletion test:** the panel becomes rendering/composition, and moving the hook back would reintroduce substantial cohesive lifecycle logic rather than a cosmetic wrapper.
- **Validation:** hydrate/new session, signature change, override, annotate-all, detach, cache refresh, pagination, cancellation, and stale task completion.

#### M2. Move Sequential result shaping into the chart model

- **Evidence / strength — Strong:** [useSequentialResultSummary.ts](../frontend/src/features/views/sequential-analysis/hooks/useSequentialResultSummary.ts), [useSequentialChartControls.ts](../frontend/src/features/views/sequential-analysis/hooks/useSequentialChartControls.ts), and [SequentialChart.tsx](../frontend/src/features/views/sequential-analysis/components/SequentialChart.tsx) split substantial pure result shaping across async hooks and rendering.
- **Recommended direction:** extend the existing pure chart-model domain to accept result inputs and return render-ready series/labels/selection metadata; hooks retain async/task ownership.
- **Deletion test:** hooks stop rebuilding chart-domain structures and the pure model can be tested without React.
- **Validation:** empty/single/multi-series, selection, normalization, tooltip/legend, export, resize, and malformed/partial result handling.

#### M3. Normalize quotation rows and highlights once

- **Evidence / strength — Strong:** [quotationResultsModel.ts](../frontend/src/features/views/quotation/quotationResultsModel.ts), [quotationHighlight.ts](../frontend/src/features/views/quotation/quotationHighlight.ts), [quotationCellText.ts](../frontend/src/features/views/quotation/quotationCellText.ts), and renderer helpers repeat row/highlight/materialization parsing.
- **Recommended direction:** define one typed row/span model with shared pure segmentation, palette, and materialization parsers; keep table/detail/render adapters distinct.
- **Deletion test:** source payload interpretation occurs once and renderers no longer carry fallback parsing.
- **Validation:** nested/overlapping spans, Unicode, empty text, palette stability, row detail, remote URLs, materialization, and export.

#### M4. Create a Concordance results-session owner and split domains

- **Evidence / strength — Strong:** [ConcordanceFeature.tsx](../frontend/src/features/views/concordance/ConcordanceFeature.tsx), [ConcordanceResultsPanel.tsx](../frontend/src/features/views/concordance/components/ConcordanceResultsPanel.tsx), and [useConcordanceResultViewModel.ts](../frontend/src/features/views/concordance/hooks/useConcordanceResultViewModel.ts) carry roughly 61-, 29-, and 47-prop handoffs around an 803-line view-model domain.
- **Recommended direction:** own query/result/session commands at a deep context/hook boundary, then split pure combined/table, dispersion, and source/materialization domains; factor only genuinely shared node-shell/model/scroll behavior.
- **Deletion test:** prop count falls because ownership moved, not because props were packed into an opaque bag, and each extracted module has cohesive tests.
- **Validation:** combined/dispersion switch, tokenizer mode, paging, selection, scroll sync, row detail, materialization, detach, pending handoff, and stale results.

#### M5. Let the analysis host own the canonical feature contract

- **Evidence / strength — Strong:** six analysis feature components repeat near-identical prop interfaces and optional tab-ID callback guards around [AnalysisTabsHost.tsx](../frontend/src/features/views/common/tabs/AnalysisTabsHost.tsx).
- **Recommended direction:** capture workspace/tab commands in the host closure and pass each feature a small canonical host contract plus its domain-specific inputs.
- **Deletion test:** repeated feature interfaces and optional callback guards disappear without a new mega-prop object.
- **Validation:** single/multi-tab modes, tab create/close/reorder, persisted IDs, feature switching, task banners, and disabled optional actions.

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

#### B1. Load stopwords only after the user asks for them

- **Evidence / strength — Strong:** the static stopword package contributes 65 modules and about 208k source characters to a roughly 224.76 kB chunk even though the feature is user-triggered; [loadMergedStopwords.ts](../frontend/src/lib/loadMergedStopwords.ts) is already the natural async boundary.
- **Recommended direction:** complete that boundary with a dynamic import and keep compact language metadata separate if it is needed eagerly.
- **Deletion test:** the stopword implementation leaves the initial graph and appears in a lazy chunk without duplicating language data.
- **Validation:** first/subsequent loads, multiple languages, missing language, offline desktop, recommendation flows, build chunk inspection, and loading/error UX.

#### B2. Choose an explicit distributable source-map policy

- **Evidence / strength — Strong:** the production output contains 67 maps totaling about 15 MiB versus about 11.7 MiB non-map output (about 56.2% of the build), and [vite.config.ts](../frontend/vite.config.ts) emits maps that packaging copies into backend resources without an upload step.
- **Recommended direction:** decide among disabled maps or hidden maps uploaded to the error service and excluded from packages; this is a release/security policy, not dead-code deletion.
- **Deletion test:** distributable artifacts contain only policy-approved maps and no unused map-copy weight.
- **Validation:** browser and Tauri stack traces, Sentry symbolication if chosen, backend package contents, desktop installers, and release size.

#### B3. Localize optional Sentry, Google, and Settings ownership

- **Evidence / strength — Worth exploring:** [sentry.ts](../frontend/src/lib/sentry.ts), [ErrorBoundary.tsx](../frontend/src/components/ErrorBoundary.tsx), and [index.tsx](../frontend/src/index.tsx#L6-L54) leave about 24 Sentry modules in the entry despite optional DSN and mount Google globally; [SettingsDialog.tsx](../frontend/src/components/dialogs/SettingsDialog.tsx) is another candidate lazy boundary.
- **Recommended direction:** explore an optional Sentry boundary, localize Google provider to Google auth, and lazy-load Settings without making error capture or login timing fragile.
- **Deletion test:** optional provider code leaves the main entry when disabled and no duplicate providers/configuration appear.
- **Validation:** DSN on/off, pre-root and render errors, Google-only/CILogon-only/no-auth deployments, redirect callback, first Settings open, and chunk failure.

#### B4. Remove private npm publication and CLI residue

- **Evidence / strength — Strong:** [package.json](../frontend/package.json#L6-L31) still has `bin`, `files`, and `prepublishOnly`; [bin/cli.js](../frontend/bin/cli.js), [.npmignore](../frontend/.npmignore), and [publishing.md](../frontend/docs/reference/publishing.md) describe a package no workflow publishes.
- **Recommended direction:** remove the private npm CLI/publication contract together while keeping workspace name/version fields used by builds/releases.
- **Deletion test:** no packaging-only file/script/doc remains and normal workspace install/build/version commands still work.
- **Validation:** clean pnpm install, root wrappers, frontend build, version bump/check, desktop packaging metadata, and release workflow.

#### B5. Mock the handwritten API boundary, not generated internals

- **Evidence / strength — Strong:** 14 tests import/mock generated SDK modules directly instead of the documented [api/index.ts](../frontend/src/api/index.ts) plus MSW transport boundary.
- **Recommended direction:** move tests to `@/api` or request-level MSW based on what behavior they own; reserve generated mocks for generator-contract tests.
- **Deletion test:** application tests survive generated file reshaping when the handwritten API contract is unchanged.
- **Validation:** regenerate the client, run the 14 migrated tests and full suite, and verify request bodies/auth/error paths through MSW where appropriate.

#### B6. Make Knip authoritative and decide `postcss` ownership

- **Evidence / strength — Strong:** [knip.json](../frontend/knip.json#L9-L20) ignores UI sources and direct `postcss`, while [package.json](../frontend/package.json#L113-L135) also has Tailwind's PostCSS integration. Removing the direct dependency still requires confirming the clean-install toolchain contract.
- **Recommended direction:** remove the UI exclusion, prune exports, and confirm whether tooling resolves `postcss` transitively before deleting the direct dependency.
- **Deletion test:** configured Knip passes without blanket ignores; `postcss` is either proven direct and documented or absent.
- **Validation:** Knip, CSS build, Tailwind processing, clean lockfile install, lint, tests, and production build.

#### B7. Provide one executable frontend verification contract

- **Evidence / strength — Strong:** [package.json](../frontend/package.json#L88-L105) exposes separate checks while guides and CI compose overlapping subsets, making the required local/CI contract easy to drift.
- **Recommended direction:** add one non-mutating verification command that calls the agreed checks and make CI invoke the same contract, with desktop-only checks separate where resources are required.
- **Deletion test:** duplicated check lists disappear from workflows/docs and one command documents the frontend acceptance gate.
- **Validation:** clean pass, purposeful failures for lint/test/build/Knip/docs/version, CI exit propagation, and no format mutation.

#### B8. Add lint/type coverage for tooling configuration

- **Evidence / strength — Strong:** current lint targets only `src/**/*.{ts,tsx}`, excluding [vite.config.ts](../frontend/vite.config.ts) and [openapi.config.ts](../frontend/openapi.config.ts), even though these execute in build/generation paths.
- **Recommended direction:** include tooling configs in an appropriate TypeScript/ESLint project or a small dedicated config check.
- **Deletion test:** config-specific suppressions are minimal and syntax/type regressions fail before production build/client generation.
- **Validation:** lint/typecheck both configs, Vite build, OpenAPI generation, Node runtime compatibility, and clean IDE resolution.

#### B9. Resolve the 49-file format-check baseline

- **Evidence / strength — Strong:** `pnpm -C frontend format:check` currently reports 49 files while [package.json](../frontend/package.json#L96-L97) presents the command as a verification surface.
- **Recommended direction:** align the existing files and enforce the check, or remove/rename a misleading command if formatting is intentionally non-gating; do this as a focused mechanical change.
- **Deletion test:** the command either passes and is enforced or no longer claims to be a check.
- **Validation:** zero-diff format check after the dedicated formatting change, lint, tests, build, and review that generated/vendor files remain excluded.

#### B10. Consolidate the release-version registry

- **Evidence / strength — Strong:** this is the maintenance counterpart of C10: [bump-version.mjs](../scripts/bump-version.mjs) and [check-versions.mjs](../scripts/check-versions.mjs) duplicate ownership and omit lock/tag assertions.
- **Recommended direction:** make one data registry drive bump and verification, with Cargo lock and tag checks at release time.
- **Deletion test:** adding a versioned source requires one registry change and all release surfaces are covered automatically.
- **Validation:** unit fixtures plus `pnpm bump-version` in a disposable tree, `pnpm check-versions`, lock regeneration, and tagged/manual workflows.

#### B11. Consolidate Python runtime-preparation commands

- **Evidence / strength — Strong:** Python 3.14t selection and packaging commands are duplicated across [package.json](../frontend/package.json#L100-L105), [desktop-macos.yml](../.github/workflows/desktop-macos.yml#L94-L142), and [desktop-windows.yml](../.github/workflows/desktop-windows.yml#L101-L157).
- **Recommended direction:** let one repository script own runtime preparation/version; workflows retain platform setup and artifact verification only.
- **Deletion test:** duplicated command strings/selectors disappear from workflows without hiding platform-specific signing/bundling.
- **Validation:** local macOS preparation, Windows workflow shell behavior, cached/clean runs, free-threaded Python, staged manifest, and desktop builds.

#### B12. Delete retired workflow and Tauri surfaces

- **Evidence / strength — Strong:** zero-callers include `build-notes` in [desktop-macos.yml](../.github/workflows/desktop-macos.yml#L6-L22) / [desktop-windows.yml](../.github/workflows/desktop-windows.yml#L6-L32), Tauri HTTP plugin/direct serde dependencies in [Cargo.toml](../frontend/src-tauri/Cargo.toml), global/window-webview permissions in [default.json](../frontend/src-tauri/capabilities/default.json), and dead `__BACKEND_PORT__` injection in [main.rs](../frontend/src-tauri/src/main.rs#L1068-L1077). External runtime-environment compatibility remains a separate confirmation item below.
- **Recommended direction:** remove those surfaces and stale config docs while preserving live opener, dialog, and filesystem capabilities; confirm external `.env` compatibility separately below.
- **Deletion test:** manifests/workflows contain no permission/dependency/input/global with zero consumers, and live native commands retain least privilege.
- **Validation:** workflow dispatch/release, capability-denial smoke, open/save dialogs, external links, filesystem access, native download, and runtime-config backend URL.

#### B13. Treat Vite 8 residue as a measured cleanup

- **Evidence / strength — Worth exploring:** [vite.config.ts](../frontend/vite.config.ts#L70-L76) explicitly selects esbuild CSS minification although Vite 8 defaults to Lightning CSS, and [package.json](../frontend/package.json#L125-L135) retains direct esbuild; the React Compiler bridge remains intentional.
- **Recommended direction:** compare emitted CSS and representative visuals before removing the override/dependency; ignore low-value redundant defaults unless they obscure a real contract.
- **Deletion test:** the override/direct dependency can disappear with equivalent supported CSS and no extra compatibility layer.
- **Validation:** bundle diff, CSS size/order, Tailwind output, browser/Tauri visual smoke, animations/themes, and full production build.

### Direct Deletion Wins

These are compact implementation candidates with confirmed zero-callers or
unreachable callers. Product/external-contract caveats remain where noted.

| Candidate | Evidence / deletion guard |
| --- | --- |
| Topic minimum-size helper | Remove [minTopicSize.ts](../frontend/src/features/views/topic-modeling/components/panels/minTopicSize.ts) after its zero-import check. |
| Recent-selection clear | Remove the unused clear action from [recentSelectionsStore.ts](../frontend/src/stores/recentSelectionsStore.ts). |
| `useZoom` clamp return | Remove the unused return surface from [useZoom.ts](../frontend/src/hooks/useZoom.ts), retaining live zoom behavior. |
| Tokenizer-order/test helpers | Delete only helpers with zero production and meaningful test consumers; do not erase deliberate contract seams. |
| Hidden UI modifiers/exports | Remove after Knip runs without the blanket UI ignore. |
| Narrow hook/API outputs | Delete zero-caller raw query fields, task outputs, schema aliases, hydration/request helpers, and exports one owner at a time. |
| Retired Tauri/workflow surfaces | Remove HTTP plugin, direct serde, global/window-webview permissions, `__BACKEND_PORT__`, and `build-notes`; keep live opener/dialog/filesystem. |
| Private npm publication | Remove CLI, `bin`/`files`/prepublish configuration, `.npmignore`, and publishing docs while preserving workspace name/version. |

### Worth Confirming

- **External desktop runtime environment:** confirm whether external deployments
  rely on `.env` / `.env.desktop` loading before removing it. The standard
  packager does not establish that compatibility requirement.
- **Vite 8 CSS minifier:** remove the explicit esbuild choice only after output
  and visual comparison; keep the React Compiler Vite/Babel bridge.
- **Release/source-map/signing policy:** source maps, tag rules, signing identity,
  and bundle targets are policy decisions. Record the chosen policy rather than
  calling these surfaces dead code.

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
  Break only the import cycle identified in D19; replacing it with local mirror
  state would duplicate router truth.
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
