# Implementation Comment Audit

Use this runbook only for broad comment/docstring work. Ordinary changes update
the nearby explanation when behavior, ownership, callers, or side effects
change.

## Standard

For each non-trivial module, class, function, component, hook, route, worker,
store, or helper, explain:

- why it exists and which responsibility it owns;
- the important caller or consumer and what that caller gains;
- the main flow, guards, side effects, and returned/raised outcomes when the
  body is branchy or stateful.

Do not narrate syntax, repeat type signatures, guess callers, or add boilerplate
to tiny self-explanatory wrappers. Generated, vendored, resource, and build
outputs are outside manual sweeps; change their generator or source template
when necessary.

## Broad Audit Flow

1. Enumerate relevant source units with an AST-aware script or language-server
   index.
2. Use references and targeted `rg` searches to verify callers and consumers.
3. Record missing why/caller/flow coverage without editing unrelated code.
4. Update the smallest accurate comment next to each affected unit.
5. Repeat the structured scan until missing coverage is zero.
6. Run the affected package's type, test, lint, and documentation checks.
