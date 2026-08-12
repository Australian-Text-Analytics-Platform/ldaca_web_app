import { sqlIdentifier } from '@/api';

const SOURCE_CTE = '__wordflow_annotation_source';
const INDEXED_CTE = '__wordflow_annotation_indexed';
const FILTERED_CTE = '__wordflow_annotation_filtered';
const SOURCE_ROW_INDEX = '__wordflow_annotation_source_row_index';
export const ANNOTATION_FILTERED_ROW_COUNT = '__wordflow_annotation_filtered_row_count';

const uniqueColumnName = (preferred: string, columns: readonly string[]): string => {
  const used = new Set(columns);
  let candidate = preferred;
  while (used.has(candidate)) candidate = `_${candidate}`;
  return candidate;
};

interface AnnotationDifferenceQueryArgs {
  sourceSql: string;
  sourceColumns: readonly string[];
  annotationColumn: string;
  differenceColumn: string | null;
}

export interface AnnotationDifferenceQuery {
  pageSql: string;
  countSql: string | null;
  sourceRowIndexColumn: string;
}

/**
 * Builds the server-side page/count projections for one revealed comparison column.
 * Used by: useAnnotationNodePage so Manual and Review filter before server pagination while the
 * active filter itself remains mount-local frontend state.
 */
export function buildAnnotationDifferenceQuery({
  sourceSql,
  sourceColumns,
  annotationColumn,
  differenceColumn,
}: AnnotationDifferenceQueryArgs): AnnotationDifferenceQuery {
  const sourceRowIndexColumn = uniqueColumnName(SOURCE_ROW_INDEX, sourceColumns);
  const sourceName = sqlIdentifier(SOURCE_CTE);
  const indexedName = sqlIdentifier(INDEXED_CTE);
  const filteredName = sqlIdentifier(FILTERED_CTE);
  const rowIndexName = sqlIdentifier(sourceRowIndexColumn);
  const validDifferenceColumn =
    differenceColumn &&
    differenceColumn !== annotationColumn &&
    sourceColumns.includes(differenceColumn)
      ? differenceColumn
      : null;
  const predicate = validDifferenceColumn
    ? `${sqlIdentifier(annotationColumn)} != ${sqlIdentifier(validDifferenceColumn)}`
    : '';
  const common = [
    `WITH ${sourceName} AS (${sourceSql})`,
    `${indexedName} AS (SELECT ROW_NUMBER() OVER () - 1 AS ${rowIndexName}, * FROM ${sourceName})`,
    ...(predicate ? [`${filteredName} AS (SELECT * FROM ${indexedName} WHERE ${predicate})`] : []),
  ].join(', ');
  const pageSource = predicate ? filteredName : indexedName;

  return {
    pageSql: `${common} SELECT * FROM ${pageSource} ORDER BY ${rowIndexName}`,
    countSql: predicate
      ? `${common} SELECT COUNT(*) AS ${sqlIdentifier(ANNOTATION_FILTERED_ROW_COUNT)} FROM ${filteredName}`
      : null,
    sourceRowIndexColumn,
  };
}

/** Mirrors ordinary SQL inequality: null pairs are not classified as differences. */
export function annotationValuesDiffer(reference: unknown, comparison: unknown): boolean {
  return reference != null && comparison != null && reference !== comparison;
}
