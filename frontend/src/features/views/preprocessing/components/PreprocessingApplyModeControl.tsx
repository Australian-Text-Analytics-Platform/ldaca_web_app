import { Button } from '@/components/ui/button';
import type { PreprocessingApplyMode } from '../preprocessingApplyMode';

interface PreprocessingApplyModeControlProps {
  value: PreprocessingApplyMode;
  onChange: (value: PreprocessingApplyMode) => void;
}

/**
 * Selects whether an eligible preprocessing result creates a derived Data
 * Block or updates the selected Data Block.
 */
export function PreprocessingApplyModeControl({
  value,
  onChange,
}: PreprocessingApplyModeControlProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-body font-medium text-foreground">Apply result as</span>
      <div
        role="group"
        aria-label="Apply result as"
        className="inline-flex rounded-md border border-input-border bg-editor p-0.5"
      >
        <Button
          type="button"
          size="sm"
          variant={value === 'create' ? 'secondary' : 'ghost'}
          aria-pressed={value === 'create'}
          className="rounded-sm shadow-none"
          onClick={() => {
            onChange('create');
          }}
        >
          Create new Data Block
        </Button>
        <Button
          type="button"
          size="sm"
          variant={value === 'update' ? 'secondary' : 'ghost'}
          aria-pressed={value === 'update'}
          className="rounded-sm shadow-none"
          onClick={() => {
            onChange('update');
          }}
        >
          Update selected Data Block
        </Button>
      </div>
    </div>
  );
}
