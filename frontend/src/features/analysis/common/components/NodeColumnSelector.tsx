import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
 * Renders the shared column selector used by analysis parameter panels, including
 * preserved lock values and disabled-reason tooltips.
 * Used by: NodeSelectionPanel and feature-specific column selection controls because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
 * Flow: normalize incoming props, derive display state, connect event handlers, then render the shared analysis UI.
 */
export const NodeColumnSelector: React.FC<NodeColumnSelectorProps> = ({
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
      <DisabledReasonTooltip reason={disabled ? disabledReason : undefined} className="w-full">
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
      </DisabledReasonTooltip>
    </div>
  );
};

export default NodeColumnSelector;
