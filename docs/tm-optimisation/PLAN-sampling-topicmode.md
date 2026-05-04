# Topic Modelling — Sampling & Topic Size Mode

**Branch:** `tm-optimisation`
**Plan file:** `docs/tm-optimisation/PLAN-sampling-topicmode.md`
**Status:** Not started
**Depends on:** Phases 1–5 of the main tm-optimisation plan (already complete)

This plan covers two new user-facing features and one architectural change:

1. Per-corpus random sampling before topic modelling
2. Topic size mode selector (Target / Min / Exact)
3. Remove MiniBatchKMeans auto-engagement (replace with sampling)

---

## Context

With Phase 3's online pipeline removed as the default, large corpora are handled by
**sampling down to a tractable size first**, then running the standard UMAP+HDBSCAN
BERTopic pipeline on the sample.  This trades completeness for quality: BERTopic's
native algorithm produces better topic structure than MiniBatchKMeans, and users
can always increase the sampling percentage if they want more coverage.

---

## Feature 1 — Per-corpus sampling

### UI layout

Each selected data block gets its own sampling row, coloured with the same swatch
used for that corpus in the bubble chart.  Example with two nodes:

```
● Node A (26,163 docs)
  [✓] Sample  [20]%  →  5,232 docs to model

● Node B (8,400 docs)
  [✓] Sample  [50]%  →  4,200 docs to model

  Combined: 9,432 docs
  ⚠  Combined count < 5 × 50 target topics (250) — consider increasing sample %
```

When only one node is selected the colour swatch is omitted (no ambiguity).

### Auto-populate logic (computed from `node.shape[0]`)

```
n = node.shape[0]   // total row count on the node

if n < 4000:
    enabled = false
    pct = 100
else:
    enabled = true
    pct = ceil(4000 / n * 100 / 10) * 10   // round up to nearest 10, capped at 100
    // examples:
    //   26,163 → ceil(15.3/10)*10 = 20%
    //   1,956,223 → ceil(0.204/10)*10 = 10%
    //   5,000 → ceil(80/10)*10 = 80%
```

### Locking rule

A per-corpus flag `userSet: boolean` starts as `false`.
- Any manual interaction (toggle checkbox, change % value) sets `userSet = true`.
- While `userSet = false`, auto-populate re-runs whenever the selected node or column changes.
- `handleClear()` resets `userSet = false` for all corpora → auto-populate re-runs.

### Validation / warning

After computing combined effective n_docs, show a non-blocking warning badge if:

```
combined_effective < 5 × effective_target_topic_count
```

where `effective_target_topic_count` is derived from the current topic size mode (see
Feature 2).  The warning does not block the Run button.

### Backend: sampling implementation

Sampling occurs inside `run_topic_modeling_task`, **before** embedding:

```python
def _sample_corpus(
    docs: list[str],
    fraction: float,
    seed: int,
) -> list[str]:
    """Return a random sample of docs without replacement."""
    import random as _random
    rng = _random.Random(seed)
    k = max(1, round(len(docs) * fraction))
    return rng.sample(docs, k)
```

- Applied to each corpus independently (one fraction per corpus).
- The sampled docs replace the originals for all downstream steps (embedding, BERTopic fit, reduce_topics).
- `sample_fractions: list[float | None]` is the new API field — `None` means no sampling for that corpus.

---

## Feature 2 — Topic size mode

### Dropdown options

Replaces the current "Min Topic Size" input.  A `<Select>` followed by a numeric
`<Input>`:

```
Topic sizing: [Target topic number ▾]   Value: [50]
```

| Mode | Dropdown label | Input label | Default value |
|------|---------------|-------------|---------------|
| `"target"` | Target topic number | Target topics | 50 |
| `"min"` | Min topic size | Min size | auto (see below) |
| `"exact"` | Exact topic number | Exact topics | 50 |

### Pre-populated values

`n_eff` = combined effective n_docs (post-sampling sum across corpora).

| Mode | Pre-populated value |
|------|---------------------|
| target | 50 |
| min | `max(2, floor(n_eff / (50 * 10)))` — equivalent to target=50 |
| exact | 50 |

### `min_topic_size` sent to backend

| Mode | Formula |
|------|---------|
| target | `max(2, n_eff // (value * 10))` |
| min | `value` (sent directly) |
| exact | `max(2, n_eff // (value * 15))` — ensures more topics than needed |

**Note:** for target and exact modes, `n_eff` is computed on the frontend and also
recomputed on the backend from the actual (post-sample) corpus sizes. The backend value
is authoritative; the frontend value is used only to populate the UI suggestion.

### Locking rule

Same as sampling: `topicModeUserSet: boolean`.  Any manual change (switch mode,
edit value) sets it `true`.  `handleClear()` resets it.

### Warning threshold

Show warning when:

```
combined_effective < 5 × effective_target
```

where `effective_target` is:
- target mode: `value`
- min mode: `floor(n_eff / value)` (estimated topic count)
- exact mode: `value`

### Backend: exact mode post-processing

After `topic_model.fit_transform(docs, embeddings)`, if `topic_size_mode == "exact"`:

```python
topic_model.reduce_topics(docs, nr_topics=topic_size_value)
# Model is updated in-place; get_topics() now returns the reduced set.
```

The result returned to the frontend contains only the reduced topics.

**Raw fit access (kept for future use):**  A commented helper function
`_get_raw_topics_before_reduction(topic_model)` is left in `worker_tasks_topic.py`
with a docstring explaining how to expose it via a separate API endpoint.  It is
not called in the normal flow.

---

## Feature 3 — Remove MiniBatchKMeans auto-engagement

`_should_use_online_pipeline` currently auto-switches when `n_docs > 100k` or
`bytes > 250 MB`.  With sampling, those thresholds are never reached in normal use.

**Change:** Set both thresholds to `float("inf")` so auto-engagement never fires.
`force_mode="online"` remains as an explicit API escape hatch for power users.
The `_build_online_pipeline` helper stays in the file (it still works; just not
auto-triggered), with a comment explaining why it is no longer the default.

---

## API changes

### `TopicModelingRequest` (models + analysis implementation)

New fields (all optional, backwards-compatible):

```python
sample_fractions: Optional[list[Optional[float]]] = None
# One entry per corpus. None = no sampling. Values in (0, 1].

topic_size_mode: Optional[Literal["target", "min", "exact"]] = "target"
topic_size_value: Optional[int] = 50
```

The existing `min_topic_size` field is preserved but **ignored** when
`topic_size_mode` is `"target"` or `"exact"` — it is computed from the formula
instead.  When `topic_size_mode == "min"`, `topic_size_value` is used as
`min_topic_size` (and the `min_topic_size` field is ignored to avoid ambiguity).

### Thread-through files

| File | Change |
|------|--------|
| `models/__init__.py` | Add `sample_fractions`, `topic_size_mode`, `topic_size_value` |
| `analysis/implementations/topic_modeling.py` | Add `Field()` descriptions for new fields |
| `api/workspaces/analyses/topic_modeling.py` | Pass new fields into `task_args` |
| `core/worker.py` | Add params to `topic_modeling_task` signature + forward to `run_topic_modeling_task` |
| `core/worker_tasks_topic.py` | Implement sampling, topic size mode, reduce_topics, raise thresholds |

---

## Frontend state design

### New state in `TopicModelingFeature.tsx`

```typescript
// Per-corpus sampling (indexed to match panelSelectedNodes order)
type CorpusSampleState = {
  enabled: boolean;
  pct: number;          // 1–100
  userSet: boolean;
};
const [corpusSamples, setCorpusSamples] =
  useState<CorpusSampleState[]>([]);

// Topic size mode (shared across corpora)
type TopicSizeMode = "target" | "min" | "exact";
const [topicSizeMode, setTopicSizeMode] =
  useState<TopicSizeMode>("target");
const [topicSizeValue, setTopicSizeValue] = useState(50);
const [topicSizeModeUserSet, setTopicSizeModeUserSet] = useState(false);
```

### Auto-populate effect

```typescript
useEffect(() => {
  // Recompute for each node if not user-set
  const next = panelSelectedNodes.map((node, i) => {
    const n = (node.shape as number[] | undefined)?.[0] ?? 0;
    const existing = corpusSamples[i];
    if (existing?.userSet) return existing;
    if (n < 4000) return { enabled: false, pct: 100, userSet: false };
    const raw = (4000 / n) * 100;
    const pct = Math.min(100, Math.ceil(raw / 10) * 10);
    return { enabled: true, pct, userSet: false };
  });
  setCorpusSamples(next);
}, [/* panelSelectedNodes ids/shapes — see note below */]);
```

Dependency: trigger on change of node ids + shape values.  Use a stable derived
key (e.g. `panelSelectedNodes.map(n => \`${n.id}:${n.shape?.[0]}\`).join("|")`).

### Derived values (computed, not stored)

```typescript
// Effective n_docs per corpus (post-sample)
const effectiveNDocs: number[] = corpusSamples.map((s, i) => {
  const n = (panelSelectedNodes[i]?.shape as number[] | undefined)?.[0] ?? 0;
  return s.enabled ? Math.round(n * s.pct / 100) : n;
});
const combinedNDocs = effectiveNDocs.reduce((a, b) => a + b, 0);

// Effective target for warning
const effectiveTarget: number = (() => {
  if (topicSizeMode === "target" || topicSizeMode === "exact")
    return topicSizeValue;
  // min mode: estimate from min_topic_size
  return combinedNDocs > 0 ? Math.floor(combinedNDocs / topicSizeValue) : 0;
})();

const showSamplingWarning =
  combinedNDocs > 0 && combinedNDocs < 5 * effectiveTarget;
```

### Reset on Clear Results

In `handleClear()`, after calling `clearResults()`:

```typescript
setCorpusSamples([]);                  // triggers auto-populate effect
setTopicSizeModeUserSet(false);        // triggers topic size re-population
setTopicSizeMode("target");
setTopicSizeValue(50);
```

### Building `sample_fractions` for the API call

```typescript
const sample_fractions = corpusSamples.map(s =>
  s.enabled ? s.pct / 100 : null
);
```

---

## Frontend component changes

### `TopicModelingParameterPanel.tsx`

New props to add:

```typescript
// Per-corpus sampling
corpusSamples: CorpusSampleState[];
onCorpusSampleChange: (idx: number, update: Partial<CorpusSampleState>) => void;
effectiveNDocs: number[];
showSamplingWarning: boolean;

// Topic size mode
topicSizeMode: TopicSizeMode;
onTopicSizeModeChange: (mode: TopicSizeMode) => void;
topicSizeValue: number;
onTopicSizeValueChange: (value: number) => void;
```

Remove props: `minTopicSize`, `onMinTopicSizeChange` (replaced by topic size mode).

**Layout sketch:**

```
[ NodeSelectionPanel (existing, showShape=true) ]

┌─ Sampling ───────────────────────────────────────────────────────────┐
│  ● [colour] Node A (26,163 docs)                                      │
│    [✓] Sample  [20]% of docs  →  5,232 docs to model                 │
│                                                                        │
│  ● [colour] Node B (8,400 docs)       (only shown if 2nd node active) │
│    [✓] Sample  [50]% of docs  →  4,200 docs to model                 │
│                                                                        │
│  Combined for topic modelling: 9,432 docs                             │
│  ⚠ Combined count may be too low for 50 topics (need ≥ 250)          │
└──────────────────────────────────────────────────────────────────────┘

┌─ Parameters ─────────────────────────────────────────────────────────┐
│  Topic sizing          Value       Random Seed   Representative Words │
│  [Target topic num ▾]  [50]        [42]          [15]                 │
└──────────────────────────────────────────────────────────────────────┘
```

The colour swatch next to each node name matches `nodeColors[node.id]`.

### `useTopicModelingTaskFlow.ts`

Pass new fields in the API payload:

```typescript
sample_fractions,
topic_size_mode: topicSizeMode,
topic_size_value: topicSizeValue,
```

---

## Backend implementation detail

### `run_topic_modeling_task` — new parameters

```python
sample_fractions: list[float | None] | None = None,
topic_size_mode: str = "target",
topic_size_value: int = 50,
```

### Sampling step (inside `_compute_topics`, before embedding)

```python
def _sample_corpus(docs: list[str], fraction: float, seed: int) -> list[str]:
    import random as _random
    rng = _random.Random(seed)
    k = max(1, round(len(docs) * fraction))
    return rng.sample(docs, k)

# In _compute_topics:
sampled_corpora = []
for i, corpus in enumerate(corpora):
    frac = (sample_fractions or [])[i] if sample_fractions else None
    if frac is not None and 0 < frac < 1.0:
        sampled_corpora.append(_sample_corpus(corpus, frac, random_state))
    else:
        sampled_corpora.append(corpus)
all_docs = [doc for corpus in sampled_corpora for doc in corpus]
```

### Topic size computation (replaces hardcoded `min_topic_size`)

```python
n_eff = len(all_docs)

if topic_size_mode == "target":
    computed_min_topic_size = max(2, n_eff // (topic_size_value * 10))
elif topic_size_mode == "min":
    computed_min_topic_size = max(2, int(topic_size_value))
else:  # "exact"
    computed_min_topic_size = max(2, n_eff // (topic_size_value * 15))
```

### Exact mode post-processing

```python
assigned_topics, probs = topic_model.fit_transform(all_docs, all_embeddings)

if topic_size_mode == "exact":
    topic_model.reduce_topics(all_docs, nr_topics=int(topic_size_value))
    # Re-read assignments after reduction
    assigned_topics = topic_model.topics_
```

### Raw fit access (commented, not called in normal flow)

```python
# ── Raw topic access before reduce_topics ────────────────────────────────
# Kept for future UI option ("show raw fit" toggle).
# To expose: add a field `raw_topics` to the result dict here, gated on a
# new parameter `return_raw_topics: bool = False`.  The API endpoint
# GET /workspaces/{id}/topic-modeling/tasks/{task_id}/raw-result
# could return this field separately so it doesn't bloat the normal payload.
#
# def _get_raw_topics(topic_model) -> list[dict]:
#     ...extract topic_payloads from topic_model before reduce_topics call...
# ─────────────────────────────────────────────────────────────────────────
```

### `_ONLINE_THRESHOLD_DOCS` / `_ONLINE_THRESHOLD_BYTES` — raise to infinity

```python
_ONLINE_THRESHOLD_DOCS = 10_000_000     # effectively never auto-triggers
_ONLINE_THRESHOLD_BYTES = 10 * 1024 ** 3  # 10 GB — same
```

Comment: "Auto-engagement disabled: sampling handles large corpora.  Use
force_mode='online' explicitly if MiniBatchKMeans is needed."

### Result meta additions

```python
"meta": {
    ...,
    "topic_size_mode": topic_size_mode,
    "topic_size_value": topic_size_value,
    "sample_fractions": sample_fractions,
    "corpus_sizes_before_sample": [len(c) for c in corpora],
    "corpus_sizes_after_sample": [len(c) for c in sampled_corpora],
}
```

---

## Implementation order

Work in this order to keep the test suite green at each step.

### Step 1 — Backend: sampling + topic size mode (no MiniBatchKMeans removal yet)

Files:
- `models/__init__.py` — add fields
- `analysis/implementations/topic_modeling.py` — add Field() descriptions
- `core/worker.py` — add params
- `api/workspaces/analyses/topic_modeling.py` — thread params
- `core/worker_tasks_topic.py` — sampling, topic_size_mode, reduce_topics logic

Tests to add:
- `test_topic_modeling_worker.py` — sampling reduces corpus length; target/min/exact
  produce different `min_topic_size` values; exact mode result has ≤ topic_size_value topics

### Step 2 — Backend: raise online thresholds

Files:
- `core/worker_tasks_topic.py` — set thresholds to large values, update comment

Existing tests for online threshold boundary should still pass (they use `force_mode`).

### Step 3 — Frontend: state + parameter panel

Files:
- `TopicModelingFeature.tsx` — new state, auto-populate effect, derived values,
  reset in handleClear, pass new props to panel and task flow
- `TopicModelingParameterPanel.tsx` — new sampling UI section, topic mode selector,
  remove old minTopicSize prop
- `useTopicModelingTaskFlow.ts` — include `sample_fractions`, `topic_size_mode`,
  `topic_size_value` in API payload

### Step 4 — Smoke test

Run the dev server (`npm run dev` in `frontend/`).  Verify:
- [ ] Single node <4000 docs: sampling disabled, 100%
- [ ] Single node >4000 docs: sampling enabled with correct auto-percentage
- [ ] Two nodes: separate colour-coded sampling rows; combined count shown
- [ ] Warning appears when combined < 5 × target
- [ ] Changing sampling % marks userSet; changing node does not reset it
- [ ] Clear Results resets all fields to auto-computed values
- [ ] Target mode: run completes, min_topic_size in meta matches formula
- [ ] Exact mode: returned topic count matches topic_size_value
- [ ] Min mode: behaves as before

---

## Exit criteria

- [ ] All 353 existing tests pass
- [ ] New tests for sampling, topic modes, reduce_topics pass
- [ ] Single-corpus and dual-corpus sampling UI renders correctly
- [ ] Warning badge fires at the right threshold
- [ ] User-set locking works; Clear Results resets
- [ ] Result meta contains `topic_size_mode`, `sample_fractions`, before/after sizes
- [ ] MiniBatchKMeans no longer auto-engages on large corpora
- [ ] `force_mode="online"` still works when explicitly passed

---

## Decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-04 | Sampling is per-corpus (not combined) | Different corpora can have very different sizes; separate controls give the user meaningful control |
| 2026-05-04 | Auto-populate pct rounded up to nearest 10% | Simplicity; user can override with any integer 1–100 |
| 2026-05-04 | Warning threshold: combined_effective < 5 × target | Rough but useful guard; BERTopic needs several docs per topic for reliable word extraction |
| 2026-05-04 | Exact mode shows only reduced topics | Raw fit is noisy and confusing for most users; kept accessible in commented backend code |
| 2026-05-04 | MiniBatchKMeans not removed, just threshold raised | Backwards compat; force_mode="online" still useful for bulk text research workflows |
| 2026-05-04 | topic_size_value replaces min_topic_size field in UI | Cleaner: all three modes share one value input; old min_topic_size API field kept for backwards compat |
