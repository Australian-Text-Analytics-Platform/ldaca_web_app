import React from 'react';

type Props = {
  matchedTexts: string[];
  matchedTextColors: Record<string, string>;
  hiddenMatchedTexts: Set<string>;
  onToggle: (text: string) => void;
};

const DEFAULT_COLOR = '#0284c7';

export const ConcordanceDispersionLegend: React.FC<Props> = ({
  matchedTexts,
  matchedTextColors,
  hiddenMatchedTexts,
  onToggle,
}) => {
  if (matchedTexts.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 py-2">
      {matchedTexts.map((text) => {
        const color = matchedTextColors[text] ?? DEFAULT_COLOR;
        const isHidden = hiddenMatchedTexts.has(text);
        return (
          <button
            key={text}
            type="button"
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-0.5 transition-opacity hover:bg-muted/60"
            style={{ opacity: isHidden ? 0.4 : 1 }}
            onClick={() => onToggle(text)}
            aria-pressed={!isHidden}
            aria-label={isHidden ? `Show ${text}` : `Hide ${text}`}
          >
            <div className="h-4 w-0.5 rounded-full" style={{ backgroundColor: color }} />
            <span
              className="text-sm font-medium text-muted-foreground"
              style={{ textDecoration: isHidden ? 'line-through' : 'none' }}
            >
              {text}
            </span>
          </button>
        );
      })}
    </div>
  );
};
