import { sqlIdentifier, sqlString } from '@/api';

export interface AnnotationLabelClassification {
  raw: string;
  value: string | null;
  invalid: boolean;
}

/** Coerces an Arrow-backed cell to the text users see in Annotation tables. */
export function annotationCellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value);
}

/** Canonical Codebook identity used by UI options, SQL, and TanStack Query keys. */
export function normalizeAnnotationClassOptions(classOptions: readonly string[]): string[] {
  return Array.from(
    new Set(classOptions.map((name) => name.trim()).filter((name) => name.length > 0)),
  );
}

/**
 * Applies Annotation's one label rule. Blank cells are empty. With Codebook classes, only a
 * trimmed, case-sensitive class match is valid; other visible text is invalid and behaves as
 * empty. Without classes, every nonblank value is valid.
 */
export function classifyAnnotationLabel(
  value: unknown,
  classOptions: readonly string[],
): AnnotationLabelClassification {
  const raw = annotationCellText(value);
  const trimmed = raw.trim();
  if (trimmed === '') return { raw, value: null, invalid: false };
  const classes = normalizeAnnotationClassOptions(classOptions);
  if (classes.length > 0 && !classes.includes(trimmed)) {
    return { raw, value: null, invalid: true };
  }
  return { raw, value: trimmed, invalid: false };
}

export function normalizeAnnotationLabel(
  value: unknown,
  classOptions: readonly string[],
): string | null {
  return classifyAnnotationLabel(value, classOptions).value;
}

export function isInvalidAnnotationLabel(value: unknown, classOptions: readonly string[]): boolean {
  return classifyAnnotationLabel(value, classOptions).invalid;
}

/** Two cells differ only when both hold valid canonical labels. */
export function annotationValuesDiffer(
  reference: unknown,
  comparison: unknown,
  classOptions: readonly string[],
): boolean {
  const left = normalizeAnnotationLabel(reference, classOptions);
  const right = normalizeAnnotationLabel(comparison, classOptions);
  return left !== null && right !== null && left !== right;
}

/** Polars SQL expression equivalent to classifyAnnotationLabel(value).value. */
export function annotationLabelSql(column: string, classOptions: readonly string[]): string {
  const text = `TRIM(CAST(${sqlIdentifier(column)} AS STRING))`;
  const classes = normalizeAnnotationClassOptions(classOptions);
  if (classes.length === 0) return `NULLIF(${text}, '')`;
  return `(CASE WHEN ${text} IN (${classes.map(sqlString).join(', ')}) THEN ${text} END)`;
}
