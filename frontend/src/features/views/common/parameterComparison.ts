export type ServerRequestLike = Record<string, unknown>;

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

/** Safely extracts string arrays from untyped backend request payloads. */
export const normalizeUnknownStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return normalizeStringArray(
    value
      .map((item) => (typeof item === 'string' ? item : null))
      .filter((item): item is string => item !== null),
  );
};

export interface ServerEngineConfig {
  type: 'local' | 'remote';
  url: string | null;
}

/**
 * Reads engine settings from both nested and legacy flat request payloads so
 * quotation panels can compare current local/remote settings to the last run.
 */
export const getServerEngineConfig = (
  request: ServerRequestLike,
  normalizeUrl?: (url: string) => string,
): ServerEngineConfig => {
  const requestEngine = (request as { engine?: unknown }).engine;
  const requestEngineRecord =
    requestEngine && typeof requestEngine === 'object'
      ? (requestEngine as Record<string, unknown>)
      : null;

  const typeFromEngine =
    requestEngineRecord && typeof requestEngineRecord.type === 'string'
      ? requestEngineRecord.type
      : null;
  const typeFromRoot =
    typeof (request as { engine_type?: unknown }).engine_type === 'string'
      ? (request as { engine_type: string }).engine_type
      : null;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty-string engine type should fall through to the next source
  const type = (typeFromEngine || typeFromRoot || 'local') === 'remote' ? 'remote' : 'local';

  const urlFromEngine =
    requestEngineRecord && typeof requestEngineRecord.url === 'string'
      ? requestEngineRecord.url
      : null;
  const urlFromRoot =
    typeof (request as { engine_url?: unknown }).engine_url === 'string'
      ? (request as { engine_url: string }).engine_url
      : null;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty-string engine url should fall through to the next source
  const rawUrl = urlFromEngine || urlFromRoot;

  if (type !== 'remote' || !rawUrl) {
    return { type, url: null };
  }

  return { type, url: normalizeUrl ? normalizeUrl(rawUrl) : rawUrl };
};
