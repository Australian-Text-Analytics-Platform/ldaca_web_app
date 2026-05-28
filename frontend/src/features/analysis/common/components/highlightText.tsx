import React from 'react';

/**
 * Highlight matching text regions given explicit start/end index ranges,
 * with an optional fallback plain-text search.
 * Used by: concordance row detail rendering because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
 * Flow: normalize incoming props, derive display state, connect event handlers, then render the shared analysis UI.
 */
export const highlightMatchInText = (
  textValue: string,
  ranges: Array<{ start: unknown; end: unknown }>,
  fallbackMatch?: string,
  fallbackCaseSensitive?: boolean,
): React.ReactNode => {
  if (typeof textValue !== 'string' || textValue.length === 0) {
    return textValue;
  }

  /** Called by: highlightMatchInText while normalizing backend match ranges because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
  const parseIndex = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.floor(value);
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number.parseInt(value, 10);
      return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
  };

  const normalizedRanges = ranges
    .map(({ start, end }) => {
      const startIdx = parseIndex(start);
      const endIdx = parseIndex(end);
      if (startIdx === null || endIdx === null || endIdx <= startIdx) {
        return null;
      }
      const safeStart = Math.max(0, Math.min(startIdx, textValue.length));
      const safeEnd = Math.max(safeStart, Math.min(endIdx, textValue.length));
      if (safeEnd <= safeStart) {
        return null;
      }
      return { start: safeStart, end: safeEnd };
    })
    .filter((range): range is { start: number; end: number } => Boolean(range))
    .sort((left, right) => left.start - right.start);

  if (normalizedRanges.length === 0 && fallbackMatch && fallbackMatch.length > 0) {
    const source = fallbackCaseSensitive ? textValue : textValue.toLowerCase();
    const needle = fallbackCaseSensitive ? fallbackMatch : fallbackMatch.toLowerCase();
    const fallbackIdx = source.indexOf(needle);
    if (fallbackIdx !== -1) {
      normalizedRanges.push({ start: fallbackIdx, end: fallbackIdx + needle.length });
    }
  }

  if (normalizedRanges.length === 0) {
    return textValue;
  }

  const mergedRanges: Array<{ start: number; end: number }> = [];
  normalizedRanges.forEach((range) => {
    const previous = mergedRanges[mergedRanges.length - 1];
    if (!previous || range.start > previous.end) {
      mergedRanges.push({ ...range });
      return;
    }
    previous.end = Math.max(previous.end, range.end);
  });

  const children: React.ReactNode[] = [];
  let cursor = 0;
  mergedRanges.forEach((range, index) => {
    if (cursor < range.start) {
      children.push(<React.Fragment key={`plain-${index}`}>{textValue.slice(cursor, range.start)}</React.Fragment>);
    }
    children.push(
      <mark key={`mark-${range.start}-${range.end}`} className="bg-yellow-200 text-gray-900 rounded px-1">
        {textValue.slice(range.start, range.end)}
      </mark>
    );
    cursor = range.end;
  });
  if (cursor < textValue.length) {
    children.push(<React.Fragment key="plain-tail">{textValue.slice(cursor)}</React.Fragment>);
  }

  return <>{children}</>;
};
