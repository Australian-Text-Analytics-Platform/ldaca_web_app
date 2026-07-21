import { useEffect, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';

interface RenameInputProps {
  column: string;
  disabled: boolean;
  onSubmit: (column: string, value: string) => void;
  onCancel: () => void;
}

/**
 * Provides the inline editor opened from a column's settings menu.
 */
export function RenameInput({ column, disabled, onSubmit, onCancel }: RenameInputProps) {
  const [draft, setDraft] = useState(column);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <Input
      ref={inputRef}
      value={draft}
      disabled={disabled}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={() => {
        if (!disabled) onSubmit(column, draft);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (!disabled) onSubmit(column, draft);
        } else if (event.key === 'Escape') {
          onCancel();
        }
      }}
      className="h-7 w-40 truncate text-xs"
      aria-label={`Rename column ${column}`}
    />
  );
}
