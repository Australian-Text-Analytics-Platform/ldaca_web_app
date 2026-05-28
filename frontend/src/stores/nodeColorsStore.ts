/**
 * Cross-tab stable colour assignment for workspace nodes.
 *
 * Two-tier model from
 * ``frontend/docs/developer-guide/node-colour-strategy.md``:
 *
 *   - **Assigned** (``colors``, persisted in-memory for the session) is
 *     what the graph + sidebar display. Survives tab switches and
 *     deselections. Updated only when an analytics tab promotes its
 *     pending temp via ``promoteTempColors``.
 *
 *   - **Temp** (``temps``, ``Record<tabKey, Record<nodeId, color>>``) is
 *     a per-tab preview rolled when a node enters an analytics tab's
 *     selection. Visible only inside that tab (its NodeSelectionPanel,
 *     the picker swatches). Cleared when the node leaves the tab's
 *     selection (``clearTempColors``) or promoted to assigned on
 *     successful Run (``promoteTempColors``).
 *
 * Conflict avoidance: ``ensureTempColors`` picks colours that don't
 * already appear among the tab's currently-visible colours (the union
 * of existing temps in this tab and the assigned colours of other
 * selected nodes). When the user manually overrides via
 * ``setTempColor`` the override wins — no re-rolling on top of a manual
 * pick.
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { AUTO_ASSIGN_PALETTE } from '@/features/views/common/palette';

type ColorMap = Record<string, string>;

interface NodeColorsState {
  /** Assigned colour map (one entry per nodeId). What the graph and
   * sidebar consume. */
  colors: ColorMap;
  /** Order in which nodeIds first received an assigned colour. Stable
   * across re-renders so the next-new node gets the next palette
   * colour deterministically when ``ensureColors`` is used. */
  assignmentOrder: string[];
  /** Per-tab temp colour layer. Outer key is the tab identifier (each
   * analytics tab passes its own constant — typically the matching
   * ``ViewType``). Inner key is nodeId → tentative colour. */
  temps: Record<string, ColorMap>;

  /** Idempotent. Direct-to-assigned path for callers that don't have
   * a temp/preview-on-Run notion (Export, the workspace sidebar's
   * pre-tab usage). New nodeIds get the next palette colour by
   * insertion order. */
  ensureColors(nodeIds: string[]): void;

  /** Direct-to-assigned write. Used by non-analytics callers and by
   * ``promoteTempColors`` internally. */
  setColor(nodeId: string, color: string): void;

  /** Per-tab idempotent temp roll. For each nodeId without a temp in
   * ``tabKey``: prefer the node's assigned colour as the starting
   * temp (so reselecting a previously-promoted node is colour-stable),
   * unless that would conflict with another node currently visible
   * in the tab — in which case roll a random palette colour avoiding
   * the visible set. Conflict-avoidance set = existing temps for
   * this tab on the given nodes + assigned colours of any of the
   * given nodes that already have one. */
  ensureTempColors(tabKey: string, nodeIds: string[]): void;

  /** Manual pick path (NodeColorPicker on an analytics tab). Writes
   * directly to the tab's temp layer; ``promoteTempColors`` later
   * commits it to ``colors``. */
  setTempColor(tabKey: string, nodeId: string, color: string): void;

  /** Drop temp entries for the given nodeIds in ``tabKey`` (or all
   * for the tab when ``nodeIds`` is omitted). Called when a node is
   * deselected from the tab so a future reselection rolls a fresh
   * temp instead of inheriting a stale one. */
  clearTempColors(tabKey: string, nodeIds?: string[]): void;

  /** Promote the tab's temp colours to assigned for the given
   * nodeIds. Called by an analytics tab's "Run" handler — the user's
   * pending preview becomes the real colour the sidebar + graph
   * display. Temp entries for the promoted nodes are cleared. */
  promoteTempColors(tabKey: string, nodeIds: string[]): void;

  /** Bulk-hydrate the assigned colour map. Replaces ``colors`` and
   * resets ``assignmentOrder`` to ``Object.keys(next)``. Used by the
   * persistence layer to seed the store from the workspace's
   * ``ui_state.json`` sidecar on load. Does NOT touch the per-tab
   * temps — those are session-only and never persisted. */
  hydrateColors(next: Readonly<Record<string, string>>): void;

  /** Drop colour entries (assigned + per-tab temps + assignmentOrder)
   * for nodeIds that are no longer in the live workspace.
   * ``useWorkspaceGraph`` calls this whenever a fresh graph payload
   * arrives so deleted nodes don't accumulate stale colour metadata
   * in the store (and, once persistence lands, in the persisted
   * sidecar). ``activeNodeIds`` is the authoritative current set;
   * everything else is swept.
   *
   * Idempotent — no-op when nothing needs sweeping. */
  pruneStaleColors(activeNodeIds: ReadonlyArray<string>): void;

  /** Test / future workspace-reset path. */
  reset(): void;
}

/** Chooses a palette colour not already visible in the current analysis tab when possible. */
/** Consumed by: useNodeColorsStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
function pickRandomPaletteAvoiding(avoid: ReadonlySet<string>): string {
  const free = AUTO_ASSIGN_PALETTE.filter((c) => !avoid.has(c));
  if (free.length === 0) {
    // Palette exhausted (>11 distinct visible colours — grey is
    // excluded from auto-assign per UNASSIGNED_NODE_COLOR). Fall back
    // to a random auto-assign colour rather than blocking; duplicates
    // inside one tab are rare in practice.
    return AUTO_ASSIGN_PALETTE[Math.floor(Math.random() * AUTO_ASSIGN_PALETTE.length)]!;
  }
  return free[Math.floor(Math.random() * free.length)]!;
}

export const useNodeColorsStore = create<NodeColorsState>()(
  immer((set) => ({
    colors: {},
    assignmentOrder: [],
    temps: {},

    /** Assigns persistent node colours for callers that do not use a temp preview layer. */
    /**
     * Consumed by: useNodeColorsStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates.
     * Flow: copy assigned colours and order, assign palette positions to new node ids, then update the store only when a colour was added.
     */
    ensureColors: (nodeIds) => {
      if (nodeIds.length === 0) return;
      set((state) => {
        for (const id of nodeIds) {
          if (!id || state.colors[id]) continue;
          const palettePos = state.assignmentOrder.length % AUTO_ASSIGN_PALETTE.length;
          state.colors[id] = AUTO_ASSIGN_PALETTE[palettePos]!;
          state.assignmentOrder.push(id);
        }
      });
    },

    /** Writes an assigned colour directly for workspace/sidebar or promoted temp updates. */
    /** Consumed by: useNodeColorsStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
    setColor: (nodeId, color) => {
      if (!nodeId) return;
      set((state) => {
        state.colors[nodeId] = color;
        if (!state.assignmentOrder.includes(nodeId)) state.assignmentOrder.push(nodeId);
      });
    },

    /** Seeds per-tab temporary colours for analysis selections before the user runs the tool. */
    /**
     * Consumed by: useNodeColorsStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates.
     * Flow: copy tab temps, build the visible-colour avoidance set, reuse non-conflicting assigned colours, or choose an available palette colour.
     */
    ensureTempColors: (tabKey, nodeIds) => {
      if (!tabKey || nodeIds.length === 0) return;
      set((state) => {
        const tabTemps = state.temps[tabKey] ?? (state.temps[tabKey] = {});
        const visible = new Set<string>();
        for (const id of nodeIds) {
          if (tabTemps[id]) visible.add(tabTemps[id]);
        }
        for (const id of nodeIds) {
          if (!id || tabTemps[id]) continue;
          const assigned = state.colors[id];
          let chosen: string;
          if (assigned && !visible.has(assigned)) {
            chosen = assigned;
          } else {
            chosen = pickRandomPaletteAvoiding(visible);
          }
          tabTemps[id] = chosen;
          visible.add(chosen);
        }
      });
    },

    /** Stores a manual colour override in the tab-local temp layer. */
    /** Consumed by: useNodeColorsStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
    setTempColor: (tabKey, nodeId, color) => {
      if (!tabKey || !nodeId) return;
      set((state) => {
        const tabTemps = state.temps[tabKey] ?? (state.temps[tabKey] = {});
        tabTemps[nodeId] = color;
      });
    },

    /** Clears tab-local temp colours when selections leave the analysis tab. */
    /**
     * Consumed by: useNodeColorsStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates.
     * Flow: drop the whole tab layer when no ids are supplied, otherwise delete requested temp ids and keep state unchanged when nothing moved.
     */
    clearTempColors: (tabKey, nodeIds) => {
      if (!tabKey) return;
      set((state) => {
        const tabTemps = state.temps[tabKey];
        if (!tabTemps) return;
        if (!nodeIds) {
          Reflect.deleteProperty(state.temps, tabKey);
          return;
        }
        for (const id of nodeIds) {
          Reflect.deleteProperty(tabTemps, id);
        }
      });
    },

    /** Commits temp colours into assigned graph/sidebar colours after an analysis run. */
    /**
     * Consumed by: useNodeColorsStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates.
     * Flow: read tab-local temp colours, copy promoted colours into assigned state/order, then clear the promoted temp entries.
     */
    promoteTempColors: (tabKey, nodeIds) => {
      if (!tabKey || nodeIds.length === 0) return;
      set((state) => {
        const tabTemps = state.temps[tabKey];
        if (!tabTemps) return;
        for (const id of nodeIds) {
          const temp = tabTemps[id];
          if (!temp) continue;
      state.colors[id] = temp;
      if (!state.assignmentOrder.includes(id)) state.assignmentOrder.push(id);
      Reflect.deleteProperty(tabTemps, id);
        }
      });
    },

    /** Rehydrates assigned colours from workspace persistence without touching session temp previews. */
    /** Consumed by: useNodeColorsStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
    hydrateColors: (next) => {
      set((state) => {
        state.colors = { ...next };
        state.assignmentOrder = Object.keys(next);
      });
    },

    /** Removes colour metadata for nodes no longer present in the latest workspace graph. */
    /**
     * Consumed by: useNodeColorsStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates.
     * Flow: build the live-node set, sweep assigned colours, assignment order, and tab temps, then update only the layers that changed.
     */
    pruneStaleColors: (activeNodeIds) => {
      set((state) => {
        const alive = new Set(activeNodeIds);

        for (const id of Object.keys(state.colors)) {
          if (!alive.has(id)) Reflect.deleteProperty(state.colors, id);
        }

        for (let i = state.assignmentOrder.length - 1; i >= 0; i--) {
          const id = state.assignmentOrder[i];
          if (id && !alive.has(id)) state.assignmentOrder.splice(i, 1);
        }

        for (const tabKey of Object.keys(state.temps)) {
          const tabTemps = state.temps[tabKey];
          if (!tabTemps) continue;
          for (const id of Object.keys(tabTemps)) {
            if (!alive.has(id)) Reflect.deleteProperty(tabTemps, id);
          }
        }
      });
    },

    /** Clears all assigned and temporary colours for tests and workspace reset flows. */
    /** Consumed by: useNodeColorsStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
    reset: () =>
      set((state) => {
        state.colors = {};
        state.assignmentOrder = [];
        state.temps = {};
      }),
  })),
);
