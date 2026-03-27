import type { ConcordanceGroupedRow, ConcordanceHitRow } from '../../../api/text';
import {
  CONCORDANCE_COLUMN_KEYS,
  CONCORDANCE_CORE_COLUMNS,
} from '../generatedColumns';

export type ConcordanceDispersionRow = Record<string, unknown> & {
  CONC_dispersion: ConcordanceGroupedRow;
};

const CORE_COLUMN_SET = new Set<string>(CONCORDANCE_CORE_COLUMNS);

const getNumericIndex = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : Math.max(0, parsed);
  }
  return null;
};

export function flattenConcordanceGroups(groups: ConcordanceGroupedRow[]): ConcordanceHitRow[] {
  return groups.flatMap((group) => group);
}

export function buildDispersionRows(groups: ConcordanceGroupedRow[]): ConcordanceDispersionRow[] {
  return groups.flatMap((group) => {
    if (group.length === 0) {
      return [];
    }

    const firstHit = group[0];
    const metadataEntries = Object.entries(firstHit).filter(([key]) => !CORE_COLUMN_SET.has(key));
    return [
      {
        ...Object.fromEntries(metadataEntries),
        [CONCORDANCE_COLUMN_KEYS.dispersion]: group,
      },
    ];
  });
}

export function getDispersionHits(row: Record<string, unknown>): ConcordanceGroupedRow {
  return row[CONCORDANCE_COLUMN_KEYS.dispersion] as ConcordanceGroupedRow;
}

export function getDispersionTextLength(row: Record<string, unknown>, textColumn: string): number {
  const textValue = row[textColumn];
  if (typeof textValue === 'string') {
    return textValue.length;
  }

  return getDispersionHits(row).reduce((max, hit) => {
    const endIndex = getNumericIndex(hit[CONCORDANCE_COLUMN_KEYS.endIdx]);
    return endIndex === null ? max : Math.max(max, endIndex);
  }, 0);
}

export function getDispersionBarWidthPercent(
  row: Record<string, unknown>,
  textColumn: string,
  longestTextLength: number,
): number {
  if (longestTextLength <= 0) {
    return 100;
  }

  const textLength = getDispersionTextLength(row, textColumn);
  if (textLength <= 0) {
    return 0;
  }

  return Math.min(100, (textLength / longestTextLength) * 100);
}