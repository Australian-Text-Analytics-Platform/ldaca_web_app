import type { RowDetailCustomization, RowDetailPayload } from '../common/components/RowDetailPanel';
import { highlightMatchInText } from '../common/components/highlightText';
import {
  CONCORDANCE_COLUMN_KEYS,
  CONCORDANCE_PRESENTATION_COLUMNS,
} from '../common/generatedColumns';
import { toCellText } from './concordanceTableDomain';

export interface ConcordanceRowDetailItem {
  row: Record<string, unknown>;
  nodeId: string;
  column: string;
  groupedHits?: Record<string, unknown>[];
}

/** Converts a displayed Concordance row into the shared detail payload. */
export function buildConcordanceRowDetailPayload(item: ConcordanceRowDetailItem): RowDetailPayload {
  const concordanceHits =
    item.groupedHits && item.groupedHits.length > 0 ? item.groupedHits : [item.row];
  const primaryRecord = concordanceHits[0] ?? item.row;
  const record = { ...primaryRecord };
  const rawFullText = record[item.column];
  return {
    record,
    textColumn: item.column,
    fullText:
      rawFullText === null || rawFullText === undefined ? undefined : toCellText(rawFullText),
    excludeMetadataColumns: [...CONCORDANCE_PRESENTATION_COLUMNS],
  };
}

/** Builds Concordance summaries and document highlighting for one selected row. */
export function buildConcordanceRowDetailCustomization(
  item: ConcordanceRowDetailItem,
  searchWord: string,
  fallbackCaseSensitive: boolean,
): RowDetailCustomization {
  const concordanceHits =
    item.groupedHits && item.groupedHits.length > 0 ? item.groupedHits : [item.row];
  const record = concordanceHits[0] ?? item.row;
  const matchedTextValue = record[CONCORDANCE_COLUMN_KEYS.matchedText];
  const caseSensitive =
    typeof item.row.case_sensitive === 'boolean' ? item.row.case_sensitive : fallbackCaseSensitive;

  return {
    label: 'Concordance',
    summaryFields: [
      { label: 'Search Word', value: searchWord, highlight: true },
      { label: 'Matches', value: String(concordanceHits.length) },
      { label: 'L1 Word', value: toCellText(record[CONCORDANCE_COLUMN_KEYS.leftToken]) },
      ...(record[CONCORDANCE_COLUMN_KEYS.leftTokenFreq] != null
        ? [
            {
              label: 'L1 Freq',
              value: String(record[CONCORDANCE_COLUMN_KEYS.leftTokenFreq]),
            },
          ]
        : []),
      { label: 'R1 Word', value: toCellText(record[CONCORDANCE_COLUMN_KEYS.rightToken]) },
      ...(record[CONCORDANCE_COLUMN_KEYS.rightTokenFreq] != null
        ? [
            {
              label: 'R1 Freq',
              value: String(record[CONCORDANCE_COLUMN_KEYS.rightTokenFreq]),
            },
          ]
        : []),
    ],
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
