import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { FilterOperator } from '../types';

const FILTER_OPS: { value: FilterOperator; label: string }[] = [
  { value: 'contains', label: 'Contains' },
  { value: 'eq', label: 'Equals' },
  { value: 'startswith', label: 'Starts with' },
  { value: 'endswith', label: 'Ends with' },
];

interface ColumnFilterFormProps {
  column: string;
  currentOp: FilterOperator;
  currentValue: string;
  onApply: (column: string, value: string, op: FilterOperator) => void;
  onClear: (column: string) => void;
}

/**
 * Filter editor rendered inside the workspace-table column settings
 * dropdown sub-menu. Auto-focuses the value input on mount; clicks/keys
 * are stopped from propagating so the dropdown doesn't close mid-edit.
 * Rendered by: WorkspaceColumnHeader component.
 * Why: because column headers need a focused filter form that translates user input into the server filter model.
 * Flow: local input state mirrors the active filter, then Apply/Clear callbacks update the server filter state.
 */
export function ColumnFilterForm({
  column,
  currentOp,
  currentValue,
  onApply,
  onClear,
}: ColumnFilterFormProps) {
  const [op, setOp] = useState<FilterOperator>(currentOp);
  const [value, setValue] = useState(currentValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      className="flex flex-col gap-2 p-2"
      onClick={(e) => {
        e.stopPropagation();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
      }}
    >
      <span className="text-xs font-medium text-muted-foreground">Filter &quot;{column}&quot;</span>
      <select
        value={op}
        onChange={(e) => {
          setOp(e.target.value as FilterOperator);
        }}
        className="h-7 rounded-md border border-input bg-background px-2 text-xs"
      >
        {FILTER_OPS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
        }}
        placeholder="Value..."
        className="h-7 text-xs"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onApply(column, value, op);
          }
        }}
      />
      <div className="flex gap-1">
        <Button
          size="sm"
          className="h-6 flex-1 text-xs"
          onClick={() => {
            onApply(column, value, op);
          }}
        >
          Apply
        </Button>
        {currentValue && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs"
            onClick={() => {
              onClear(column);
            }}
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
