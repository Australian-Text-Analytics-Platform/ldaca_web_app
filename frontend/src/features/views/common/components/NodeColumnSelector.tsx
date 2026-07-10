import React from 'react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { cn } from '@/lib/utils';

export interface NodeColumnSelectorProps {
  columns: string[];
  value?: string;
  onChange: (value: string) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  /** Tooltip shown on hover when the selector is disabled. */
  disabledReason?: string;
  placeholder?: string;
  clearOptionValue?: string;
  clearOptionLabel?: React.ReactNode;
  noColumnsMessage?: React.ReactNode;
  preserveValue?: string;
  className?: string;
  triggerClassName?: string;
  labelClassName?: string;
}

/**
 * Renders the shared column selector used by analysis parameter panels,
 * including disabled-reason tooltips for unavailable controls.
 * Used by: node input/selection panels and feature-specific column selection controls.
 */
export function NodeColumnSelector({
  columns,
  value,
  onChange,
  label,
  disabled,
  disabledReason,
  placeholder = 'Select column',
  clearOptionValue,
  clearOptionLabel = 'Select column…',
  noColumnsMessage = 'No columns available for this data block',
  preserveValue,
  className,
  triggerClassName,
  labelClassName,
}: NodeColumnSelectorProps) {
  const triggerAriaLabel = typeof label === 'string' ? label : undefined;

  if (!columns.length) {
    return (
      <div className={cn('space-y-1', className)}>
        {label && (
          <span className={cn('block text-xs font-medium text-muted-foreground', labelClassName)}>
            {label}
          </span>
        )}
        <DisabledReasonTooltip reason={disabledReason} className="w-full">
          <Select value="" onValueChange={onChange} disabled>
            <SelectTrigger
              aria-label={triggerAriaLabel}
              className={cn('w-full text-sm', triggerClassName)}
            >
              <SelectValue placeholder={noColumnsMessage} />
            </SelectTrigger>
          </Select>
        </DisabledReasonTooltip>
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
        <span className={cn('block text-xs font-medium text-muted-foreground', labelClassName)}>
          {label}
        </span>
      )}
      <DisabledReasonTooltip reason={disabled ? disabledReason : undefined} className="w-full">
        <Select value={value} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger
            aria-label={triggerAriaLabel}
            className={cn('w-full text-sm', triggerClassName)}
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {clearOptionValue && (
                <SelectItem key={clearOptionValue} value={clearOptionValue}>
                  {clearOptionLabel}
                </SelectItem>
              )}
              {optionValues.map((column) => (
                <SelectItem key={column} value={column}>
                  {column}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </DisabledReasonTooltip>
    </div>
  );
}
