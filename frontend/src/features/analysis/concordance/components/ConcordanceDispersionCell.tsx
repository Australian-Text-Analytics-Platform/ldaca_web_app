import React from 'react';

import type { ConcordanceGroupedRow } from '../../../../api/text';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../../components/ui/tooltip';
import { CONCORDANCE_COLUMN_KEYS } from '../../generatedColumns';

type Props = {
  hits: ConcordanceGroupedRow;
  textLength?: number;
  barWidthPercent?: number;
  colourMatches?: boolean;
  matchedTextColors?: Record<string, string>;
  lowercaseMatches?: boolean;
  hiddenMatchedTexts?: Set<string>;
};

const DEFAULT_BAR_COLOR = '#0284c7';

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
  colourMatches = false,
  matchedTextColors,
  lowercaseMatches = false,
  hiddenMatchedTexts,
}) => {
  const fallbackLength = hits.reduce((max, hit) => {
    const endIndex = getNumericIndex(hit[CONCORDANCE_COLUMN_KEYS.endIdx]);
    return endIndex === null ? max : Math.max(max, endIndex);
  }, 0);
  const domain = Math.max(textLength ?? 0, fallbackLength, 1);
  const widthPercent = Math.max(0, Math.min(barWidthPercent, 100));

  return (
    <TooltipProvider delayDuration={120} skipDelayDuration={0}>
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
            const rawText = String(hit[CONCORDANCE_COLUMN_KEYS.matchedText] ?? '');
            const normalizedText = lowercaseMatches ? rawText.toLowerCase() : rawText;
            if (hiddenMatchedTexts?.has(normalizedText)) {
              return null;
            }
            const leftPercent = Math.min(100, (startIndex / domain) * 100);
            const barColor = colourMatches
              ? (matchedTextColors?.[normalizedText] ?? DEFAULT_BAR_COLOR)
              : undefined;
            const matchTextColor = barColor ?? DEFAULT_BAR_COLOR;
            const leftContext = String(hit[CONCORDANCE_COLUMN_KEYS.leftContext] ?? '');
            const rightContext = String(hit[CONCORDANCE_COLUMN_KEYS.rightContext] ?? '');
            return (
              <Tooltip key={`${startIndex}-${index}`}>
                <TooltipTrigger asChild>
                  <span
                    className="absolute top-0 h-full w-1.5 -translate-x-1/2 cursor-default"
                    style={{ left: `${leftPercent}%` }}
                  >
                    <span
                      className={`pointer-events-none absolute top-1/2 left-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full${barColor ? '' : ' bg-sky-600'}`}
                      style={barColor ? { backgroundColor: barColor } : undefined}
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="max-w-md whitespace-normal break-words border border-slate-200 bg-white px-3 py-2 text-xs text-black shadow-md"
                >
                  <span>{leftContext} </span>
                  <span style={{ color: matchTextColor, fontWeight: 600 }}>{rawText}</span>
                  <span> {rightContext}</span>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
};
