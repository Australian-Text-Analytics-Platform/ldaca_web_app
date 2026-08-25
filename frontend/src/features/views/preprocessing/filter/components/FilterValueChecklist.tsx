import React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

type FilterChecklistValue = string | number | boolean | null;

export interface FilterChecklistOption {
  key: string;
  value: FilterChecklistValue;
  label: string;
  isNull?: boolean;
  count?: string;
}

const formatCount = (count: string): string => BigInt(count).toLocaleString();

interface FilterValueChecklistProps {
  idPrefix: string;
  options: FilterChecklistOption[];
  selectedKeys: Set<string>;
  disabled: boolean;
  loading: boolean;
  error: string | null;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onToggleOption: (option: FilterChecklistOption, checked: boolean) => void;
  onSelectAll: (visibleOptions: FilterChecklistOption[]) => void;
  onClearAll: () => void;
  hasNext: boolean;
  onLoadMore?: () => void;
  onRetry?: () => void;
}

/**
 * Renders searchable categorical/list-string filter values. The filter hook
 * uses this component when a condition operator needs multi-value selection
 * backed by backend-provided unique values.
 * Rendered by `FilterConditionValueInput` for categorical condition values.
 * Flow: filter and rank option labels by search query, render select-all/null/value checkboxes,
 * and emit value arrays that preserve backend primitive types.
 */
export function FilterValueChecklist({
  idPrefix,
  options,
  selectedKeys,
  disabled,
  loading,
  error,
  searchQuery,
  onSearchQueryChange,
  onToggleOption,
  onSelectAll,
  onClearAll,
  hasNext,
  onLoadMore,
  onRetry,
}: FilterValueChecklistProps) {
  const filteredOptions = options;

  return (
    <div className="flex flex-col gap-2">
      <Input
        type="text"
        value={searchQuery}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
          onSearchQueryChange(event.target.value);
        }}
        disabled={disabled}
        placeholder="Search values (supports * and ?)"
        className="h-8 text-body"
        aria-label="Filter checklist values"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || loading || filteredOptions.length === 0}
          onClick={() => {
            onSelectAll(filteredOptions);
          }}
        >
          Select loaded
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || (selectedKeys.size === 0 && !loading)}
          onClick={onClearAll}
        >
          Clear
        </Button>
        {error && onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={disabled}>
            Retry
          </Button>
        )}
      </div>

      {loading && options.length === 0 ? (
        <div className="flex items-center gap-2 text-body text-description">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading categories…</span>
        </div>
      ) : error ? (
        <div className="rounded-md border border-error/40 bg-error/10 px-3 py-2 text-label-secondary text-error">
          Failed to load categories: {error}
        </div>
      ) : (
        <div
          className="max-h-48 overflow-y-auto rounded-md border border-surface-border/60 bg-editor px-3 py-2"
          onScroll={(event) => {
            const target = event.currentTarget;
            if (
              hasNext &&
              !loading &&
              target.scrollHeight - target.scrollTop - target.clientHeight < 24
            ) {
              onLoadMore?.();
            }
          }}
        >
          {filteredOptions.length === 0 ? (
            <div className="text-label-secondary text-description">
              {options.length === 0 ? 'No categories available.' : 'No matching categories found.'}
            </div>
          ) : (
            filteredOptions.map((option) => {
              const checked = selectedKeys.has(option.key);
              return (
                <label
                  key={option.key}
                  className={`flex items-center gap-2 py-1 text-body ${
                    option.isNull ? 'text-warning' : 'text-foreground'
                  }`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(next: boolean | 'indeterminate') => {
                      onToggleOption(option, next === true);
                    }}
                    disabled={disabled}
                    id={`${idPrefix}-${option.key}`}
                  />
                  <span
                    className={`min-w-0 truncate ${option.isNull ? 'font-medium' : ''}`}
                    title={option.isNull ? 'Null (no value)' : option.label}
                  >
                    {option.isNull ? 'Null (no value)' : option.label}
                  </span>
                  {option.count !== undefined ? (
                    <span className="shrink-0 text-label-secondary tabular-nums text-description">
                      (count: {formatCount(option.count)})
                    </span>
                  ) : null}
                </label>
              );
            })
          )}
          {loading && options.length > 0 ? (
            <div className="flex items-center gap-2 py-2 text-label-secondary text-description">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Loading more…</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
