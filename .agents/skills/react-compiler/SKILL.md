---
name: react-compiler
description: Always-on React Compiler best-practice policy for all React code. Use this skill by default in every React task (new features, bug fixes, refactors, reviews) to minimize manual memoization (`useMemo`, `useCallback`, `React.memo`) while preserving correctness at identity-sensitive boundaries.
---

# React Compiler Skill

## Overview

This skill is an **always-on React coding policy** for this codebase.

Agents should apply it by default to **all React work**, not only during dedicated migration/refactor tasks.

This skill helps agents use React Compiler effectively and **safely minimize manual memoization** where it is no longer needed.

React Compiler can automatically memoize render work, so many manual optimizations become redundant. However, some memoization is still necessary for correctness or integration boundaries.

This skill focuses on:
- Removing unnecessary `useMemo`, `useCallback`, and `React.memo`
- Preserving identity-sensitive logic (effects, subscriptions, external libs)
- Applying compiler-first defaults continuously in day-to-day development
- Debugging compiler/runtime behavior when issues appear

## When to Use This Skill

Use this skill **every time you touch React code**.

Mandatory trigger set:
- new React feature work
- bug fixes in React components/hooks
- refactors and cleanup
- code review feedback on React files
- performance tuning and render investigations
- regression/debug sessions involving React behavior

Always apply it when working in:
- component rendering logic
- hook dependency chains
- callback-heavy props passing
- table/graph/virtualization integrations

Do not wait for a specific user prompt about React Compiler; this is the default standard.

## Prerequisites

1. React Compiler is configured in build tooling (usually Babel plugin).
2. ESLint React hooks rules are enabled (`eslint-plugin-react-hooks`, `recommended-latest` preferred).
3. Ability to run project checks (`build`, `lint`, tests).
4. Incremental rollout strategy (directory-based, annotation mode, or feature gating).

## Core Principles

1. **Default to compiler-driven memoization for all React code.**
2. **Treat manual memoization as an escape hatch, not a default.**
3. **Do not remove all memoization blindly; remove by classification and verification.**
4. **Preserve memoization used for correctness** (especially effect dependency stability).
5. **Use `"use no memo"` only as temporary isolation/debugging escape hatch.**
6. **For every new memoization added, document the correctness/identity reason.**

## Always-On Best Practice Policy

1. `useMemo`, `useCallback`, and `React.memo` are **not baseline defaults**.
2. The baseline is plain React code that relies on compiler optimization.
3. Manual memoization is allowed only when at least one applies:
   - correctness depends on stable identity
   - third-party integration requires reference stability
   - verified performance hotspot where compiler behavior is insufficient
4. Any allowed manual memoization should include brief rationale in code review or nearby comment (why identity is required).

## What React Compiler Can Replace

High-confidence removal candidates:
- `useMemo` for simple derived render values
- `useCallback` for local UI handlers passed down in normal component trees
- `React.memo` wrappers on thin/pass-through components

Typical examples:
- computed labels, derived arrays/maps used only in render
- click/change handlers without external identity contract
- wrapper components that just render a feature component

## What Usually Must Stay (or Needs Careful Review)

Keep (or review very carefully) when identity is part of correctness:

1. **Effect dependency stability contracts**
   - Values/callbacks intentionally stabilized to avoid effect over-firing or loops.
2. **Subscription / imperative APIs**
   - `addEventListener`/`removeEventListener`, sockets, observers, external stores.
3. **Callback refs and ref wiring**
   - Where referential stability controls attach/detach behavior.
4. **Provider boundary fanout control**
   - `Context.Provider value` objects with large consumer trees.
5. **Third-party identity-sensitive libs**
   - Tables, graph libs, virtualization, animation libs.
6. **Known edge patterns from working-group discussions**
   - Existing manual memoization can encode correctness semantics.

## Standard Workflow (Always-On)

Use this workflow in every React task, not only migrations.

1. **Write straightforward compiler-first code**
   - Start without `useMemo`/`useCallback`/`React.memo` unless a known boundary requires stability.

2. **Classify memoization touchpoints**
   - For existing code: classify as remove / keep / manual-review.
   - For new code: add memoization only if a correctness/identity contract exists.

3. **Apply smallest safe change**
   - Prefer removing redundant wrappers in local scope first.
   - Avoid broad rewrites in identity-sensitive systems in one pass.

4. **Verify behavior and performance**
   - Run lint/typecheck/tests/build.
   - Smoke critical flows for effects, subscriptions, and third-party state sync.

5. **Document intent**
   - If memoization is kept/added, note why it is required.

## Migration Workflow (When doing explicit cleanup)

1. **Confirm compiler setup**
   - Verify Babel plugin integration and toolchain support.
   - Ensure plugin order is correct (compiler early in pipeline).

2. **Pick incremental strategy**
   - Directory-based rollout (Babel overrides), or
   - `compilationMode: 'annotation'` + `"use memo"`, or
   - Runtime `gating` for controlled rollout/A-B.

3. **Audit memoization usage**
   - Inventory all `useMemo`/`useCallback`/`React.memo` occurrences.
   - Classify as: remove / keep / manual-review.

4. **Refactor in small batches**
   - Start with leaf components and pure derivations.
   - Keep commits focused and reversible.

5. **Verify each batch**
   - Run lint/typecheck/tests/build.
   - Smoke critical flows for stale/over-firing effects.

6. **Escalate carefully**
   - Tackle complex modules (tables/graphs/effects-heavy hooks) after stable wins.

## Debugging & Troubleshooting Workflow

When behavior changes unexpectedly:

1. Add `"use no memo"` to suspicious component/hook to isolate compiler involvement.
2. Check for Rules of React violations and effect dependency correctness.
3. If issue disappears with opt-out, fix root cause; remove opt-out afterward.
4. Prefer minimal reproductions for potential compiler bugs.

Important distinction:
- **Build-time errors**: often toolchain/config issues.
- **Runtime regressions**: often hidden Rules-of-React or memoization-for-correctness assumptions.

## Configuration Guidance (Practical)

- `compilationMode`:
  - `infer` (default): best for most modern codebases
  - `annotation`: strict incremental control via `"use memo"`
  - `all`: generally avoid unless you fully understand tradeoffs
- `target`:
  - `19` default
  - `17`/`18` require `react-compiler-runtime`
- `gating`: use for staged rollout and feature-flag experiments
- Directives:
  - `"use memo"`: opt-in/force compile (mainly annotation mode)
  - `"use no memo"`: temporary opt-out for debugging

## Safe Agent Decision Rules

Before removing a memoization primitive, ask:

1. Is this only a performance hint, or also a correctness dependency?
2. Is identity consumed by effects/subscriptions/external libs?
3. Is this at a provider/table/graph boundary?
4. Can we prove safety with tests + smoke checks?

If any answer is uncertain, classify as **manual-review** and keep for now.

## Output Format for Memoization Audits

When reporting findings, use:

- **Removable (high confidence)**
  - file, symbol, reason
- **Keep (identity/correctness)**
  - file, symbol, contract being preserved
- **Manual review**
  - file, symbol, specific uncertainty + validation plan

## References

- React Compiler overview: https://react.dev/learn/react-compiler
- Introduction: https://react.dev/learn/react-compiler/introduction
- Installation: https://react.dev/learn/react-compiler/installation
- Incremental adoption: https://react.dev/learn/react-compiler/incremental-adoption
- Debugging: https://react.dev/learn/react-compiler/debugging
- Configuration: https://react.dev/reference/react-compiler/configuration
- Directives: https://react.dev/reference/react-compiler/directives
- Compiling libraries: https://react.dev/reference/react-compiler/compiling-libraries
- Working group discussions: https://github.com/reactwg/react-compiler/discussions
- Memoization removal discussion: https://github.com/reactwg/react-compiler/discussions/16
- Debugging announcement: https://github.com/reactwg/react-compiler/discussions/7

## Notes for Future Agents

- Treat this skill as **always active** for React work.
- Prefer compiler-driven optimization by default.
- For existing code, remove memoization gradually with verification.
- Keep manual memoization where identity is an API contract.
- Be explicit when keeping memoization: document *why*.
