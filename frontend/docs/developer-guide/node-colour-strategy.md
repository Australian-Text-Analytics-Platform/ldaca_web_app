# Node-colour strategy

How workspace data-block ("node") colours are assigned, displayed, and
promoted across the graph view, the sidebar list, and every analytics
tab. Captures the design we agreed on during the 0.4.x multilingual
release work so the same picked colour follows a node everywhere.

This is a reference doc — implementation lives in:

- `frontend/src/stores/nodeColorsStore.ts` (global assigned colours)
- `frontend/src/features/analysis/common/useNodeColorManagement.ts` (per-tab subscriber + temp layer)
- `frontend/src/features/workspace/graph-view/...` (graph fill/stroke rules)
- `frontend/src/features/workspace/sidebar/...` (sidebar circle/dot rules)
- `frontend/src/lib/color.ts` (X → Y light-variant derivation)

## Mental model

Every node has **at most one assigned colour** at any time, plus zero or
one **temp colour per analytics tab** during a preview-before-run window.

```
                   ┌──────────────────────────┐
                   │   global assigned colour │ ← persists for session
                   │   (one per nodeId)        │   sidebar + graph use this
                   └─────────┬────────────────┘
                             │ promoted on Run
                             ▼
         ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
         │  Tab A temp  │   │  Tab B temp  │   │  Tab C temp  │ ← per-tab
         │  (per node)  │   │  (per node)  │   │  (per node)  │   preview
         └──────────────┘   └──────────────┘   └──────────────┘
```

The assigned colour is what the world sees outside the analytics tab.
The temp is a preview the user can manually override; it only commits
to "assigned" if the analysis runs.

## The two shades

For any picked colour `X` we derive `Y = light X` via HSL lightness
shift in `lib/color.ts`. Picker swatches and the assigned colour use `X`;
the lighter `Y` is used wherever we want a softer tint (graph fill, list
focus dot).

If a node has no assigned colour (never been used in analysis):

| State | X-equivalent | Y-equivalent |
| --- | --- | --- |
| Default neutral | mid grey (`#6b7280`) | light grey (`#e5e7eb`) |

These greys are the "never seen" defaults so the system still has a pair
to fall back on when nothing's been promoted.

## Active vs Focus vs Unselected

We distinguish three node states everywhere:

- **Active**: in the current analytics tab's "to-be-processed" window —
  i.e. one of the last-N selected nodes where N is the tab's allowed
  node count (see table below). These are the nodes that an action like
  "Run Concordance" will actually run against.
- **Focus / Selected**: in the workspace selection but NOT in the active
  window (got bumped out by a more recent selection within the same
  per-tab cap).
- **Unselected**: not in the workspace selection.

### Per-tab active-node count (last-N rule)

| Tab | N (allowed active nodes) |
| --- | --- |
| Concordance, Frequency, Topic Modelling | 1–2 |
| Trends, Quotation, AI Annotator | 1 |
| Filter, Sample, Find, Create, Polars Expression | 1 |
| Join | 2 |
| Stack | 2–all |
| Export | 1–all |

Selection beyond N puts the older selections into Focus, never silently
unselects them.

**Non-analytics tabs (Export, pre-process / Data Preprocessing) don't
roll temps.** They have no colour picker; they show only the assigned
colour. Many active nodes in those tabs is fine — no conflict-avoidance
fires, no temp promotion happens.

## Visual rules

### Graph view

| State                                | Header / fill | Outer stroke | Node name text |
| ------------------------------------ | ------------- | ------------ | -------------- |
| Active                               | `Y`           | `X`          | default        |
| Focus / Selected                     | `Y`           | (none)       | default        |
| Unselected — has an assigned colour  | (default)     | `Y`          | `X`            |
| Unselected — default grey            | (default)     | (none, default Tailwind ``border-border``) | default |

The active node has the strongest visual weight (Y-filled header strip
plus an X-coloured outer stroke). Focus has a softer fill only — the
stroke drops so the user can tell at a glance which selected node will
actually run. Unselected nodes that have an assigned colour get a soft
Y-coloured stroke plus an X-tinted name text so the assigned identity
is recognisable at rest; never-analysed grey nodes stay flat and quiet.

Zoomed-in graph mode keeps its existing top-bar-fill pattern but uses
the same `X` / `Y` pair.

### Sidebar data-block list

The colour only affects the **check icon** on the left, not the node
name text (which stays black).

| State | Shape | Fill | Stroke |
| --- | --- | --- | --- |
| Active | Dot (filled circle) | `X` | (none) |
| Focus / Selected | Dot (filled circle) | `Y` | (none) |
| Unselected | Circle (outline only) | (transparent) | `X` |

The "selected with tick" treatment we use today (white tick on filled
dot) carries forward — the tick goes on Active dots and on Focus dots.

## Temp colour lifecycle

Temp colours exist only inside analytics tabs. They are **per-tab,
per-node**.

### When a temp is rolled

A new temp is assigned to a node when:

- The node enters the tab's selection set AND the tab is an analytics
  tab (i.e. has a colour picker — Concordance, Frequency, Topic
  Modelling, Trends, Quotation, AI Annotator).

The temp value is picked randomly from `EXTENDED_PALETTE` (the same
palette the picker offers) subject to the conflict-avoidance rules
below.

If the node already has an assigned colour, that assigned colour is the
starting point for the temp **unless** it would conflict with another
node currently visible in the tab — in which case a random non-conflicting
palette colour is rolled instead.

### When a temp is promoted to assigned

On a successful "Run" of the analysis in that tab. The temp colours of
every node that participated in that run become the new assigned
colours. The temp layer for that tab clears.

Cross-tab implication: running Concordance promotes its own tab's
temps. It does NOT promote Frequency's pending temps.

### When a temp fades

When the node is **deselected** within the tab. A subsequent reselection
rolls a fresh temp.

If the tab is "locked" (showing a previous run's results), the temp
layer is frozen — the user clicked Clear Results before any new colour
decisions need to fire.

### Manual picker behaviour

The picker in an analytics tab writes to the **temp** layer, not to the
assigned. The user must Run to commit. This is intentional so a
nudge-of-the-picker doesn't silently rewrite assigned colours that other
tabs are showing.

## Conflict avoidance

Within a single analytics tab, the system prevents two visible nodes
from sharing the same colour. The set of "visible colours" used for
avoidance is:

- The assigned colours of any nodes in the tab's selection (active OR
  focus).
- Plus the temp colours of any nodes already given a temp in this tab.

When the user manually picks an identical colour for a second node in a
two-node tool, the second node's temp is automatically re-rolled to a
non-conflicting random palette colour. The user can re-pick if they
want to force the conflict (they always win — manual writes through to
the temp directly without re-rolling on top of an already-manual pick).

When Run fires, the committed assigned colour stays even if it conflicts
with another tab's assigned. Conflict avoidance only kicks in when both
nodes are visible together in the same tab.

If the user re-opens a tab that's still locked on a previous run, the
previous run's colours stay (results are locked; nothing should change).
Clear Results unlocks; the next selection refreshes conflict
detection against the now-current assigned colours.

## Node-by-node lifecycle illustration

```
1. Node A is created from a corpus load → assigned = none (grey)
                                          sidebar = grey circle outline
                                          graph   = light grey unselected

2. User selects A in Concordance        → Concordance temp = random blue
                                          sidebar unchanged (still grey)
                                          graph   unchanged

3. User runs Concordance                → assigned = blue (promoted)
                                          sidebar = blue dot
                                          graph   = light-blue fill + blue stroke

4. User clears results, opens Frequency, → Frequency temp = blue (starts
   selects A                              from assigned, no conflict)

5. User picks red in Frequency picker   → Frequency temp = red

6. User adds Node B (also blue assigned) → conflict: B's temp re-rolls
                                          to a random non-red, non-blue

7. User runs Frequency                  → A's assigned = red
                                          B's assigned = the rolled temp
                                          (was blue, now whatever was picked)
```

## Edge cases & known behaviour

- **Multi-tab gotcha**: Concordance has pending temp blue for Node A. User
  opens Frequency with same node, gets a fresh per-tab temp (per the
  rule), runs Frequency → A's assigned becomes Frequency's temp. User
  flips back to Concordance — its stale temp blue is still there. If
  they run Concordance now, A's assigned flips again. This is consistent
  with "per-tab temps; Run promotes the firing tab's temps".

- **A node that was active in one tab and is no longer selected
  anywhere**: assigned stays. Sidebar still shows the assigned dot/circle.
  The user can re-select the node and the assigned colour will be the
  starting temp.

- **Locked results showing stale colours**: when a tab is locked on a
  previous run, the displayed colours reflect what was used in that run.
  Clearing results unlocks and refreshes everything to current assigned.

- **Default-grey node accidentally used and deselected**: if the user
  selects a grey node, the system rolls a temp, but if they deselect
  without running, the temp fades and the node stays grey. Intentional:
  un-run nodes don't accumulate colour commitment.

## Open questions / proposed follow-ups

- **Newly created nodes (from detach / join / stack / etc.)** — should
  these stand out visually while still using the default grey fill? One
  proposal: stroke newly added blocks with a black outline so users can
  quickly locate them. Deferred — not part of the initial implementation.

- **Persistence beyond session**: the assigned colour map currently
  lives in memory only. Saving it to the workspace plbin so colours
  survive a reload is a future consideration, not part of this scope.

- **Palette exhaustion**: `EXTENDED_PALETTE` has 12 colours; with > 12
  ever-seen nodes the assignment cycles. This is acceptable for typical
  workspaces; if needed, fall-through could be HSL-rotated.
