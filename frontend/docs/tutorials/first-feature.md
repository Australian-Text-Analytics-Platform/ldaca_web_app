# Tutorial: Add a Small Frontend Feature

**Scope statement:** Walk through a minimal feature change using the frontend’s feature‑first structure.

## Step 1 — Pick a feature slice

**Question:** *Where should a new UI feature live?*

**Answer:** Under `src/features/<domain>/<feature>/` with `components/`, `hooks/`, and `services/` folders.

## Step 2 — Add a small view component

**Question:** *What’s a safe first change?*

**Answer:** Add a small presentational component that receives props and renders a card or panel (no side effects yet).

## Step 3 — Wire a hook

**Question:** *How do I connect data?*

**Answer:** Create a hook in the feature’s `hooks/` folder and pass its output into the view component.

## Step 4 — Keep mutations isolated

**Question:** *Where should API calls live?*

**Answer:** Use a `services/` module or an API adapter and call it from the hook. Keep the view component pure.

## Recap

**Question:** *How do I confirm the feature fits the architecture?*

**Answer:** Verify the component uses slice hooks, keeps side effects in hooks, and updates state through shared stores or query caches.
