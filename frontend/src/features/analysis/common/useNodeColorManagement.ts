import { useEffect, useMemo } from 'react';
import { useNodeColorsStore } from '@/stores/nodeColorsStore';
import { EXTENDED_PALETTE } from './palette';

export interface UseNodeColorManagementConfig {
  activeNodeIds: string[];
  /** Informational only — kept for backwards compatibility with call sites
   * that still pass a palette. The actual stored colours are always drawn
   * from EXTENDED_PALETTE so per-node colour identity is consistent across
   * every analysis tab + Export. The picker swatches return the unified
   * palette regardless of what's passed here. */
  palette?: string[];
}

export interface UseNodeColorManagementReturn {
  /** Full nodeId → colour map from the global store. Subscribed reactively
   * — any tab calling ``setColor`` triggers a re-render in every other tab
   * showing the same node. */
  nodeColors: Record<string, string>;
  /** Pin a manual colour override to a node. Surfaces in every tab. */
  handleColorChange: (nodeId: string, color: string) => void;
  /** Palette exposed to the picker swatches. Always EXTENDED_PALETTE so
   * picker UI is consistent across tabs. */
  defaultPalette: string[];
}

/**
 * Subscribes a tab to the global node-colour store and ensures that every
 * active node has a stable picked-colour.
 *
 * Returns the same API as before, so call sites don't need to change. The
 * difference: there is no per-tab useState anymore — every tab + Export
 * shares one ``Record<nodeId, color>`` map. Selecting the same node in two
 * tabs produces the same colour; reselecting a previously-seen node
 * restores its prior colour rather than re-rolling.
 */
export function useNodeColorManagement(
  config: UseNodeColorManagementConfig,
): UseNodeColorManagementReturn {
  const { activeNodeIds } = config;
  const colors = useNodeColorsStore((state) => state.colors);
  const ensureColors = useNodeColorsStore((state) => state.ensureColors);
  const setColor = useNodeColorsStore((state) => state.setColor);

  // Stable key so we don't re-fire ensureColors on every render when the
  // caller hands us a freshly-built array of the same ids.
  const idsKey = useMemo(() => activeNodeIds.join('|'), [activeNodeIds]);

  useEffect(() => {
    ensureColors(activeNodeIds);
    // ``ensureColors`` is a stable reference from zustand; ``idsKey`` is
    // the deduped fingerprint — re-running on activeNodeIds object identity
    // would cause unnecessary churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, ensureColors]);

  return {
    nodeColors: colors,
    handleColorChange: setColor,
    defaultPalette: EXTENDED_PALETTE,
  };
}
