import React from 'react';
import { usePreferencesStore } from '@/stores/preferencesStore';
import type { SnapshotToolKey } from '../types';

export interface SnapshotActionsProps {
  tool: SnapshotToolKey;
}

/**
 * Right-side slot in ``<AnalysisFeatureHeader>``. Renders the
 * Save/Load buttons for the demo-snapshot feature.
 *
 * Phase 0j scaffolds the gate-aware shell — returns ``null`` when
 * the demo-snapshot master switch is off, so no DOM is added.
 * Phase 1a/1b fills the slot with the actual Save dialog trigger
 * and the Load dialog button (the latter further gated on whether
 * any compatible snapshot exists for the given tool).
 */
export const SnapshotActions: React.FC<SnapshotActionsProps> = ({ tool }) => {
  const enabled = usePreferencesStore((s) => s.demoSnapshotsEnabled);
  if (!enabled) return null;
  // Phase 1 fills this in. Placeholder kept intentionally minimal so
  // shipping the master switch + shared header in Phase 0j adds no
  // user-visible UI yet — the gate proves out before the buttons land.
  void tool;
  return null;
};
