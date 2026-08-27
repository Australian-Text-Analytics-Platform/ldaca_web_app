import { sqlIdentifier } from '@/api';
import { annotationLabelSql } from './annotationLabelModel';

const SOURCE_CTE = '__wordflow_annotation_source';
const INDEXED_CTE = '__wordflow_annotation_indexed';
const FILTERED_CTE = '__wordflow_annotation_filtered';
const SOURCE_ROW_INDEX = '__wordflow_annotation_source_row_index';
export const ANNOTATION_FILTERED_ROW_COUNT = '__wordflow_annotation_filtered_row_count';

export type AnnotationExistenceFilter = 'off' | 'present' | 'empty';

/**
 * One mount-local row filter owned by a Manual or Review table. `column` is either the annotation
 * column itself or one selected comparison column; only one column carries a filter at a time.
 */
export interface AnnotationRowFilter {
  column: string;
  differs: boolean;
  existence: AnnotationExistenceFilter;
}

export type AnnotationRowFilterValue = Pick<AnnotationRowFilter, 'differs' | 'existence'>;

export const INACTIVE_ANNOTATION_FILTER: AnnotationRowFilterValue = {
  differs: false,
  existence: 'off',
};

export const isAnnotationRowFilterActive = (
  filter: AnnotationRowFilterValue | null | undefined,
): boolean => Boolean(filter && (filter.differs || filter.existence !== 'off'));

const uniqueColumnName = (preferred: string, columns: readonly string[]): string => {
  const used = new Set(columns);
  let candidate = preferred;
  while (used.has(candidate)) candidate = `_${candidate}`;
  return candidate;
};

interface AnnotationRowFilterQueryArgs {
  sourceSql: string;
  sourceColumns: readonly string[];
  annotationColumn: string;
  comparisonColumns: readonly string[];
  classOptions: readonly string[];
  filter: AnnotationRowFilter | null;
}

export interface AnnotationRowFilterQuery {
  pageSql: string;
  countSql: string | null;
  sourceRowIndexColumn: string;
}

const existencePredicate = (label: string, existence: AnnotationExistenceFilter): string | null =>
  existence === 'present'
    ? `${label} IS NOT NULL`
    : existence === 'empty'
      ? `${label} IS NULL`
      : null;

/**
 * Builds the server-side page/count projections for one row filter.
 * Used by: useAnnotationNodePage so Manual and Review filter before server pagination while the
 * active filter itself remains mount-local frontend state. Difference and existence conditions
 * are ANDed; a difference on the annotation column means it differs from at least one selected
 * comparison column. Empty cells and non-Codebook values never count as differences.
 */
export function buildAnnotationRowFilterQuery({
  sourceSql,
  sourceColumns,
  annotationColumn,
  comparisonColumns,
  classOptions,
  filter,
}: AnnotationRowFilterQueryArgs): AnnotationRowFilterQuery {
  const sourceRowIndexColumn = uniqueColumnName(SOURCE_ROW_INDEX, sourceColumns);
  const sourceName = sqlIdentifier(SOURCE_CTE);
  const indexedName = sqlIdentifier(INDEXED_CTE);
  const filteredName = sqlIdentifier(FILTERED_CTE);
  const rowIndexName = sqlIdentifier(sourceRowIndexColumn);
  const validComparisonColumns = Array.from(new Set(comparisonColumns)).filter(
    (column) => column !== annotationColumn && sourceColumns.includes(column),
  );
  const conditions: string[] = [];
  if (filter && sourceColumns.includes(annotationColumn)) {
    const annotationLabel = annotationLabelSql(annotationColumn, classOptions);
    if (filter.column === annotationColumn) {
      if (filter.differs && validComparisonColumns.length > 0) {
        const differences = validComparisonColumns.map((column) => {
          const label = annotationLabelSql(column, classOptions);
          return `(${label} IS NOT NULL AND ${annotationLabel} != ${label})`;
        });
        conditions.push(`(${annotationLabel} IS NOT NULL AND (${differences.join(' OR ')}))`);
      }
      const existence = existencePredicate(annotationLabel, filter.existence);
      if (existence) conditions.push(existence);
    } else if (validComparisonColumns.includes(filter.column)) {
      const comparisonLabel = annotationLabelSql(filter.column, classOptions);
      if (filter.differs) {
        conditions.push(
          `(${annotationLabel} IS NOT NULL AND ${comparisonLabel} IS NOT NULL AND ${annotationLabel} != ${comparisonLabel})`,
        );
      }
      const existence = existencePredicate(comparisonLabel, filter.existence);
      if (existence) conditions.push(existence);
    }
  }
  const predicate = conditions.join(' AND ');
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
