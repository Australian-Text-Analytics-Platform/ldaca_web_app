import { useState } from 'react';

import type { RowDetailPayload } from './RowDetailPanel';

export function useRowDetailDialog() {
  const [detailPayload, setDetailPayload] = useState<RowDetailPayload | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

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
