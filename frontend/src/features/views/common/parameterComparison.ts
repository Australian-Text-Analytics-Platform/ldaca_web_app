/**
 * Produces deterministic structural strings for request comparisons where key
 * order from backend JSON should not mark unchanged parameters as different.
 * Called by: hasParameterDiff when comparing current form/input state to the
 * request payload from the last run.
 */
const stableSerialize = (value: unknown): string => {
  if (value == null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }

  const objectValue = value as Record<string, unknown>;
  const keys = Object.keys(objectValue).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(objectValue[key])}`).join(',')}}`;
};

/** Generic equality test for current form parameters versus the last-run request. */
export const hasParameterDiff = (currentParams: unknown, serverParams: unknown): boolean =>
  stableSerialize(currentParams) !== stableSerialize(serverParams);

/** Canonicalizes string arrays before comparing unordered selection-like values. */
export const normalizeStringArray = (values: string[]): string[] =>
  [...values]
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
