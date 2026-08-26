import type { ReactNode } from 'react';

import { RowDetailPanel } from '../../common/components/RowDetailPanel';
import { useRowDetailDialog } from '../../common/components/useRowDetailDialog';
import {
  buildConcordanceRowDetailCustomization,
  buildConcordanceRowDetailPayload,
  type ConcordanceRowDetailItem,
} from '../concordanceRowDetail';

interface ConcordanceRowDetailControllerProps {
  sequenceKey: string;
  items: ConcordanceRowDetailItem[];
  page: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  loading: boolean;
  error?: unknown;
  onPageChange: (page: number) => void;
  searchWord: string;
  caseSensitive: boolean;
  children: (openDetailAt: (index: number) => void) => ReactNode;
}

/** Keeps Concordance-specific detail rendering beside each paginated result card. */
export function ConcordanceRowDetailController({
  sequenceKey,
  items,
  page,
  hasPreviousPage,
  hasNextPage,
  loading,
  error,
  onPageChange,
  searchWord,
  caseSensitive,
  children,
}: ConcordanceRowDetailControllerProps) {
  const { detailPayload, selectedItem, detailOpen, setDetailOpen, openDetailAt, navigation } =
    useRowDetailDialog({
      sequenceKey,
      items,
      page,
      hasPreviousPage,
      hasNextPage,
      loading,
      error,
      onPageChange,
      toPayload: buildConcordanceRowDetailPayload,
    });
  const customization = selectedItem
    ? buildConcordanceRowDetailCustomization(selectedItem, searchWord, caseSensitive)
    : undefined;

  return (
    <>
      {children(openDetailAt)}
      <RowDetailPanel
        open={detailOpen}
        onOpenChange={setDetailOpen}
        payload={detailPayload}
        customization={customization}
        navigation={navigation}
      />
    </>
  );
}
