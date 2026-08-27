import { sqlIdentifier, sqlString } from '@/api';

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

const cellText = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value);
};

/** Trimmed, de-duplicated Codebook classes; an empty list means "no Codebook rule". */
const normalizeAnnotationClassOptions = (classOptions: readonly string[]): string[] =>
  Array.from(new Set(classOptions.map((name) => name.trim()).filter((name) => name.length > 0)));

/**
 * Returns the valid label held by one cell, or null when the cell is empty.
 * Null, blank, and whitespace-only values are empty. When the Codebook supplies classes, a value
 * is valid only if its trimmed text exactly matches one class; anything else is treated as empty.
 * An empty class list (no Codebook attached, or one that is still loading or has no classes)
 * deliberately applies only the blank rule: there is nothing to validate against, and the
 * comparison queries re-run once classes arrive because they are keyed by the class list.
 */
export function normalizeAnnotationLabel(
  value: unknown,
  classOptions: readonly string[],
): string | null {
  const text = cellText(value).trim();
  if (text === '') return null;
  const classes = normalizeAnnotationClassOptions(classOptions);
  if (classes.length > 0 && !classes.includes(text)) return null;
  return text;
}

/** True when a cell holds visible text that the Codebook does not recognise. */
export function isInvalidAnnotationLabel(value: unknown, classOptions: readonly string[]): boolean {
  return cellText(value).trim() !== '' && normalizeAnnotationLabel(value, classOptions) === null;
}

/** Two cells differ only when both hold valid labels and those labels are not identical. */
export function annotationValuesDiffer(
  reference: unknown,
  comparison: unknown,
  classOptions: readonly string[],
): boolean {
  const left = normalizeAnnotationLabel(reference, classOptions);
  const right = normalizeAnnotationLabel(comparison, classOptions);
  return left !== null && right !== null && left !== right;
}

/**
 * SQL expression yielding the valid label of `column` or NULL, mirroring normalizeAnnotationLabel.
 * The cast keeps categorical columns acceptable to Polars SQL string functions.
 */
export function annotationLabelSql(column: string, classOptions: readonly string[]): string {
  const text = `TRIM(CAST(${sqlIdentifier(column)} AS STRING))`;
  const classes = normalizeAnnotationClassOptions(classOptions);
  if (classes.length === 0) return `NULLIF(${text}, '')`;
  return `(CASE WHEN ${text} IN (${classes.map(sqlString).join(', ')}) THEN ${text} END)`;
}

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
