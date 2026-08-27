import { useId } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FilterableSeriesLegend } from '../../common/components/FilterableSeriesLegend';

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
        <FilterableSeriesLegend
          items={items.map((item) => ({
            key: item.key,
            color: item.color,
            text: item.countLabel,
            label: item.countLabel,
            hidden: item.hidden,
          }))}
          ariaLabel="Matched terms"
          pressedWhenHidden
          className="flex flex-wrap items-center gap-3 text-label-secondary text-description"
          onToggle={
            onToggleMatchedTexts
              ? (key) => {
                  const item = items.find((candidate) => candidate.key === key);
                  if (item) onToggleMatchedTexts(item.matchedTexts);
                }
              : undefined
          }
        />
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
