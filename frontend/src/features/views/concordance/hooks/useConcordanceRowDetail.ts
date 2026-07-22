import { useState } from 'react';
import type { RowDetailPanelProps } from '../../common/components/RowDetailPanel';
import { useRowDetailDialog } from '../../common/components/useRowDetailDialog';
import { highlightMatchInText } from '../../common/components/highlightText';
import {
  CONCORDANCE_COLUMN_KEYS,
  CONCORDANCE_GENERATED_COLUMNS,
} from '../../common/generatedColumns';
import { toCellText } from '../concordanceTableDomain';

type ConcordanceGroupedRow = Record<string, unknown>[];

interface ConcordanceDetailExtra {
  concordanceHits: Record<string, unknown>[];
  caseSensitive: boolean;
}

interface Params {
  currentWorkspaceId: string | null;
  caseSensitive: boolean;
  searchWord: string;
}

interface Result {
  detailPayload: RowDetailPanelProps['payload'];
  detailOpen: boolean;
  setDetailOpen: (open: boolean) => void;
  concordanceCustomization: RowDetailPanelProps['customization'];
  handleRowClick: (
    row: Record<string, unknown>,
    nodeId: string,
    column: string,
    groupedHits?: ConcordanceGroupedRow,
  ) => void;
}

/**
 * Builds the Concordance-specific summary and highlight renderer for the shared
 * row-detail dialog.
 * Used by: useConcordanceRowDetail after a row click because the shared
 * RowDetailPanel only knows about generic row metadata, while Concordance needs
 * hit counts, keyword context, and document-text highlighting.
 */
function buildConcordanceCustomization(
  record: Record<string, unknown>,
  detailExtra: ConcordanceDetailExtra,
  searchWord: string,
): RowDetailPanelProps['customization'] {
  const { concordanceHits, caseSensitive } = detailExtra;
  const matchedTextValue = record[CONCORDANCE_COLUMN_KEYS.matchedText];

  return {
    label: 'Concordance',
    summaryFields: [
      {
        label: 'Search Word',
        value: searchWord,
        highlight: true,
      },
      {
        label: 'Matches',
        value: String(concordanceHits.length),
      },
      {
        label: 'L1 Word',
        value: toCellText(record[CONCORDANCE_COLUMN_KEYS.leftToken]),
      },
      ...(record[CONCORDANCE_COLUMN_KEYS.leftTokenFreq] != null
        ? [
            {
              label: 'L1 Freq',
              value: String(record[CONCORDANCE_COLUMN_KEYS.leftTokenFreq]),
            },
          ]
        : []),
      {
        label: 'R1 Word',
        value: toCellText(record[CONCORDANCE_COLUMN_KEYS.rightToken]),
      },
      ...(record[CONCORDANCE_COLUMN_KEYS.rightTokenFreq] != null
        ? [
            {
              label: 'R1 Freq',
              value: String(record[CONCORDANCE_COLUMN_KEYS.rightTokenFreq]),
            },
          ]
        : []),
    ],
    /** Highlights every concordance hit in the source document text. */
    // Called by: RowDetailPanel document rendering because Concordance row details need KWIC hit offsets applied to the original document text.
    renderDocumentText: (text: string) =>
      highlightMatchInText(
        text,
        concordanceHits.map((hit) => ({
          start: hit[CONCORDANCE_COLUMN_KEYS.startIdx],
          end: hit[CONCORDANCE_COLUMN_KEYS.endIdx],
        })),
        typeof matchedTextValue === 'string' && matchedTextValue.length > 0
          ? matchedTextValue
          : searchWord,
        caseSensitive,
      ),
  };
}

/**
 * Owns Concordance's row-detail click flow and customization state.
 * Used by: ConcordanceFeature so the feature shell can pass a single row-click
 * handler to result panels and render RowDetailPanel without carrying
 * Concordance-specific detail metadata inline.
 */
export function useConcordanceRowDetail({
  currentWorkspaceId,
  caseSensitive,
  searchWord,
}: Params): Result {
  const { detailPayload, detailOpen, setDetailOpen, openDetail } = useRowDetailDialog();
  const [detailExtra, setDetailExtra] = useState<ConcordanceDetailExtra | null>(null);

  const handleRowClick = (
    row: Record<string, unknown>,
    _nodeId: string,
    column: string,
    groupedHits?: ConcordanceGroupedRow,
  ) => {
    if (!currentWorkspaceId) return;

    const concordanceHits = groupedHits && groupedHits.length > 0 ? groupedHits : [row];
    const primaryRecord = concordanceHits[0] ?? row;
    const record = { ...primaryRecord };
    const rawFullText = record[column];
    const fullText =
      rawFullText === null || rawFullText === undefined ? undefined : toCellText(rawFullText);

    setDetailExtra({
      concordanceHits,
      caseSensitive: typeof row.case_sensitive === 'boolean' ? row.case_sensitive : caseSensitive,
    });

    openDetail({
      record,
      textColumn: column,
      fullText,
      excludeMetadataColumns: [...CONCORDANCE_GENERATED_COLUMNS],
    });
  };

  return {
    detailPayload,
    detailOpen,
    setDetailOpen,
    concordanceCustomization:
      detailPayload && detailExtra
        ? buildConcordanceCustomization(detailPayload.record, detailExtra, searchWord)
        : undefined,
    handleRowClick,
  };
}
