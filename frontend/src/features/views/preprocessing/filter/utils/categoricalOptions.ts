import { formatPreviewValue } from '../../utils/typeUtils';

export type CategoricalPrimitive = string | number | boolean | null;

export interface CategoricalOptionEntry {
  key: string;
  value: CategoricalPrimitive;
  label: string;
  isNull: boolean;
}

interface CategoricalOptionState {
  options: CategoricalOptionEntry[];
  hasNull: boolean;
  loading: boolean;
  error: string | null;
}

export type CategoricalOptionsByKey = Record<string, CategoricalOptionState>;

export const NULL_OPTION_KEY = '__LDACA_NULL__';

/**
 * Normalizes backend unique values into primitives the checklist can compare.
 * Used by: useFilterSubTabSections and FilterConditionValueInput because
 * backend unique-value responses can include dates or structured values while
 * checklist selection state must use stable primitive keys.
 */
export const toCategoricalPrimitive = (value: unknown): CategoricalPrimitive => {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  // value is a non-primitive object here; String() is the intended last resort.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(value);
};

/**
 * Creates collision-resistant keys for categorical checklist selections.
 * Used by: option builders and value inputs so `1`, `'1'`, `true`, and null
 * remain distinct backend values in multi-select filters.
 */
export const getCategoricalOptionKey = (value: CategoricalPrimitive): string => {
  if (value === null) return NULL_OPTION_KEY;
  return `${typeof value}::${String(value)}`;
};

/**
 * Builds deduplicated checklist options from `getColumnUniqueValues`.
 * Used by: useFilterSubTabSections after lazy loading a categorical/list/topic
 * column so the value editor receives null-aware, display-ready options.
 * Steps: convert backend unique values to comparable primitives, deduplicate by
 * type-aware key, prepend null when present, and preserve display labels.
 */
export const buildCategoricalOptionEntries = (
  rawValues: unknown[],
  hasNullFromResponse: boolean,
): CategoricalOptionEntry[] => {
  const uniqueEntries = new Map<string, CategoricalOptionEntry>();

  rawValues.forEach((value) => {
    const primitive = toCategoricalPrimitive(value);
    if (primitive === null) {
      return;
    }

    const optionKey = getCategoricalOptionKey(primitive);
    if (!uniqueEntries.has(optionKey)) {
      uniqueEntries.set(optionKey, {
        key: optionKey,
        value: primitive,
        label: formatPreviewValue(primitive),
        isNull: false,
      });
    }
  });

  const optionList: CategoricalOptionEntry[] = [];
  if (hasNullFromResponse) {
    optionList.push({
      key: NULL_OPTION_KEY,
      value: null,
      label: 'Null (no value)',
      isNull: true,
    });
  }
  optionList.push(...uniqueEntries.values());
  return optionList;
};
