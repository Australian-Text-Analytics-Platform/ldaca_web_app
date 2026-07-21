import { useCallback, useEffect, useRef, useState } from 'react';
import { DataType } from 'apache-arrow';
import { queryWorkspaceSqlTable, sqlGlobPattern, sqlIdentifier, sqlString, sqlTable } from '@/api';
import {
  buildCategoricalOptionEntries,
  type CategoricalOptionEntry,
  type CategoricalOptionsByKey,
} from '../utils/categoricalOptions';
import type { ConditionColumnOption, FilterConditionWithId } from '../../types';

interface UseFilterCategoricalOptionsParams {
  currentWorkspaceId: string | null;
  selectedNodeId: string | null;
  conditions: FilterConditionWithId[];
  columnOptions: ConditionColumnOption[];
}

interface UseFilterCategoricalOptionsResult {
  categoricalOptions: CategoricalOptionsByKey;
  optionSearchQueries: Record<string, string>;
  getCategoricalKey: (column: string) => string;
  ensureCategoricalOptions: (column: string, dataType: string) => Promise<void>;
  loadMoreCategoricalOptions: (column: string, dataType: string) => Promise<void>;
  setOptionSearchQuery: (conditionId: string, query: string) => void;
  resetOptionSearchQuery: (conditionId: string) => void;
  removeOptionSearchQuery: (conditionId: string) => void;
}

interface ChecklistSearchTarget {
  conditionId: string;
  column: string;
  dataType: string;
}

const CHECKLIST_DATA_TYPES = new Set(['categorical', 'string-list', 'topic-distribution']);
const CATEGORICAL_PAGE_SIZE = 500;

const usesChecklistOptions = (dataType: string | undefined): dataType is string =>
  Boolean(dataType && CHECKLIST_DATA_TYPES.has(dataType));

const mergeOptions = (
  current: CategoricalOptionEntry[],
  incoming: CategoricalOptionEntry[],
): CategoricalOptionEntry[] => {
  const merged = new Map(current.map((option) => [option.key, option]));
  incoming.forEach((option) => {
    merged.set(option.key, option);
  });
  return Array.from(merged.values());
};

const topicIds = (column: ConditionColumnOption | undefined): number[] => {
  const type = column?.field?.type;
  if (!type || !DataType.isFixedSizeList(type)) return [];
  return Array.from({ length: type.listSize }, (_value, index) => index - 1);
};

const optionSql = (
  nodeId: string,
  column: string,
  dataType: string,
  searchQuery: string,
): string => {
  const value = sqlIdentifier('value');
  const source =
    dataType === 'string-list'
      ? `SELECT UNNEST(${sqlIdentifier(column)}) AS ${value} FROM ${sqlTable(nodeId)}`
      : `SELECT ${sqlIdentifier(column)} AS ${value} FROM ${sqlTable(nodeId)}`;
  const trimmedSearch = searchQuery.trim();
  const where = trimmedSearch
    ? ` WHERE CAST(${value} AS VARCHAR) ~* ${sqlString(sqlGlobPattern(trimmedSearch))}`
    : '';
  return `SELECT DISTINCT ${value} FROM (${source}) AS ${sqlIdentifier(
    'values',
  )}${where} ORDER BY ${value} ASC NULLS FIRST`;
};

/**
 * Owns paginated, server-searched checklist values for Filter conditions.
 */
export function useFilterCategoricalOptions({
  currentWorkspaceId,
  selectedNodeId,
  conditions,
  columnOptions,
}: UseFilterCategoricalOptionsParams): UseFilterCategoricalOptionsResult {
  const [categoricalOptions, setCategoricalOptions] = useState<CategoricalOptionsByKey>({});
  const [optionSearchQueries, setOptionSearchQueries] = useState<Record<string, string>>({});
  const categoricalOptionsRef = useRef(categoricalOptions);
  const columnOptionsRef = useRef(columnOptions);
  const pendingRequestsRef = useRef(new Map<string, AbortController>());
  const checklistSearchTargets = conditions.flatMap<ChecklistSearchTarget>((condition) => {
    if (!usesChecklistOptions(condition.dataType) || !condition.column) return [];
    return [
      {
        conditionId: condition.id,
        column: condition.column,
        dataType: condition.dataType,
      },
    ];
  });
  const checklistSearchTargetsRef = useRef(checklistSearchTargets);
  const checklistSearchTargetsKey = JSON.stringify(checklistSearchTargets);
  categoricalOptionsRef.current = categoricalOptions;
  columnOptionsRef.current = columnOptions;
  checklistSearchTargetsRef.current = checklistSearchTargets;

  const getCategoricalKey = useCallback(
    (column: string) => `${currentWorkspaceId ?? 'none'}::${selectedNodeId ?? 'none'}::${column}`,
    [currentWorkspaceId, selectedNodeId],
  );

  const loadOptions = useCallback(
    async (column: string, dataType: string, page: number, searchQuery: string) => {
      if (!currentWorkspaceId || !selectedNodeId || !column) return;
      const key = getCategoricalKey(column);
      const existing = categoricalOptionsRef.current[key];
      if (existing?.loading && page > 1) return;

      if (dataType === 'topic-distribution') {
        const values = topicIds(columnOptionsRef.current.find((option) => option.name === column));
        const options = buildCategoricalOptionEntries(values, false);
        setCategoricalOptions((current) => ({
          ...current,
          [key]: {
            options,
            hasNull: false,
            loading: false,
            error: null,
            page: 1,
            hasNext: false,
            etag: null,
            searchQuery: '',
          },
        }));
        return;
      }

      pendingRequestsRef.current.get(key)?.abort();
      const controller = new AbortController();
      pendingRequestsRef.current.set(key, controller);
      setCategoricalOptions((current) => ({
        ...current,
        [key]: {
          options: page === 1 ? [] : (current[key]?.options ?? []),
          hasNull: page === 1 ? false : (current[key]?.hasNull ?? false),
          loading: true,
          error: null,
          page: page === 1 ? 0 : (current[key]?.page ?? 0),
          hasNext: current[key]?.hasNext ?? false,
          etag: page === 1 ? null : (current[key]?.etag ?? null),
          searchQuery,
        },
      }));

      try {
        const response = await queryWorkspaceSqlTable({
          path: { workspace_id: currentWorkspaceId },
          body: {
            mode: 'query',
            node_ids: [selectedNodeId],
            sql: optionSql(selectedNodeId, column, dataType, searchQuery),
            page,
            page_size: CATEGORICAL_PAGE_SIZE,
          },
          signal: controller.signal,
        });
        if (pendingRequestsRef.current.get(key) !== controller) return;
        const currentState = categoricalOptionsRef.current[key];
        if (page > 1 && currentState?.etag && currentState.etag !== response.etag) {
          await loadOptions(column, dataType, 1, searchQuery);
          return;
        }
        const rawValues = response.rows.map((row) => row.value);
        const hasNull =
          dataType === 'categorical' &&
          searchQuery.trim().length === 0 &&
          rawValues.some((value) => value === null);
        const incoming = buildCategoricalOptionEntries(rawValues, hasNull);
        setCategoricalOptions((current) => {
          const prior = current[key];
          return {
            ...current,
            [key]: {
              options: page === 1 ? incoming : mergeOptions(prior?.options ?? [], incoming),
              hasNull: page === 1 ? hasNull : (prior?.hasNull ?? false) || hasNull,
              loading: false,
              error: null,
              page,
              hasNext: response.hasNext,
              etag: response.etag,
              searchQuery,
            },
          };
        });
      } catch (error) {
        if (pendingRequestsRef.current.get(key) !== controller) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setCategoricalOptions((current) => ({
          ...current,
          [key]: {
            options: page === 1 ? [] : (current[key]?.options ?? []),
            hasNull: page === 1 ? false : (current[key]?.hasNull ?? false),
            loading: false,
            error: error instanceof Error ? error.message : 'Failed to load categories',
            page: current[key]?.page ?? 0,
            hasNext: current[key]?.hasNext ?? false,
            etag: current[key]?.etag ?? null,
            searchQuery,
          },
        }));
      } finally {
        if (pendingRequestsRef.current.get(key) === controller) {
          pendingRequestsRef.current.delete(key);
        }
      }
    },
    [currentWorkspaceId, getCategoricalKey, selectedNodeId],
  );

  const ensureCategoricalOptions = useCallback(
    async (column: string, dataType: string) => {
      const condition = conditions.find((entry) => entry.column === column);
      const searchQuery = condition ? (optionSearchQueries[condition.id] ?? '') : '';
      await loadOptions(column, dataType, 1, searchQuery);
    },
    [conditions, loadOptions, optionSearchQueries],
  );

  const loadMoreCategoricalOptions = useCallback(
    async (column: string, dataType: string) => {
      const key = getCategoricalKey(column);
      const current = categoricalOptionsRef.current[key];
      if (!current?.hasNext || current.loading) return;
      await loadOptions(column, dataType, current.page + 1, current.searchQuery);
    },
    [getCategoricalKey, loadOptions],
  );

  useEffect(() => {
    pendingRequestsRef.current.forEach((controller) => {
      controller.abort();
    });
    pendingRequestsRef.current.clear();
    setCategoricalOptions({});
    setOptionSearchQueries({});
  }, [currentWorkspaceId, selectedNodeId]);

  useEffect(
    () => () => {
      pendingRequestsRef.current.forEach((controller) => {
        controller.abort();
      });
      pendingRequestsRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (!currentWorkspaceId || !selectedNodeId) return;
    conditions.forEach((condition) => {
      if (usesChecklistOptions(condition.dataType) && condition.column) {
        const key = getCategoricalKey(condition.column);
        if (!categoricalOptionsRef.current[key]) {
          void loadOptions(condition.column, condition.dataType, 1, '');
        }
      }
    });
  }, [conditions, currentWorkspaceId, getCategoricalKey, loadOptions, selectedNodeId]);

  useEffect(() => {
    const pending = checklistSearchTargetsRef.current.flatMap((target) => {
      if (!Object.hasOwn(optionSearchQueries, target.conditionId)) return [];
      const searchQuery = optionSearchQueries[target.conditionId] ?? '';
      return [{ column: target.column, dataType: target.dataType, searchQuery }];
    });
    if (pending.length === 0) return;
    const timeout = window.setTimeout(() => {
      pending.forEach(({ column, dataType, searchQuery }) => {
        void loadOptions(column, dataType, 1, searchQuery);
      });
    }, 300);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [checklistSearchTargetsKey, loadOptions, optionSearchQueries]);

  const setOptionSearchQuery = (conditionId: string, query: string) => {
    setOptionSearchQueries((current) => ({ ...current, [conditionId]: query }));
  };

  const resetOptionSearchQuery = (conditionId: string) => {
    setOptionSearchQueries((current) => ({ ...current, [conditionId]: '' }));
  };

  const removeOptionSearchQuery = (conditionId: string) => {
    setOptionSearchQueries((current) => {
      const { [conditionId]: _removed, ...next } = current;
      return next;
    });
  };

  return {
    categoricalOptions,
    optionSearchQueries,
    getCategoricalKey,
    ensureCategoricalOptions,
    loadMoreCategoricalOptions,
    setOptionSearchQuery,
    resetOptionSearchQuery,
    removeOptionSearchQuery,
  };
}
