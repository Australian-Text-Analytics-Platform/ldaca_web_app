import { useId } from 'react';
import HelpIcon from '@/components/help/HelpIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Search } from 'lucide-react';

interface TokenFrequencyTokenFilterCardProps {
  value: string;
  onChange: (value: string) => void;
}

/** Result-level token filter shared by every Token Frequency result surface and export. */
export const TokenFrequencyTokenFilterCard = ({
  value,
  onChange,
}: TokenFrequencyTokenFilterCardProps) => {
  const inputId = useId();

  return (
    <div
      className="rounded-lg border border-surface-border/60 bg-panel/20 p-4"
      data-testid="token-frequency-token-filter-card"
    >
      <div
        className="flex flex-wrap items-center justify-between gap-3"
        data-testid="token-frequency-token-filter-card-content"
      >
        <div className="flex items-center gap-2">
          <Label htmlFor={inputId} className="font-semibold">
            Filter tokens
          </Label>
          <HelpIcon
            targetKey="analysis.token-frequency.token-filter"
            label="Token filter"
            tooltip="Filter every cloud, list, statistics table, and download by token. Use * as a wildcard (e.g. pre* or *ing)."
          />
        </div>
        <div className="flex min-w-0 flex-1 basis-80 items-center gap-2">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-description" />
          <Input
            id={inputId}
            placeholder="Filter tokens (use * as wildcard, e.g. pre* or *ing)"
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
          {value ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange('');
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
};
