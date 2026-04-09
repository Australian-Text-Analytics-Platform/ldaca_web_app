import type { FilterConditionWithId } from '../types';
import { isConditionComplete } from '../filter/utils/serializers';

const DEFAULT_NAME_FALLBACK = 'dataset';
const DEFAULT_SLICE_OFFSET = 0;

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

const formatScalar = (value: string | number | boolean | Date | null): string => {
  if (value === null) return 'null';
  if (value instanceof Date) return sanitizeToken(value.toISOString());
  if (typeof value === 'number') {
    return sanitizeToken(String(value).replace(/\./g, '_'));
  }
  return sanitizeToken(String(value));
};

const formatConditionValue = (value: FilterConditionWithId['value']): string => {
  if (Array.isArray(value)) {
    if (value.length === 0) return 'empty';
    return value.slice(0, 3).map((entry) => formatScalar(entry)).join('_or_');
  }

  if (value instanceof Date) {
    return formatScalar(value);
  }

  if (value && typeof value === 'object' && 'start' in value) {
    const startToken = formatScalar(value.start ?? null);
    const endToken = formatScalar(value.end ?? null);
    return `${startToken}_and_${endToken}`;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return formatScalar(value);
  }

  return 'value';
};

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

export const buildFilterAutoNodeName = ({
  baseName,
  conditions,
  logic,
}: {
  baseName: string | null | undefined;
  conditions: FilterConditionWithId[];
  logic: string;
}): string => {
  const base = (baseName || '').trim() || DEFAULT_NAME_FALLBACK;
  const completeConditions = conditions.filter(isConditionComplete);

  if (completeConditions.length === 0) {
    return `${base}_filtered`;
  }

  const joinToken = logic === 'or' ? '_or_' : '_and_';
  const conditionToken = completeConditions.map(formatFilterConditionToken).join(joinToken);
  return `${base}_filtered_by_${conditionToken}`;
};

export const buildSamplingAutoNodeName = ({
  baseName,
  mode,
  offset,
  length,
  sampleSize,
  randomSeed,
  noRandomSeed,
}: {
  baseName: string | null | undefined;
  mode: 'slice' | 'random_sample';
  offset?: number;
  length?: number;
  sampleSize?: number;
  randomSeed?: number;
  noRandomSeed?: boolean;
}): string => {
  const base = (baseName || '').trim() || DEFAULT_NAME_FALLBACK;

  if (mode === 'slice') {
    const start = Number.isInteger(offset) && (offset ?? 0) >= 0 ? (offset ?? 0) : DEFAULT_SLICE_OFFSET;

    if (!Number.isInteger(length) || length === undefined) {
      return `${base}_sliced_from_${start}`;
    }

    if (length <= 0) {
      return `${base}_sliced_from_${start}_length_${length}`;
    }

    const end = start + length - 1;
    return `${base}_sliced_from_${start}_to_${end}`;
  }

  if (typeof sampleSize !== 'number' || !Number.isFinite(sampleSize) || sampleSize <= 0) {
    return `${base}_sampled`;
  }

  const sizeToken = formatScalar(sampleSize);
  const sampleToken = sampleSize < 1 ? `fr_${sizeToken}` : `n_${sizeToken}`;
  const seedToken = noRandomSeed
    ? '_true_random'
    : typeof randomSeed === 'number' && Number.isInteger(randomSeed) && randomSeed >= 0
      ? `_rs_${randomSeed}`
      : '';

  return `${base}_sampled_${sampleToken}${seedToken}`;
};