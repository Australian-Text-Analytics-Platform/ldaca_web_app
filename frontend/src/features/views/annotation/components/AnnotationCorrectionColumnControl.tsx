import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const CREATE_CORRECTION_COLUMN = '__create_correction_column__';
const NO_CORRECTION_COLUMN = '__no_correction_column__';

interface AnnotationCorrectionColumnControlProps {
  value: string | null;
  /** Null while the source schema is still loading. */
  availableColumns: string[] | null;
  onValueChange: (column: string | null) => void;
  onCreate: () => void;
  onUseAsExample?: () => void;
  disabled?: boolean;
}

/** Selects the live Tab-owned correction column for an Annotation result table. */
export function AnnotationCorrectionColumnControl({
  value,
  availableColumns,
  onValueChange,
  onCreate,
  onUseAsExample,
  disabled = false,
}: AnnotationCorrectionColumnControlProps) {
  const columns = Array.from(new Set(availableColumns ?? []));
  const invalidValue = value !== null && availableColumns !== null && !columns.includes(value);
  const invalidValueRef = useRef<string | null>(null);

  useEffect(() => {
    if (!invalidValue) {
      if (value !== null) invalidValueRef.current = null;
      return;
    }
    if (invalidValueRef.current === value) return;
    invalidValueRef.current = value;
    onValueChange(null);
  }, [invalidValue, onValueChange, value]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={invalidValue ? NO_CORRECTION_COLUMN : (value ?? NO_CORRECTION_COLUMN)}
        disabled={disabled || availableColumns === null}
        onValueChange={(next) => {
          if (next === CREATE_CORRECTION_COLUMN) {
            onCreate();
            return;
          }
          onValueChange(next === NO_CORRECTION_COLUMN ? null : next);
        }}
      >
        <SelectTrigger aria-label="Correction column" className="h-8 w-auto min-w-36 text-sm">
          <span className="mr-1 text-muted-foreground">Correction:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          <SelectGroup>
            <SelectItem value={NO_CORRECTION_COLUMN}>None</SelectItem>
            <SelectItem value={CREATE_CORRECTION_COLUMN}>Create new…</SelectItem>
            {columns.map((column) => (
              <SelectItem key={column} value={column}>
                {column}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {onUseAsExample ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || invalidValue || value === null}
          onClick={onUseAsExample}
        >
          Use as example
        </Button>
      ) : null}
    </div>
  );
}
