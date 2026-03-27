import React from 'react';

import type { ConcordanceGroupedRow } from '../../../../api/text';
import { CONCORDANCE_COLUMN_KEYS } from '../../generatedColumns';

type Props = {
  hits: ConcordanceGroupedRow;
  textLength?: number;
  barWidthPercent?: number;
};

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

export const ConcordanceDispersionCell: React.FC<Props> = ({
  hits,
  textLength,
  barWidthPercent = 100,
}) => {
  const fallbackLength = hits.reduce((max, hit) => {
    const endIndex = getNumericIndex(hit[CONCORDANCE_COLUMN_KEYS.endIdx]);
    return endIndex === null ? max : Math.max(max, endIndex);
  }, 0);
  const domain = Math.max(textLength ?? 0, fallbackLength, 1);
  const widthPercent = Math.max(0, Math.min(barWidthPercent, 100));

  return (
    <div className="w-full">
      <div
        className="relative h-6 overflow-hidden rounded-sm bg-slate-100"
        data-testid="concordance-dispersion-bar"
        style={{ width: `${widthPercent}%` }}
      >
        <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-slate-300" />
        {hits.map((hit, index) => {
          const startIndex = getNumericIndex(hit[CONCORDANCE_COLUMN_KEYS.startIdx]);
          if (startIndex === null) {
            return null;
          }
          const leftPercent = Math.min(100, (startIndex / domain) * 100);
          return (
            <span
              key={`${startIndex}-${index}`}
              className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-600"
              style={{ left: `${leftPercent}%` }}
            />
          );
        })}
      </div>
    </div>
  );
};