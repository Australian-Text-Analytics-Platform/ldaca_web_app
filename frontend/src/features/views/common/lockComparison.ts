export type ServerRequestLike = Record<string, unknown>;

/**
 * Produces deterministic structural strings for request comparisons where key
 * order from backend JSON should not mark locked parameters as changed.
 * Called by: hasParameterDiff when comparing current form state to server requests because the caller needs this analysis-specific step before continuing its request, result, display, or cleanup workflow.
 * Flow: derive display state, bind user actions, then render the analysis UI.
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

/**
 * Gives feature-specific lock checks a generic equality test for current form
 * parameters versus the request persisted with the backend task.
 * Used by: hasLockedParameterDiff because locked-result badges need a stable deep comparison between live form params and the task request payload.
 */
const hasParameterDiff = (currentParams: unknown, serverParams: unknown): boolean =>
  stableSerialize(currentParams) !== stableSerialize(serverParams);

/**
 * Guards parameter-diff badges so unlocked panels and missing server requests do
 * not falsely report changes before a task has supplied its original payload.
 * Used by: locked analysis panels because they should show parameter drift only after a server request exists and the result is actually locked.
 */
export const hasLockedParameterDiff = <TRequest extends ServerRequestLike>({
  isLocked,
  serverRequest,
  currentParams,
  getServerParams,
}: {
  isLocked: boolean;
  serverRequest: TRequest | null | undefined;
  currentParams: unknown;
  getServerParams: (request: TRequest) => unknown;
}): boolean => {
  if (!isLocked || !serverRequest) {
    return false;
  }

  return hasParameterDiff(currentParams, getServerParams(serverRequest));
};

/**
 * Canonicalizes user and server string arrays before lock comparison helpers
 * compare unordered selection-like values.
 * Used by: lock comparison helpers and multi-node parameter diffing because user and server selections must compare after trimming blanks and sorting.
 */
export const normalizeStringArray = (values: string[]): string[] =>
  [...values]
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();

/**
 * Safely extracts string arrays from untyped server request payloads consumed by
 * generated SDK calls and task-center hydration flows.
 * Used by: server-request lock helpers because generated task payload fields can be untyped and must discard non-string array entries before diffing.
 */
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

export type ServerEngineConfig = {
  type: 'local' | 'remote';
  url: string | null;
};

/**
 * Reads engine settings from both nested and legacy flat request payloads so AI
 * analysis panels can restore remote/local execution choices after hydration.
 * Used by: quotation lock comparison and hydration paths because both nested engine objects and legacy flat fields must restore the submitted execution target.
 * Flow: read nested and root engine type/url fields, default to local execution, normalize remote URLs when requested, then return comparable engine settings.
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
  const type = (typeFromEngine || typeFromRoot || 'local') === 'remote' ? 'remote' : 'local';

  const urlFromEngine =
    requestEngineRecord && typeof requestEngineRecord.url === 'string'
      ? requestEngineRecord.url
      : null;
  const urlFromRoot =
    typeof (request as { engine_url?: unknown }).engine_url === 'string'
      ? (request as { engine_url: string }).engine_url
      : null;
  const rawUrl = urlFromEngine || urlFromRoot;

  if (type !== 'remote' || !rawUrl) {
    return { type, url: null };
  }

  return { type, url: normalizeUrl ? normalizeUrl(rawUrl) : rawUrl };
};
