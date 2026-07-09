/**
 * Pure text-clipping helpers for the quotation feature. Pulled out of
 * QuotationFeature.tsx so the feature component doesn't carry ~150 lines
 * of word-boundary maths in its module scope.
 */

export const DEFAULT_CONTEXT_LENGTH = 5;
export const MAX_CONTEXT_LENGTH = 2000;

// Normalizes user context preferences to the bounded word window accepted by clipping helpers.
/**
 * Used by: QuotationFeature context controls because user-entered context length must stay within the clipping helper's supported word window.
 */
export const clampContextLength = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_CONTEXT_LENGTH;
  return Math.max(0, Math.min(MAX_CONTEXT_LENGTH, Math.floor(value)));
};

export interface HighlightSpan {
  start: number;
  end: number;
  types: string[];
}

export interface ContextClipResult {
  text: string;
  spans: HighlightSpan[];
  prefixEllipsis: boolean;
  suffixEllipsis: boolean;
  sliceStart: number;
  sliceEnd: number;
}

/**
 * Trim `text` to a window around the union of `spans`, keeping
 * `surroundingWords` of context on each side. Returns the clipped text,
 * spans re-projected into the new coordinate system, ellipsis flags,
 * and the (sliceStart, sliceEnd) bounds of the clip in the original text.
 */
/**
 * Used by: QuotationHighlightedCell because highlighted snippets need spans re-projected after clipping around the matched text window.
 * Flow: clamp context words, find word boundaries around the span range, slice text, shift spans, and report ellipsis bounds.
 */
export const clipTextAroundSpans = (
  text: string,
  spans: HighlightSpan[],
  surroundingWords: number,
): ContextClipResult => {
  const normalizedWords = Number.isFinite(surroundingWords)
    ? Math.max(0, Math.floor(surroundingWords))
    : 0;

  if (!text || !spans.length) {
    return {
      text,
      spans: spans.map((span) => ({ ...span })),
      prefixEllipsis: false,
      suffixEllipsis: false,
      sliceStart: 0,
      sliceEnd: text.length,
    };
  }

  const earliestStart = Math.max(0, Math.min(...spans.map((s) => s.start)));
  const latestEnd = Math.min(text.length, Math.max(...spans.map((s) => s.end)));

  if (
    !Number.isFinite(earliestStart) ||
    !Number.isFinite(latestEnd) ||
    earliestStart >= latestEnd
  ) {
    return {
      text,
      spans: spans.map((span) => ({ ...span })),
      prefixEllipsis: false,
      suffixEllipsis: false,
      sliceStart: 0,
      sliceEnd: text.length,
    };
  }

  const regex = /\S+/g;
  const words: { start: number; end: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    words.push({ start: match.index, end: match.index + match[0].length });
  }

  // Reprojects original span coordinates into the clipped text window consumed by renderers.
  const projectSpans = (sliceStart: number, sliceEnd: number) =>
    spans
      .map((span) => {
        const start = Math.max(span.start, sliceStart);
        const end = Math.min(span.end, sliceEnd);
        if (end <= start) return null;
        return { ...span, start: start - sliceStart, end: end - sliceStart };
      })
      .filter((span): span is HighlightSpan => Boolean(span));

  if (!words.length) {
    const sliceStart = earliestStart;
    const sliceEnd = latestEnd;
    return {
      text: text.slice(sliceStart, sliceEnd),
      spans: projectSpans(sliceStart, sliceEnd),
      prefixEllipsis: sliceStart > 0,
      suffixEllipsis: sliceEnd < text.length,
      sliceStart,
      sliceEnd,
    };
  }

  // Finds the word containing or immediately before a span start boundary.
  const findWordIndexBeforeOrAt = (pos: number) => {
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (!word) continue;
      if (pos < word.start) {
        return Math.max(0, i - 1);
      }
      if (pos <= word.end) {
        return i;
      }
    }
    return words.length - 1;
  };

  // Finds the word containing or immediately after a span end boundary.
  const findWordIndexAfterOrAt = (pos: number) => {
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (!word) continue;
      if (pos <= word.end) {
        return i;
      }
      if (pos < word.start) {
        return i;
      }
    }
    return words.length - 1;
  };

  const startWordIdx = findWordIndexBeforeOrAt(earliestStart);
  const lastCharIndex = Math.max(0, latestEnd - 1);
  const endWordIdx = findWordIndexAfterOrAt(lastCharIndex);

  const clipStartIdx = Math.max(0, startWordIdx - normalizedWords);
  const clipEndIdx = Math.min(words.length - 1, endWordIdx + normalizedWords);

  let sliceStart = words[clipStartIdx]?.start ?? 0;
  let sliceEnd = words[clipEndIdx]?.end ?? text.length;

  if (!Number.isFinite(sliceStart) || !Number.isFinite(sliceEnd) || sliceEnd <= sliceStart) {
    sliceStart = 0;
    sliceEnd = text.length;
  }

  return {
    text: text.slice(sliceStart, sliceEnd),
    spans: projectSpans(sliceStart, sliceEnd),
    prefixEllipsis: sliceStart > 0,
    suffixEllipsis: sliceEnd < text.length,
    sliceStart,
    sliceEnd,
  };
};
