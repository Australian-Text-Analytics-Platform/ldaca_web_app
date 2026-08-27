import { useState } from 'react';
import {
  type AnnotationRowFilter,
  type AnnotationRowFilterValue,
  INACTIVE_ANNOTATION_FILTER,
  isAnnotationRowFilterActive,
} from '../annotationRowFilter';

interface AnnotationRowFilterState {
  comparisonScope: string;
  filter: AnnotationRowFilter | null;
}

const reconcileFilter = (
  filter: AnnotationRowFilter | null,
  annotationColumn: string,
  comparisonColumns: readonly string[],
): AnnotationRowFilter | null => {
  if (!filter) return null;
  if (filter.column !== annotationColumn && !comparisonColumns.includes(filter.column)) return null;
  const differs =
    filter.differs && (filter.column !== annotationColumn || comparisonColumns.length > 0);
  const next = { ...filter, differs };
  return isAnnotationRowFilterActive(next) ? next : null;
};

/**
 * Owns one mount-local Manual/Review filter. Eligibility changes are reconciled into state before
 * children render, so removed comparators cannot leave or later resurrect a ghost filter.
 */
export function useAnnotationRowFilter(
  annotationColumn: string,
  comparisonColumns: readonly string[],
) {
  const normalizedColumns = Array.from(new Set(comparisonColumns)).filter(
    (column) => column !== annotationColumn,
  );
  const comparisonScope = JSON.stringify([annotationColumn, ...normalizedColumns]);
  const [state, setState] = useState<AnnotationRowFilterState>(() => ({
    comparisonScope,
    filter: null,
  }));
  const filter =
    state.comparisonScope === comparisonScope
      ? state.filter
      : reconcileFilter(state.filter, annotationColumn, normalizedColumns);

  if (state.comparisonScope !== comparisonScope) {
    setState({ comparisonScope, filter });
  }

  const valueFor = (column: string): AnnotationRowFilterValue =>
    filter?.column === column
      ? { differs: filter.differs, existence: filter.existence }
      : INACTIVE_ANNOTATION_FILTER;
  const setFor = (column: string, value: AnnotationRowFilterValue) => {
    setState({
      comparisonScope,
      filter: isAnnotationRowFilterActive(value) ? { column, ...value } : null,
    });
  };

  return { filter, valueFor, setFor };
}
