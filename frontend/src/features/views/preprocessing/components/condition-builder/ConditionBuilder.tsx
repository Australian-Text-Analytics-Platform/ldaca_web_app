import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { type ConditionColumnOption } from '../../types';

export interface ConditionBuilderItem {
  id: string;
  column: string;
  operator: string;
  dataType?: string;
  [key: string]: unknown;
}

export interface ConditionBuilderProps<Condition extends ConditionBuilderItem> {
  title?: React.ReactNode;
  description?: string;
  conditions: Condition[];
  availableColumns: ConditionColumnOption[];
  logic: 'and' | 'or';
  onLogicChange: (logic: 'and' | 'or') => void;
  onAddCondition: () => void;
  onRemoveCondition: (id: string) => void;
  onConditionChange: <Key extends keyof Condition>(
    id: string,
    field: Key,
    value: Condition[Key],
  ) => void;
  disabled?: boolean;
  hasSelection: boolean;
  isSchemaLoading?: boolean;
  noSelectionMessage?: string;
  schemaLoadingMessage?: string;
  noSchemaMessage?: string;
  renderValueInput: (condition: Condition, disabled: boolean) => React.ReactNode;
  renderConditionMetadata?: (condition: Condition, disabled: boolean) => React.ReactNode;
  shouldHideOperatorSelect?: (condition: Condition) => boolean;
  getOperatorOptions: (condition: Condition) => Array<{ value: string; label: string }>;
  getColumnHintId?: (condition: Condition, index: number) => string | undefined;
}

const defaultMessages = {
  noSelection: 'Select a data block to configure conditions.',
  schemaLoading: 'Retrieving column metadata…',
  noSchema: 'No schema information is available yet for this data block.',
};

/**
 * Shared condition-editor UI for preprocessing filters. Filter sub-tab hooks
 * supply typed condition state and renderer callbacks so this component can
 * stay generic across condition value types.
 * Rendered by: useFilterSubTabSections hook, FilterSubTab module, index component (rg call sites/imports) because the parent needs this component boundary to keep feature controls and state presentation isolated.
 * Flow: render each condition row through caller-provided renderers, wire add/remove/change
 * controls, and keep AND/OR logic selection above the condition list.
 */
export function ConditionBuilder<Condition extends ConditionBuilderItem>(
  props: ConditionBuilderProps<Condition>,
) {
  const {
    title = 'Conditions',
    description = 'Define column and operator pairs.',
    conditions,
    availableColumns,
    logic,
    onLogicChange,
    onAddCondition,
    onRemoveCondition,
    onConditionChange,
    disabled = false,
    hasSelection,
    isSchemaLoading = false,
    noSelectionMessage = defaultMessages.noSelection,
    schemaLoadingMessage = defaultMessages.schemaLoading,
    noSchemaMessage = defaultMessages.noSchema,
    renderValueInput,
    renderConditionMetadata,
    shouldHideOperatorSelect,
    getOperatorOptions,
    getColumnHintId,
  } = props;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-base font-semibold text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          {conditions.length > 1 && (
            <Select
              value={logic}
              onValueChange={(value) => onLogicChange(value as 'and' | 'or')}
              disabled={disabled}
            >
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="and">AND</SelectItem>
                <SelectItem value="or">OR</SelectItem>
              </SelectContent>
            </Select>
          )}
          <DisabledReasonTooltip
            reason={
              disabled
                ? !hasSelection
                  ? 'Select a data block first'
                  : 'Column information is unavailable for this data block'
                : undefined
            }
          >
            <Button onClick={onAddCondition} disabled={disabled} size="sm">
              Add condition
            </Button>
          </DisabledReasonTooltip>
        </div>
      </div>

      {!hasSelection ? (
        <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 p-4 text-sm text-muted-foreground">
          {noSelectionMessage}
        </div>
      ) : isSchemaLoading ? (
        <div className="rounded-md border border-dashed border-amber-400/60 bg-amber-100/70 p-4 text-sm text-amber-900">
          {schemaLoadingMessage}
        </div>
      ) : !availableColumns.length ? (
        <div className="rounded-md border border-dashed border-amber-400/60 bg-amber-100/70 p-4 text-sm text-amber-900">
          {noSchemaMessage}
        </div>
      ) : (
        <div className="space-y-3">
          {conditions.map((condition, index) => {
            const rowDisabled = disabled || !condition.column;
            const operatorOptions = getOperatorOptions(condition);
            const hideOperator = shouldHideOperatorSelect?.(condition) ?? false;

            return (
              <div
                key={condition.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3 md:flex-row md:items-center md:gap-3"
              >
                <div className="flex flex-1 flex-col gap-2">
                  <div className="flex items-center gap-2">
                    {index > 0 && (
                      <span className="w-20 text-center text-xs font-semibold uppercase text-muted-foreground">
                        {logic.toUpperCase()}
                      </span>
                    )}
                    {renderConditionMetadata?.(condition, rowDisabled)}
                  </div>

                  <div className="flex flex-1 flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-x-3 md:gap-y-2">
                    <Select
                      value={condition.column}
                      onValueChange={(value) =>
                        onConditionChange(
                          condition.id,
                          'column',
                          value as Condition[keyof Condition],
                        )
                      }
                      disabled={disabled}
                    >
                      <SelectTrigger
                        className="min-w-40 grow"
                        data-hint-id={getColumnHintId?.(condition, index)}
                        data-filter-column-empty={condition.column ? 'false' : 'true'}
                      >
                        <SelectValue placeholder="Select column" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableColumns.map((col) => (
                          <SelectItem key={col.name} value={col.name}>
                            {col.label ?? col.name} ({col.dataType})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {!hideOperator && (
                      <Select
                        value={condition.operator}
                        onValueChange={(value) =>
                          onConditionChange(
                            condition.id,
                            'operator',
                            value as Condition[keyof Condition],
                          )
                        }
                        disabled={rowDisabled}
                      >
                        <SelectTrigger className="w-36 flex-none">
                          <SelectValue
                            placeholder={
                              !condition.column ? 'Select a column first' : 'Select operator'
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {operatorOptions.map((op) => (
                            <SelectItem key={op.value} value={op.value}>
                              {op.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                    {condition.operator !== 'is_null' && (
                      <div className="flex-1 md:flex-auto md:min-w-[28ch] md:max-w-full">
                        {renderValueInput(condition, rowDisabled)}
                      </div>
                    )}
                  </div>
                </div>

                {conditions.length > 1 && (
                  <Button
                    onClick={() => onRemoveCondition(condition.id)}
                    variant="ghost"
                    size="sm"
                    type="button"
                    disabled={disabled}
                  >
                    Remove
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
