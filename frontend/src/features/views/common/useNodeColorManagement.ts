import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNodeColorsStore } from '@/stores/nodeColorsStore';
import { EXTENDED_PALETTE } from './palette';

export interface UseNodeColorManagementConfig {
  activeNodeIds: string[];
  /** Pass an analytics-tab identifier (typically the matching
   * ``ViewType``) to route this hook through the per-tab **temp** layer
   * instead of writing directly to the global assigned store. With
   * ``tabKey`` set:
   *   - active nodeIds get a tentative temp colour on selection
   *     (``ensureTempColors``);
   *   - manual picks via ``handleColorChange`` write to the temp;
   *   - the returned ``nodeColors`` overlays temps on top of assigned
   *     so the tab's UI shows the preview;
   *   - leaving a node off the active list clears its temp so a
   *     reselection rolls a fresh one;
   *   - ``promoteTempColors`` is the action the tab's Run handler
   *     calls to commit the pending temps to the assigned store.
   * Omit for non-analytics callers (Export, sidebar / graph) which
   * should reflect only the assigned colours. */
  tabKey?: string;
}

export interface UseNodeColorManagementReturn {
  nodeColors: Record<string, string>;
  handleColorChange: (nodeId: string, color: string) => void;
  defaultPalette: string[];
  /** No-op for non-analytics callers; commits the current tab's temp
   * colours to the assigned store for the given nodeIds. Call from
   * the tab's Run / Apply / Search handler. */
  promoteTempColors: (nodeIds: string[]) => void;
}

/**
 * Subscribes a tab to the global node-colour store.
 *
 * Without ``tabKey``: reads + writes the assigned store directly. Used
 * by Export and any caller that wants the colour to take effect
 * immediately.
 *
 * With ``tabKey``: routes through the per-tab temp layer. The user's
 * picker changes become previews that the graph/sidebar do not yet
 * see; on Run the temp promotes to assigned and the rest of the UI
 * catches up.
 * Used by: analysis tabs and ExportFeature when rendering per-node colour state because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
 * Flow: read caller config, derive local analysis state, call store/API helpers as needed, then return state and handlers to the feature.
 */
export function useNodeColorManagement(
  config: UseNodeColorManagementConfig,
): UseNodeColorManagementReturn {
  const { activeNodeIds, tabKey } = config;
  const assignedColors = useNodeColorsStore((state) => state.colors);
  /* eslint-disable @typescript-eslint/unbound-method -- Zustand store actions are this-free and selected by reference for stable identity */
  const ensureColors = useNodeColorsStore((state) => state.ensureColors);
  const setColor = useNodeColorsStore((state) => state.setColor);
  const tabTemps = useNodeColorsStore((state) => (tabKey ? (state.temps[tabKey] ?? null) : null));
  const ensureTempColors = useNodeColorsStore((state) => state.ensureTempColors);
  const setTempColor = useNodeColorsStore((state) => state.setTempColor);
  const clearTempColors = useNodeColorsStore((state) => state.clearTempColors);
  const promoteTempColorsAction = useNodeColorsStore((state) => state.promoteTempColors);
  /* eslint-enable @typescript-eslint/unbound-method */

  // Stable key so we don't re-fire the ensure/clear effects on every
  // render when the caller hands us a freshly-built array of the same
  // ids.
  const idsKey = useMemo(() => activeNodeIds.join('|'), [activeNodeIds]);

  // Ensure colours / temps for the active IDs whenever the active set changes.
  useEffect(() => {
    if (tabKey) {
      ensureTempColors(tabKey, activeNodeIds);
    } else {
      ensureColors(activeNodeIds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, tabKey, ensureColors, ensureTempColors]);

  // Track the previous activeNodeIds set for tabKey'd callers so we
  // can clear temps for nodes that left the active window. The fade
  // semantic per the strategy doc: "When a temp fades — when the node
  // is deselected within the tab."
  const prevIdsRef = useRef<string[]>([]);
  useEffect(() => {
    if (!tabKey) {
      prevIdsRef.current = [...activeNodeIds];
      return;
    }
    const prev = prevIdsRef.current;
    const dropped = prev.filter((id) => !activeNodeIds.includes(id));
    if (dropped.length > 0) clearTempColors(tabKey, dropped);
    prevIdsRef.current = [...activeNodeIds];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, tabKey, clearTempColors]);

  // Tab view: temps overlay assigned. Non-tab callers see just
  // assigned (existing behaviour).
  const nodeColors = useMemo<Record<string, string>>(() => {
    if (!tabKey || !tabTemps) return assignedColors;
    return { ...assignedColors, ...tabTemps };
  }, [tabKey, assignedColors, tabTemps]);

  const handleColorChange = useCallback(
    (nodeId: string, color: string) => {
      if (tabKey) {
        setTempColor(tabKey, nodeId, color);
      } else {
        setColor(nodeId, color);
      }
    },
    [tabKey, setColor, setTempColor],
  );

  const promoteTempColors = useCallback(
    (nodeIds: string[]) => {
      if (!tabKey || nodeIds.length === 0) return;
      promoteTempColorsAction(tabKey, nodeIds);
    },
    [tabKey, promoteTempColorsAction],
  );

  return {
    nodeColors,
    handleColorChange,
    defaultPalette: EXTENDED_PALETTE,
    promoteTempColors,
  };
}
