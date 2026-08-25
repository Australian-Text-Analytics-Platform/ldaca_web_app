import React from 'react';
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select';
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
  clearOptionLabel?: string;
  noColumnsMessage?: React.ReactNode;
  preserveValue?: string;
  className?: string;
  triggerClassName?: string;
  labelClassName?: string;
}

/**
 * Renders the shared column selector used by analysis parameter panels,
 * including disabled-reason tooltips for unavailable controls.
 *
 * The option list is type-in filterable (substring, or `*`/`?` wildcards)
 * because tabular corpora routinely carry hundreds of columns, where a
 * scroll-only dropdown cannot be navigated.
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

  const heading = label && (
    <span className={cn('block text-label-secondary font-medium text-description', labelClassName)}>
      {label}
    </span>
  );

  if (!columns.length) {
    return (
      <div className={cn('space-y-1', className)}>
        {heading}
        <DisabledReasonTooltip reason={disabledReason} className="w-full">
          <SearchableSelect
            options={[]}
            onChange={onChange}
            disabled
            ariaLabel={triggerAriaLabel}
            placeholder={noColumnsMessage}
            triggerClassName={cn('text-body', triggerClassName)}
          />
        </DisabledReasonTooltip>
      </div>
    );
  }

  const optionValues = [...columns];
  // A saved column that no longer exists in the block stays selectable so the
  // panel can show what was configured rather than silently dropping it.
  if (preserveValue && preserveValue.length > 0 && !optionValues.includes(preserveValue)) {
    optionValues.push(preserveValue);
  }
  const options: SearchableSelectOption[] = optionValues.map((column) => ({ value: column }));

  return (
    <div className={cn('space-y-1', className)}>
      {heading}
      <DisabledReasonTooltip reason={disabled ? disabledReason : undefined} className="w-full">
        <SearchableSelect
          options={options}
          value={value}
          onChange={onChange}
          disabled={disabled}
          ariaLabel={triggerAriaLabel}
          placeholder={placeholder}
          searchPlaceholder="Filter columns… (* and ? wildcards)"
          emptyMessage="No matching columns"
          pinnedOptions={
            clearOptionValue ? [{ value: clearOptionValue, label: clearOptionLabel }] : undefined
          }
          triggerClassName={cn('text-body', triggerClassName)}
        />
      </DisabledReasonTooltip>
    </div>
  );
}
