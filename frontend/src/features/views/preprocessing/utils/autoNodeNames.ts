import type { FilterConditionWithId } from '../types';
import { isConditionComplete } from '../filter/utils/serializers';

const DEFAULT_NAME_FALLBACK = 'dataset';

const EXPRESSION_CONTEXT_SUFFIX: Record<
  'filter' | 'with_columns' | 'select' | 'sort' | 'group_by_agg',
  string
> = {
  filter: 'filtered_expr',
  with_columns: 'with_columns',
  select: 'selected_expr',
  sort: 'sorted_expr',
  group_by_agg: 'grouped_expr',
};

/**
 * Sanitizes user/schema text into safe auto-generated node-name tokens.
 * Used by: local callers in preprocessing/autoNodeNames module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
const sanitizeToken = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return 'value';

  const normalized = trimmed
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || 'value';
};

/**
 * Formats scalar condition values for stable, readable output names.
 * Used by: local callers in preprocessing/autoNodeNames module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
const formatScalar = (value: string | number | boolean | Date | null): string => {
  if (value === null) return 'null';
  if (value instanceof Date) return sanitizeToken(value.toISOString());
  if (typeof value === 'number') {
    return sanitizeToken(String(value).replace(/\./g, '_'));
  }
  return sanitizeToken(String(value));
};

/**
 * Converts filter condition values, including ranges and lists, into name tokens.
 * Used by: local callers in preprocessing/autoNodeNames module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 * Steps: serialize arrays, dates, ranges, scalars, and unknown values into compact filename-safe tokens.
 */
const formatConditionValue = (value: FilterConditionWithId['value']): string => {
  if (Array.isArray(value)) {
    if (value.length === 0) return 'empty';
    return value
      .slice(0, 3)
      .map((entry) => formatScalar(entry))
      .join('_or_');
  }

  if (value instanceof Date) {
    return formatScalar(value);
  }

  if (value && typeof value === 'object' && 'start' in value) {
    const startToken = formatScalar(value.start ?? null);
    const endToken = formatScalar(value.end ?? null);
    return `${startToken}_and_${endToken}`;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return formatScalar(value);
  }

  return 'value';
};

/**
 * Builds one descriptive token for a complete filter condition.
 * Used by: local callers in preprocessing/autoNodeNames module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 * Steps: sanitize the column, include negation/operator details, and delegate value formatting by condition shape.
 */
const formatFilterConditionToken = (condition: FilterConditionWithId): string => {
  const columnToken = sanitizeToken(condition.column || 'column');
  const negatePrefix = condition.negate ? 'not_' : '';

  switch (condition.operator) {
    case 'is_null':
      return `${columnToken}_${negatePrefix}is_null`;
    case 'between':
      return `${columnToken}_${negatePrefix}between_${formatConditionValue(condition.value)}`;
    case 'contains': {
      const operatorToken = condition.regex ? 'contains_regex' : 'contains';
      return `${columnToken}_${negatePrefix}${operatorToken}_${formatConditionValue(condition.value)}`;
    }
    default:
      return `${columnToken}_${negatePrefix}${condition.operator}_${formatConditionValue(condition.value)}`;
  }
};

/**
 * Builds the suggested output name shown by the Filter tab.
 * Used by: useFilterSubTabSections hook (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 * Flow: normalize the base label, keep only complete conditions, choose AND/OR join tokens, and append encoded condition tokens.
 */
export const buildFilterAutoNodeName = ({
  baseName,
  conditions,
  logic,
}: {
  baseName: string | null | undefined;
  conditions: FilterConditionWithId[];
  logic: string;
}): string => {
  const base = (baseName ?? '').trim() || DEFAULT_NAME_FALLBACK;
  const completeConditions = conditions.filter(isConditionComplete);

  if (completeConditions.length === 0) {
    return `${base}_filtered`;
  }

  const joinToken = logic === 'or' ? '_or_' : '_and_';
  const conditionToken = completeConditions.map(formatFilterConditionToken).join(joinToken);
  return `${base}_filtered_by_${conditionToken}`;
};

/**
 * Builds the suggested output name shown by the Polars expression tab.
 * Used by: autoNodeNames tests, usePolarsExpressionSubTab hook (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 */
export const buildExpressionAutoNodeName = ({
  baseName,
  context,
}: {
  baseName: string | null | undefined;
  context: keyof typeof EXPRESSION_CONTEXT_SUFFIX;
}): string => {
  const base = (baseName ?? '').trim() || DEFAULT_NAME_FALLBACK;
  return `${base}_${EXPRESSION_CONTEXT_SUFFIX[context]}`;
};
