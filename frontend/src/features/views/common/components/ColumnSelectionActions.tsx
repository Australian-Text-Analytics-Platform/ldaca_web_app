import { Button } from '@/components/ui/button';

interface Props {
  sourceName: string;
  onSelectAll: () => void;
  onSelectNone: () => void;
}

/** Per-source bulk actions for optional Add to Workspace columns. */
export function ColumnSelectionActions({ sourceName, onSelectAll, onSelectNone }: Props) {
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        aria-label={`Select all for ${sourceName}`}
        onClick={onSelectAll}
      >
        Select all
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        aria-label={`Select none for ${sourceName}`}
        onClick={onSelectNone}
      >
        Select none
      </Button>
    </div>
  );
}
