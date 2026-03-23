import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface NodeColumnSelectorProps {
  columns: string[];
  value?: string;
  onChange: (value: string) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  placeholder?: string;
  clearOptionValue?: string;
  clearOptionLabel?: React.ReactNode;
  noColumnsMessage?: React.ReactNode;
  preserveValue?: string;
  className?: string;
  triggerClassName?: string;
  labelClassName?: string;
}

export const NodeColumnSelector: React.FC<NodeColumnSelectorProps> = ({
  columns,
  value,
  onChange,
  label,
  disabled,
  placeholder = 'Select column',
  clearOptionValue,
  clearOptionLabel = 'Select column…',
  noColumnsMessage = 'No columns available for this data block',
  preserveValue,
  className,
  triggerClassName,
  labelClassName,
}) => {
  if (!columns.length) {
    return (
      <div className={cn('rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive', className)}>
        {noColumnsMessage}
      </div>
    );
  }

  const optionValues = [...columns];
  if (preserveValue && preserveValue.length > 0 && !optionValues.includes(preserveValue)) {
    optionValues.push(preserveValue);
  }

  return (
    <div className={cn('space-y-1', className)}>
      {label && (
        <span className={cn('block text-xs font-medium text-muted-foreground', labelClassName)}>{label}</span>
      )}
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className={cn('w-full text-sm', triggerClassName)}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {clearOptionValue && <SelectItem value={clearOptionValue}>{clearOptionLabel}</SelectItem>}
          {optionValues.map((column) => (
            <SelectItem key={column} value={column}>
              {column}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default NodeColumnSelector;
