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
export const hasParameterDiff = (currentParams: unknown, serverParams: unknown): boolean =>
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

/**
 * Compares selection arrays after applying the same canonical form used by the
 * analysis lock machine and task request adapters.
 * Used by: node-selection lock diff helpers because node id arrays should compare by canonical membership rather than current UI order.
 */
export const areStringArraysEqual = (left: string[], right: string[]): boolean =>
  JSON.stringify(normalizeStringArray(left)) === JSON.stringify(normalizeStringArray(right));

/**
 * Finds the primary node id across old and current request shapes so analysis
 * features can diff locks without caring which backend schema produced them.
 * Used by: task hydration and lock comparison helpers because legacy requests may store the primary node as node_id, nodeId, or first node_ids entry.
 * Flow: return empty for missing requests, check node_id and nodeId aliases, then fall back to the first string in node_ids.
 */
export const getServerPrimaryNodeId = (request: ServerRequestLike | null | undefined): string => {
  if (!request) {
    return '';
  }

  const requestWithNode = request as ServerRequestLike & {
    node_id?: unknown;
    nodeId?: unknown;
    node_ids?: unknown;
  };

  if (typeof requestWithNode.node_id === 'string') {
    return requestWithNode.node_id;
  }

  if (typeof requestWithNode.nodeId === 'string') {
    return requestWithNode.nodeId;
  }

  if (Array.isArray(requestWithNode.node_ids) && typeof requestWithNode.node_ids[0] === 'string') {
    return requestWithNode.node_ids[0];
  }

  return '';
};

/**
 * Normalizes single-node and multi-node task requests into the ordered id list
 * expected by shared node/column lock comparison helpers.
 * Used by: multi-node analysis panels because locked selection diffs need a normalized id list whether the server request was single-node or multi-node.
 */
export const getServerNodeIds = (request: ServerRequestLike | null | undefined): string[] => {
  if (!request) {
    return [];
  }

  const nodeIds = normalizeUnknownStringArray((request as { node_ids?: unknown }).node_ids);
  if (nodeIds.length > 0) {
    return nodeIds;
  }

  const primary = getServerPrimaryNodeId(request);
  return primary ? [primary] : [];
};

/**
 * Builds a stable node-to-column map for the active node set so missing columns
 * and node order do not create noisy lock-diff results.
 * Used by: hasNodeColumnDiff because current and server column maps must share sorted node keys and blank defaults before JSON comparison.
 */
export const normalizeNodeColumns = (
  nodeIds: string[],
  nodeColumns: Record<string, string>,
): Record<string, string> =>
  Object.fromEntries(
    normalizeStringArray(nodeIds).map((nodeId) => [nodeId, nodeColumns[nodeId] || '']),
  );

/**
 * Detects whether the current node selection differs from the task request that
 * owns the locked result panel.
 * Used by: locked analysis feature screens because node-selection drift badges need canonical array comparison for current versus submitted ids.
 */
export const hasNodeIdDiff = (currentNodeIds: string[], serverNodeIds: string[]): boolean =>
  !areStringArraysEqual(currentNodeIds, serverNodeIds);

/**
 * Detects node/column selection drift for multi-node analyses such as
 * concordance and sequential analysis.
 * Used by: multi-node feature screens and detached-column warnings because drift detection must compare node ids together with their selected columns.
 */
export const hasNodeColumnDiff = (
  currentNodeIds: string[],
  currentNodeColumns: Record<string, string>,
  serverNodeIds: string[],
  serverNodeColumns: Record<string, string>,
): boolean => {
  const current = normalizeNodeColumns(currentNodeIds, currentNodeColumns);
  const server = normalizeNodeColumns(serverNodeIds, serverNodeColumns);
  return JSON.stringify(current) !== JSON.stringify(server);
};

/**
 * Canonicalizes comma-delimited stop-word inputs so lock checks ignore spacing,
 * casing, and ordering differences in text fields.
 * Used by: token-frequency parameter diffing because stop-word text should ignore comma spacing, casing, blanks, and ordering before lock comparisons.
 */
export const normalizeCommaSeparatedWords = (value: string): string[] =>
  normalizeStringArray(
    value
      .split(',')
      .map((word) => word.trim().toLowerCase())
      .filter(Boolean),
  );

/**
 * Normalizes stop-word arrays from backend task requests before comparing them
 * with the current parameter form.
 * Used by: token-frequency hydration and lock comparison logic because backend stop-word arrays need the same lowercase canonical form as user-entered text.
 */
export const normalizeRequestStopWords = (value: unknown): string[] =>
  normalizeUnknownStringArray(value).map((word) => word.toLowerCase());

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
