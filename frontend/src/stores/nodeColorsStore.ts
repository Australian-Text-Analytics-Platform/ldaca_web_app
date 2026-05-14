/**
 * Cross-tab stable colour assignment for workspace nodes.
 *
 * Pre-store, each analysis tab ran its own `useColorStackAllocator` +
 * `useState` instance via `useNodeColorManagement`, so the same node could
 * appear as e.g. blue in Concordance and red in Topic Modelling. Worse,
 * Token Frequency passed its own ``TOKEN_FREQUENCY_PALETTE`` (Tailwind
 * 500 shades, intentionally lighter for chart legibility) into the same
 * hook, which leaked into the data-block name display and caused the
 * "Frequency selector colour looks lighter" complaint.
 *
 * This store is the single source of truth:
 *   - one global `Record<nodeId, color>` map, shared by every tab + Export;
 *   - one global palette (EXTENDED_PALETTE) so the picker swatches and the
 *     auto-assigned colours match everywhere;
 *   - first-seen assignment order is stable for the session, so reselecting
 *     a previously-seen node restores the same colour;
 *   - manual picks (NodeColorPicker) write through to the same store so
 *     the override surfaces in every tab immediately.
 */
import { create } from 'zustand';
import { EXTENDED_PALETTE } from '@/features/analysis/common/palette';

interface NodeColorsState {
  /** nodeId → hex colour. Persists for the session; never cleared by tab
   * changes or selection toggles so a deselect/reselect (or a switch
   * to a different analysis tab) shows the same colour. */
  colors: Record<string, string>;
  /** Order in which nodeIds were first assigned a colour. Used to derive
   * the palette index for the next-new node so assignments stay stable
   * across re-renders. */
  assignmentOrder: string[];
  /** Idempotent — assigns palette colours to any nodeIds that don't yet
   * have one, leaving existing entries untouched. Call from a tab's
   * `useEffect` whenever its active node set changes. */
  ensureColors(nodeIds: string[]): void;
  /** Manual override path — called by NodeColorPicker. Pinned overrides
   * win over palette auto-assignment going forward. */
  setColor(nodeId: string, color: string): void;
  /** Test helper / future workspace-reset path. Not wired up anywhere
   * yet but keeps the store self-contained. */
  reset(): void;
}

export const useNodeColorsStore = create<NodeColorsState>((set, get) => ({
  colors: {},
  assignmentOrder: [],
  ensureColors: (nodeIds) => {
    if (nodeIds.length === 0) return;
    const { colors, assignmentOrder } = get();
    const updatedColors = { ...colors };
    const updatedOrder = [...assignmentOrder];
    let mutated = false;
    for (const id of nodeIds) {
      if (!id || updatedColors[id]) continue;
      const palettePos = updatedOrder.length % EXTENDED_PALETTE.length;
      updatedColors[id] = EXTENDED_PALETTE[palettePos]!;
      updatedOrder.push(id);
      mutated = true;
    }
    if (mutated) set({ colors: updatedColors, assignmentOrder: updatedOrder });
  },
  setColor: (nodeId, color) => {
    if (!nodeId) return;
    set((state) => {
      const nextOrder = state.assignmentOrder.includes(nodeId)
        ? state.assignmentOrder
        : [...state.assignmentOrder, nodeId];
      return {
        colors: { ...state.colors, [nodeId]: color },
        assignmentOrder: nextOrder,
      };
    });
  },
  reset: () => set({ colors: {}, assignmentOrder: [] }),
}));
