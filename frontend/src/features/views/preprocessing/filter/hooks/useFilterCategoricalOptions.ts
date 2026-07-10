import { useCallback, useEffect, useRef, useState } from 'react';
import { getColumnUniqueValues } from '@/api';
import {
  buildCategoricalOptionEntries,
  type CategoricalOptionsByKey,
} from '../utils/categoricalOptions';
import type { FilterConditionWithId } from '../../types';

interface UseFilterCategoricalOptionsParams {
  currentWorkspaceId: string | null;
  selectedNodeId: string | null;
  conditions: FilterConditionWithId[];
}

interface UseFilterCategoricalOptionsResult {
  categoricalOptions: CategoricalOptionsByKey;
  optionSearchQueries: Record<string, string>;
  getCategoricalKey: (column: string) => string;
  ensureCategoricalOptions: (column: string, dataType: string) => Promise<void>;
  setOptionSearchQuery: (conditionId: string, query: string) => void;
  resetOptionSearchQuery: (conditionId: string) => void;
  removeOptionSearchQuery: (conditionId: string) => void;
}

const CHECKLIST_DATA_TYPES = new Set(['categorical', 'list[string]', 'tmdist']);

const usesChecklistOptions = (dataType: string | undefined): dataType is string =>
  Boolean(dataType && CHECKLIST_DATA_TYPES.has(dataType));

/**
 * Owns lazy categorical/list/topic option state for the Filter sub-tab.
 * Used by: useFilterSubTabSections so the main hook can edit conditions and
 * apply filters without also carrying checklist option cache, search query,
 * and auto-loading state.
 * Flow: key option cache by workspace/node/column, reset cache on selection
 * changes, fetch unique values on demand, and auto-load options for existing
 * checklist-backed conditions.
 */
export function useFilterCategoricalOptions({
  currentWorkspaceId,
  selectedNodeId,
  conditions,
}: UseFilterCategoricalOptionsParams): UseFilterCategoricalOptionsResult {
  const [categoricalOptions, setCategoricalOptions] = useState<CategoricalOptionsByKey>({});
  const [optionSearchQueries, setOptionSearchQueries] = useState<Record<string, string>>({});
  const categoricalOptionsRef = useRef(categoricalOptions);
  categoricalOptionsRef.current = categoricalOptions;

  /** Keys cached categorical options by workspace, node, and column. */
  const getCategoricalKey = useCallback(
    (column: string) => `${currentWorkspaceId ?? 'none'}::${selectedNodeId ?? 'none'}::${column}`,
    [currentWorkspaceId, selectedNodeId],
  );

  /**
   * Loads categorical/list-string values on demand for checklist conditions.
   * Condition changes and retry buttons call this to populate option state.
   */
  const ensureCategoricalOptions = useCallback(
    async (column: string, dataType: string) => {
      if (!currentWorkspaceId || !selectedNodeId || !column) {
        return;
      }

      const key = getCategoricalKey(column);
      setCategoricalOptions((prev) => {
        const existing = prev[key];
        if (existing?.loading) {
          return prev;
        }
        return {
          ...prev,
          [key]: {
            options: existing?.options ?? [],
            hasNull: existing?.hasNull ?? false,
            loading: true,
            error: null,
          },
        };
      });

      try {
        const { data: response } = await getColumnUniqueValues({
          path: { workspace_id: currentWorkspaceId, column_name: column, node_id: selectedNodeId },
          throwOnError: true,
        });
        // response is the typed API body; guard defensively against a null payload.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        const rawValues: unknown[] = Array.isArray(response?.unique_values)
          ? response.unique_values
          : [];
        const includeNullOption = dataType === 'categorical';
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        const hasNullFromResponse = includeNullOption && response?.has_null;
        const optionList = buildCategoricalOptionEntries(rawValues, hasNullFromResponse);

        setCategoricalOptions((prev) => ({
          ...prev,
          [key]: {
            options: optionList,
            hasNull: hasNullFromResponse,
            loading: false,
            error: null,
          },
        }));
      } catch (error) {
        setCategoricalOptions((prev) => ({
          ...prev,
          [key]: {
            options: [],
            hasNull: false,
            loading: false,
            error: error instanceof Error ? error.message : 'Failed to load categories',
          },
        }));
      }
    },
    [getCategoricalKey, currentWorkspaceId, selectedNodeId],
  );

  useEffect(() => {
    setCategoricalOptions({});
    setOptionSearchQueries({});
  }, [currentWorkspaceId, selectedNodeId]);

  useEffect(() => {
    if (!currentWorkspaceId || !selectedNodeId) {
      return;
    }

    conditions.forEach((condition) => {
      if (usesChecklistOptions(condition.dataType) && condition.column) {
        const key = getCategoricalKey(condition.column);
        if (!categoricalOptionsRef.current[key]) {
          void ensureCategoricalOptions(condition.column, condition.dataType);
        }
      }
    });
  }, [conditions, currentWorkspaceId, selectedNodeId, getCategoricalKey, ensureCategoricalOptions]);

  const setOptionSearchQuery = (conditionId: string, query: string) => {
    setOptionSearchQueries((prev) => ({ ...prev, [conditionId]: query }));
  };

  const resetOptionSearchQuery = (conditionId: string) => {
    setOptionSearchQueries((prev) => ({ ...prev, [conditionId]: '' }));
  };

  const removeOptionSearchQuery = (conditionId: string) => {
    setOptionSearchQueries((prev) => {
      const { [conditionId]: _, ...next } = prev;
      return next;
    });
  };

  return {
    categoricalOptions,
    optionSearchQueries,
    getCategoricalKey,
    ensureCategoricalOptions,
    setOptionSearchQuery,
    resetOptionSearchQuery,
    removeOptionSearchQuery,
  };
}
