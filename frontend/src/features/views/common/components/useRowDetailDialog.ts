import { useState } from 'react';

import type { RowDetailPayload } from './RowDetailPanel';

/**
 * Owns the open/payload pair for analysis tables that share RowDetailPanel but
 * need feature-local click handlers.
 * Used by: analysis result tables that open RowDetailPanel from row clicks because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
 * Flow: read caller config, derive local analysis state, call store/API helpers as needed, then return state and handlers to the feature.
 */
export function useRowDetailDialog() {
  const [detailPayload, setDetailPayload] = useState<RowDetailPayload | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  /** Called by: table row click handlers returned through useRowDetailDialog. */
  const openDetail = (payload: RowDetailPayload) => {
    setDetailPayload(payload);
    setDetailOpen(true);
  };

  return {
    detailPayload,
    detailOpen,
    setDetailOpen,
    openDetail,
  };
}
