import { useEffect, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';

interface RenameInputProps {
  column: string;
  disabled: boolean;
  onSubmit: (column: string, value: string) => void;
  onCancel: () => void;
}

/**
 * Inline text input shown when the user picks "Rename" on a workspace-table
 * column. Auto-focuses + selects on mount, commits on blur or Enter, and
 * cancels on Escape.
 * Rendered by: WorkspaceColumnHeader component (rg call sites/imports).
 * Why: because column headers need inline rename editing without embedding form state in the full table component.
 * Flow: initialize the draft from the column, autofocus the input, then commit or cancel on blur and keys.
 */
export function RenameInput({ column, disabled, onSubmit, onCancel }: RenameInputProps) {
  const [draft, setDraft] = useState(column);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  return (
    <Input
      ref={inputRef}
      value={draft}
      disabled={disabled}
      onChange={(e) => { setDraft(e.target.value); }}
      onBlur={() => {
        if (!disabled) onSubmit(column, draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (!disabled) onSubmit(column, draft);
        } else if (e.key === 'Escape') {
          onCancel();
        }
      }}
      className="h-7 w-40 truncate text-xs"
      aria-label={`Rename column ${column}`}
    />
  );
}
