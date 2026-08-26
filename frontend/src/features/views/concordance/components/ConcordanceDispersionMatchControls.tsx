import { useId } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';

export interface ConcordanceDispersionLegendItem {
  key: string;
  color: string;
  matchedTexts: string[];
  hidden: boolean;
  countLabel: string;
}

interface Props {
  items: readonly ConcordanceDispersionLegendItem[];
  uncasedMatchedTexts: boolean;
  onUncasedMatchedTextsChange?: (value: boolean) => void;
  onToggleMatchedTexts?: (matchedTexts: readonly string[]) => void;
}

/** Shared term controls for both the dispersion table and its plot. */
export function ConcordanceDispersionMatchControls({
  items,
  uncasedMatchedTexts,
  onUncasedMatchedTextsChange,
  onToggleMatchedTexts,
}: Props) {
  const controlId = useId();

  return (
    <Card data-testid="concordance-dispersion-match-controls">
      <CardContent className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 text-body text-description">
        <div
          role="group"
          aria-label="Matched terms"
          className="flex flex-wrap items-center gap-3 text-label-secondary text-description"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`flex items-center gap-2 rounded-sm px-1 py-0.5 ${
                item.hidden ? 'opacity-50 line-through' : ''
              }`}
              disabled={!onToggleMatchedTexts}
              aria-pressed={item.hidden}
              onClick={() => {
                onToggleMatchedTexts?.(item.matchedTexts);
              }}
            >
              <span
                className="inline-block h-0.5 w-5"
                style={{ backgroundColor: item.color }}
                aria-hidden="true"
              />
              <span>{item.countLabel}</span>
            </button>
          ))}
        </div>
        {onUncasedMatchedTextsChange ? (
          <label
            htmlFor={`${controlId}-uncased`}
            className="flex items-center gap-2 text-label-secondary text-foreground"
          >
            <Checkbox
              id={`${controlId}-uncased`}
              checked={uncasedMatchedTexts}
              onCheckedChange={(checked) => {
                onUncasedMatchedTextsChange(checked === true);
              }}
            />
            <span>Uncased</span>
          </label>
        ) : null}
      </CardContent>
    </Card>
  );
}
