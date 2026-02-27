# Analysis Task Flow Unification Implementation Plan

> For Claude: REQUIRED SUB-SKILL: use `superpowers:executing-plans` to execute this plan task-by-task.

## Overview

- Goal: unify all analysis tabs onto one shared task lifecycle engine so behavior is identical.
- Scope: frontend only.
- Tabs: topic-modeling, token-frequency, sequential-analysis, quotation, concordance.
- Core behavior target:
  - active-tab + matching-task-type completion refresh
  - results-only refresh on completion
  - task-center clear has no analysis-side effects

## Constraints and Invariants

1. All five tabs must use one shared lifecycle core.
2. Completion refresh must run only when current tab matches completed task type.
3. Completion refresh must update result content only (never parameter state).
4. Task-center clear must only remove task item in task center.
5. Task-type matching must use backend canonical keys (for example `token_frequencies`).
6. Legacy duplicated lifecycle branches should be removed after migration.

## Task 0 — Baseline snapshot and safety checks

- Files:
  - Modify: none (read-only baseline)
  - Verify: `frontend/src/features/analysis/**`, `frontend/src/features/workspace/task-stream/**`, `frontend/src/components/layout/**`
- Steps:
  1. Capture baseline status of touched files.
  2. Run baseline quality gates.
  3. Create baseline checkpoint commit.
- Commands:
  - `cd frontend && npx eslint src/features/analysis src/features/workspace/task-stream src/components/layout`
  - `cd frontend && npx tsc --noEmit`
  - `cd frontend && npm run build`
- Expected result: all checks pass before refactor.
- Commit suggestion: `chore: baseline before task-flow unification`

## Task 1 — Create shared task-flow contracts

- Files:
  - Create: `frontend/src/features/analysis/common/tasks/types.ts`
  - Modify: `frontend/src/features/analysis/common/index.ts`
- Steps:
  1. Add shared contract types for canonical task type, lifecycle snapshot, refresh callback (`refreshResults`), active-tab predicate input, and per-tab adapter contract.
  2. Export contract types from common barrel.
  3. Verify with typecheck.
- Command:
  - `cd frontend && npx tsc --noEmit`
- Commit suggestion: `feat: add shared analysis task-flow contracts`

## Task 2 — Implement shared lifecycle policies

- Files:
  - Create: `frontend/src/features/analysis/common/tasks/policies.ts`
  - Modify: `frontend/src/features/analysis/common/index.ts`
- Steps:
  1. Add `shouldRefreshOnCompletion(...)` with terminal-only, active-tab-only, matching-task-type-only logic.
  2. Add `isTaskCenterClearOnlyAction(...)` to enforce clear semantics.
  3. Verify with typecheck.
- Command:
  - `cd frontend && npx tsc --noEmit`
- Commit suggestion: `feat: add shared task-flow policy helpers`

## Task 3 — Implement shared hook `useAnalysisTaskFlow`

- Files:
  - Create: `frontend/src/features/analysis/common/tasks/useAnalysisTaskFlow.ts`
  - Modify: `frontend/src/features/analysis/common/index.ts`
- Steps:
  1. Centralize lifecycle orchestration:
     - task stream/status intake
     - terminal transition detection
     - terminal refresh dedupe key (`taskId:state`)
     - active-tab + task-type gated `refreshResults`
     - normalized `waitingBanner` and `hasActiveTask`
  2. Keep side-effects minimal:
     - no parameter restore
     - no clear-task behavior
     - no cache/result invalidation
  3. Verify with typecheck.
- Command:
  - `cd frontend && npx tsc --noEmit`
- Commit suggestion: `feat: add shared analysis task-flow hook`

## Task 4 — Migrate topic-modeling to thin adapter

- Files:
  - Modify: `frontend/src/features/analysis/topic-modeling/hooks/useTopicModelingTaskFlow.ts`
  - Modify: `frontend/src/features/analysis/topic-modeling/TopicModelingFeature.tsx`
- Steps:
  1. Replace local lifecycle branches with shared hook.
  2. Keep only adapter responsibilities:
     - task type
     - workspace id
     - active-tab check
     - `refreshResults` implementation
  3. Remove duplicated terminal/dedupe refs.
  4. Ensure completion path never mutates parameter state.
  5. Verify lint + typecheck.
- Commands:
  - `cd frontend && npx eslint src/features/analysis/topic-modeling`
  - `cd frontend && npx tsc --noEmit`
- Commit suggestion: `refactor: migrate topic modeling to shared analysis task flow`

## Task 5 — Migrate token-frequency and canonicalize task type

- Files:
  - Modify: `frontend/src/features/analysis/token-frequency/hooks/useTokenFrequencyTaskFlow.ts`
  - Modify: `frontend/src/features/analysis/token-frequency/TokenFrequencyFeature.tsx`
- Steps:
  1. Replace local lifecycle logic with shared hook.
  2. Canonicalize task type usage to backend key (`token_frequencies`).
  3. Remove mixed alias matching and duplicate terminal refresh branches.
  4. Verify lint + typecheck.
- Commands:
  - `cd frontend && npx eslint src/features/analysis/token-frequency`
  - `cd frontend && npx tsc --noEmit`
- Commit suggestion: `refactor: migrate token frequency to shared task flow`

## Task 6 — Migrate sequential-analysis

- Files:
  - Modify: `frontend/src/features/analysis/sequential-analysis/SequentialAnalysisFeature.tsx`
  - Modify: `frontend/src/features/analysis/sequential-analysis/hooks/*` (if needed)
- Steps:
  1. Move lifecycle handling to shared hook.
  2. Keep adapter-only tab code.
  3. Remove duplicate terminal and active-tab branches.
  4. Verify lint + typecheck.
- Commands:
  - `cd frontend && npx eslint src/features/analysis/sequential-analysis`
  - `cd frontend && npx tsc --noEmit`
- Commit suggestion: `refactor: migrate sequential analysis to shared task flow`

## Task 7 — Migrate quotation and concordance

- Files:
  - Modify: `frontend/src/features/analysis/quotation/QuotationFeature.tsx`
  - Modify: `frontend/src/features/analysis/concordance/ConcordanceFeature.tsx`
  - Modify: per-tab task hooks if present
- Steps:
  1. Migrate quotation to shared hook.
  2. Migrate concordance to shared hook.
  3. Verify parity with topic/token behavior.
  4. Verify lint + typecheck.
- Commands:
  - `cd frontend && npx eslint src/features/analysis/quotation src/features/analysis/concordance`
  - `cd frontend && npx tsc --noEmit`
- Commit suggestion: `refactor: migrate quotation and concordance to shared task flow`

## Task 8 — Enforce task-center clear-only semantics

- Files:
  - Review/modify if needed: `frontend/src/components/layout/Sidebar.tsx`
  - Review/modify if needed: `frontend/src/components/layout/sidebar/SidebarTasksSection.tsx`
  - Review/modify if needed: `frontend/src/features/workspace/task-stream/*`
- Steps:
  1. Trace clear action path end-to-end.
  2. Ensure clear only updates backend + task-center store.
  3. Remove any cache invalidation/result clear/parameter mutation side-effects.
  4. Manually verify in UI.
- Commit suggestion: `refactor: enforce task-center clear-only behavior`

## Task 9 — Delete legacy lifecycle code

- Files:
  - Modify migrated tab files/hooks to remove dead code
  - Optionally modify: `frontend/src/hooks/useAnalysisTaskLifecycle.ts` if obsolete branches become unused
- Steps:
  1. Remove old `lastTerminal*` refs and duplicate fallback glue.
  2. Remove obsolete exports/types tied to old lifecycle logic.
  3. Run strict lint sweep.
- Command:
  - `cd frontend && npx eslint src/features/analysis src/hooks src/features/workspace/task-stream src/components/layout`
- Commit suggestion: `refactor: remove legacy per-tab task lifecycle code`

## Task 10 — Final verification and rollout

- Files:
  - Optional docs update: `frontend/README.md` or relevant docs
- Steps:
  1. Run full quality gates.
  2. Run manual behavior checklist.
  3. Create final commit.
- Commands:
  - `cd frontend && npx eslint src/features/analysis src/features/workspace/task-stream src/components/layout src/hooks`
  - `cd frontend && npx tsc --noEmit`
  - `cd frontend && npm run build`
- Manual checklist:
  1. Run task in tab A while viewing tab A:
     - task center updates in real time
     - terminal refresh updates tab A result panel
  2. Run task in tab A and switch to tab B before completion:
     - tab B does not refresh unexpectedly
  3. Repeat for all analysis tabs.
  4. Clear task from task center:
     - only task-center item is removed
     - no results are cleared
     - no parameters are mutated
- Commit suggestion: `refactor: unify analysis task flow and remove legacy lifecycle logic`

## Risks and Mitigations

1. Task type mismatch regression
   - Mitigation: centralize canonical task keys in shared contracts.
2. Duplicate terminal callback firing
   - Mitigation: shared dedupe key (`taskId:terminalState`).
3. Parameter overwrite on completion
   - Mitigation: hard rule in shared hook + review checklist.
4. Task clear side-effects reintroduced
   - Mitigation: policy helper + explicit manual checklist.

## Definition of Done

- All five analysis tabs use the same shared lifecycle hook.
- Per-tab task flow code is adapter-thin only.
- Completion refresh is active-tab + matching-task-type gated and results-only.
- Task-center clear is task-center-only.
- Legacy duplicated lifecycle branches are removed.
- Lint, typecheck, and build pass.

## Next-session Prompt

Use this prompt in the next chat:

Implement `docs/plans/2026-02-26-analysis-task-flow-unification.md` task-by-task using executing-plans. Remove legacy lifecycle paths after each tab migration. Stop after each major batch and report verification output.
