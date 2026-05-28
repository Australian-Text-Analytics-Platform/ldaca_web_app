import React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PAGE_SIZE_OPTIONS_DEFAULT } from '../constants';

interface Props {
  value: number;
  onChange: (next: number) => void;
  options?: ReadonlyArray<number>;
  label?: string;
  triggerClassName?: string;
  /** Wrapper class; defaults to a flex row that pushes the control to the right. */
  className?: string;
}

/**
 * "Documents per batch" page-size selector. Replaces the verbatim
 * `<span>Documents per batch</span><Select…/>` block previously duplicated in
 * concordance and quotation feature footers.
 * Used by: concordance and quotation parameter/result footers because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
   * Flow: derive display state, bind user actions, then render the analysis UI.
 */
export const PageSizeSelect: React.FC<Props> = ({
  value,
  onChange,
  options = PAGE_SIZE_OPTIONS_DEFAULT,
  label = 'Documents per batch',
  triggerClassName = 'h-9 w-20',
  className = 'ml-auto flex items-center gap-2',
}) => {
  return (
    <div className={className}>
      <span className="whitespace-nowrap text-sm text-muted-foreground">{label}</span>
      <Select value={String(value)} onValueChange={(val) => onChange(Number(val))}>
        <SelectTrigger className={triggerClassName}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start">
          {options.map((size) => (
            <SelectItem key={size} value={String(size)}>
              {size}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
