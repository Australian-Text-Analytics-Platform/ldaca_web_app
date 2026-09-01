import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DateTimePickerField } from '../../utils/dateTimeUtils';
import { ISO_PLACEHOLDER } from '../../utils/dateTimeHelpers';
import { getOperatorsForField } from '../../utils/typeUtils';
import type { ConditionColumnOption, ConditionRange, FilterConditionWithId } from '../../types';
import {
  isArrowBooleanField,
  isArrowDictionaryField,
  isArrowFloatField,
  isArrowIntegerField,
  isArrowStringListField,
  isArrowTemporalField,
} from '@/lib/arrow/arrowTable';
import { isTopicCoverageField } from '@/lib/arrow/semanticTypes';
import { FilterValueChecklist, type FilterChecklistOption } from './FilterValueChecklist';
import {
  getCategoricalOptionKey,
  toCategoricalPrimitive,
  type CategoricalPrimitive,
} from '../utils/categoricalOptions';
import { useFilterCategoricalOptionQuery } from '../hooks/useFilterCategoricalOptionQuery';

type OnConditionChange = <Key extends keyof FilterConditionWithId>(
  id: string,
  field: Key,
  value: FilterConditionWithId[Key],
) => void;

interface FilterConditionValueInputProps {
  condition: FilterConditionWithId;
  disabled: boolean;
  hasSelection: boolean;
  workspaceId: string | null;
  nodeId: string | null;
  columnOption?: ConditionColumnOption;
  optionSearchQueries: Record<string, string>;
  onOptionSearchQueryChange: (conditionId: string, query: string) => void;
  onConditionChange: OnConditionChange;
}

/**
 * Renders the value editor for one Filter condition row.
 * Rendered by: useFilterSubTabSections through ConditionBuilder's
 * `renderValueInput` slot so the hook owns data/state while this component
 * owns branchy form controls for dictionary, Topic Coverage, datetime,
 * boolean, numeric, and text conditions.
 * Flow: choose the editor from the decoded Arrow field, translate user input into
 * `FilterConditionWithId.value`, and delegate lazy categorical retries/search
 * back to the hook-owned option loader.
 */
export function FilterConditionValueInput({
  condition,
  disabled,
  hasSelection,
  workspaceId,
  nodeId,
  columnOption,
  optionSearchQueries,
  onOptionSearchQueryChange,
  onConditionChange,
}: FilterConditionValueInputProps) {
  const field = condition.field;
  const searchQuery = optionSearchQueries[condition.id] ?? '';
  const optionState = useFilterCategoricalOptionQuery({
    workspaceId,
    nodeId,
    column: condition.column,
    searchQuery,
    columnOption,
  });

  if (disabled) {
    return (
      <input
        type="text"
        // condition.value is a primitive in this branch; String() coerces it.
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        value={condition.operator === 'between' ? '' : String(condition.value ?? '')}
        disabled
        placeholder={hasSelection ? 'Select a column' : 'Select a data block to configure filters'}
        className="flex-1 rounded-md border border-surface-border/70 bg-panel px-2 py-1 text-body text-description"
      />
    );
  }

  if (isTopicCoverageField(field)) {
    // Topic Coverage extension: render [Topic] [operator] [coverage %].
    // The generic operator select is hidden in the parent ConditionBuilder so
    // the topic dropdown can sit before the operator here.
    const current =
      condition.value && typeof condition.value === 'object' && 'topic_id' in condition.value
        ? condition.value
        : { topic_id: 0, threshold: 0.05 };
    const patch = (next: Partial<{ topic_id: number; threshold: number }>) => {
      onConditionChange(condition.id, 'value', { ...current, ...next });
    };

    const topicIds = optionState.options
      .map((opt) => Number(opt.value))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    const operatorOptions = getOperatorsForField(field);

    return (
      <div className="flex flex-1 flex-wrap items-center gap-1.5">
        <Select
          value={String(current.topic_id)}
          onValueChange={(value) => {
            patch({ topic_id: Number(value) });
          }}
          disabled={topicIds.length === 0}
        >
          <SelectTrigger className="w-32" aria-label="Topic">
            <SelectValue placeholder={optionState.loading ? 'Loading...' : 'Topic'} />
          </SelectTrigger>
          <SelectContent>
            {topicIds.map((topicId) => (
              <SelectItem key={topicId} value={String(topicId)}>
                Topic {topicId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={condition.operator}
          onValueChange={(value) => {
            onConditionChange(condition.id, 'operator', value as FilterConditionWithId['operator']);
          }}
          disabled={disabled}
        >
          <SelectTrigger className="w-20" aria-label="Comparison operator">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {operatorOptions.map((operator) => (
              <SelectItem key={operator.value} value={operator.value}>
                {operator.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          aria-label="Proportion percentage"
          // current.threshold comes from form state and may be missing at runtime.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          value={Math.round((current.threshold ?? 0) * 100)}
          onChange={(event) => {
            const percentage = Math.min(100, Math.max(0, Number(event.target.value) || 0));
            patch({ threshold: percentage / 100 });
          }}
          className="w-20 rounded-md border border-input-border px-2 py-1 text-right text-body text-foreground"
          disabled={disabled}
        />
        <span className="text-body text-description">%</span>
      </div>
    );
  }

  if (field && (isArrowDictionaryField(field) || isArrowStringListField(field))) {
    const column = condition.column;
    const optionEntries = optionState.options;
    const selectedValues = Array.isArray(condition.value)
      ? (condition.value as unknown[]).map(toCategoricalPrimitive)
      : [];
    const selectedKeys = new Set(selectedValues.map((entry) => getCategoricalOptionKey(entry)));
    const isLoadingOptions = optionState.loading;
    const optionError = optionState.error;

    /**
     * Writes checklist selections back into the condition value field.
     * Called by: FilterValueChecklist selection controls because the parent
     * form state stores selected backend primitive values, not checklist keys.
     */
    const updateSelections = (nextSelections: CategoricalPrimitive[]) => {
      onConditionChange(condition.id, 'value', nextSelections);
    };

    /**
     * Toggles one categorical/list-string option in the condition value.
     * Called by: FilterValueChecklist row checkboxes.
     */
    const toggleValue = (entry: FilterChecklistOption, nextChecked: boolean) => {
      if (nextChecked) {
        if (selectedKeys.has(entry.key)) return;
        updateSelections([...selectedValues, toCategoricalPrimitive(entry.value)]);
      } else {
        updateSelections(
          selectedValues.filter((current) => getCategoricalOptionKey(current) !== entry.key),
        );
      }
    };

    /**
     * Selects all loaded options for the current checklist condition.
     * Called by: FilterValueChecklist's select-all button when no search query
     * is active.
     */
    const handleSelectAll = () => {
      updateSelections(optionEntries.map((entry) => entry.value));
    };

    /**
     * Adds only the currently visible search results to the selection.
     * Called by: FilterValueChecklist's filtered select-all mode.
     */
    const handleSelectVisible = (visibleOptions: FilterChecklistOption[]) => {
      const merged = new Map<string, CategoricalPrimitive>(
        selectedValues.map((entry) => [getCategoricalOptionKey(entry), entry]),
      );
      visibleOptions.forEach((entry) => {
        merged.set(entry.key, toCategoricalPrimitive(entry.value));
      });
      updateSelections(Array.from(merged.values()));
    };

    /** Clears all selected values for the current checklist condition. */
    const handleClearAll = () => {
      updateSelections([]);
    };

    const onSelectAllForMode =
      searchQuery.trim().length > 0
        ? handleSelectVisible
        : () => {
            handleSelectAll();
          };

    return (
      <FilterValueChecklist
        idPrefix={condition.id}
        options={optionEntries}
        selectedKeys={selectedKeys}
        disabled={disabled}
        loading={isLoadingOptions}
        error={optionError}
        searchQuery={searchQuery}
        onSearchQueryChange={(query) => {
          onOptionSearchQueryChange(condition.id, query);
        }}
        onToggleOption={toggleValue}
        onSelectAll={onSelectAllForMode}
        onClearAll={handleClearAll}
        hasNext={optionState.hasNext}
        onLoadMore={
          column
            ? () => {
                void optionState.loadMore();
              }
            : undefined
        }
        onRetry={
          column
            ? () => {
                void optionState.retry();
              }
            : undefined
        }
      />
    );
  }

  if (field && isArrowBooleanField(field)) {
    return (
      <Select
        // condition.value is a boolean in this branch; String() coerces it.
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        value={String(condition.value)}
        onValueChange={(value) => {
          onConditionChange(condition.id, 'value', value === 'true');
        }}
        disabled={disabled}
      >
        <SelectTrigger className="flex-1">
          <SelectValue placeholder="Select value" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">True</SelectItem>
          <SelectItem value="false">False</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (field && isArrowTemporalField(field)) {
    if (condition.operator === 'between') {
      const rangeValue: ConditionRange =
        condition.value && typeof condition.value === 'object' && 'start' in condition.value
          ? condition.value
          : { start: null, end: null };
      const startStr =
        typeof rangeValue.start === 'string'
          ? rangeValue.start
          : rangeValue.start instanceof Date
            ? rangeValue.start.toISOString()
            : '';
      const endStr =
        typeof rangeValue.end === 'string'
          ? rangeValue.end
          : rangeValue.end instanceof Date
            ? rangeValue.end.toISOString()
            : '';
      return (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-none">
            <DateTimePickerField
              value={startStr}
              onChange={(value) => {
                onConditionChange(condition.id, 'value', {
                  start: value,
                  end: rangeValue.end ?? null,
                });
              }}
              placeholder={ISO_PLACEHOLDER}
            />
          </div>
          <div className="flex-none">
            <DateTimePickerField
              value={endStr}
              onChange={(value) => {
                onConditionChange(condition.id, 'value', {
                  start: rangeValue.start ?? null,
                  end: value,
                });
              }}
              placeholder={ISO_PLACEHOLDER}
            />
          </div>
        </div>
      );
    }
    const singleVal =
      typeof condition.value === 'string'
        ? condition.value
        : condition.value instanceof Date
          ? condition.value.toISOString()
          : '';
    return (
      <DateTimePickerField
        value={singleVal}
        onChange={(value) => {
          onConditionChange(condition.id, 'value', value);
        }}
        placeholder={ISO_PLACEHOLDER}
      />
    );
  }

  if (field && (isArrowIntegerField(field) || isArrowFloatField(field))) {
    const integer = isArrowIntegerField(field);
    return (
      <input
        type="number"
        step={integer ? '1' : 'any'}
        // condition.value is a primitive in this branch; String() coerces it.
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        value={condition.value === null ? '' : String(condition.value)}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === '') {
            onConditionChange(condition.id, 'value', '');
            return;
          }
          const parsed = integer ? parseInt(raw, 10) : parseFloat(raw);
          onConditionChange(condition.id, 'value', Number.isNaN(parsed) ? '' : parsed);
        }}
        placeholder="Enter number"
        className="flex-1 rounded-md border border-input-border px-2 py-1 text-body text-foreground"
        disabled={disabled}
      />
    );
  }

  return (
    <input
      type="text"
      // condition.value is a primitive in this branch; String() coerces it.
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      value={String(condition.value)}
      onChange={(event) => {
        onConditionChange(condition.id, 'value', event.target.value);
      }}
      placeholder="Enter value"
      className="flex-1 rounded-md border border-input-border px-2 py-1 text-body text-foreground"
      disabled={disabled}
    />
  );
}
