import { useState } from 'react';

import type { RowDetailPayload } from './RowDetailPanel';

/**
 * Owns the open/payload pair for analysis tables that share RowDetailPanel but
 * need feature-local click handlers.
 * Used by: workspace and preprocessing tables plus Concordance/Quotation row-detail hooks.
 * Flow: store the clicked row payload, open the shared panel, and expose its
 * controlled open state to the rendering owner.
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
