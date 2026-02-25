export type ServerRequestLike = Record<string, unknown>;

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

export const hasParameterDiff = (currentParams: unknown, serverParams: unknown): boolean =>
  stableSerialize(currentParams) !== stableSerialize(serverParams);

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

export const normalizeStringArray = (values: string[]): string[] =>
  [...values].map((value) => value.trim()).filter(Boolean).sort();

export const normalizeUnknownStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return normalizeStringArray(
    value
      .map((item) => (typeof item === 'string' ? item : null))
      .filter((item): item is string => item !== null)
  );
};

export const areStringArraysEqual = (left: string[], right: string[]): boolean =>
  JSON.stringify(normalizeStringArray(left)) === JSON.stringify(normalizeStringArray(right));

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

export const normalizeNodeColumns = (
  nodeIds: string[],
  nodeColumns: Record<string, string>
): Record<string, string> => Object.fromEntries(normalizeStringArray(nodeIds).map((nodeId) => [nodeId, nodeColumns[nodeId] || '']));

export const hasNodeIdDiff = (currentNodeIds: string[], serverNodeIds: string[]): boolean =>
  !areStringArraysEqual(currentNodeIds, serverNodeIds);

export const hasNodeColumnDiff = (
  currentNodeIds: string[],
  currentNodeColumns: Record<string, string>,
  serverNodeIds: string[],
  serverNodeColumns: Record<string, string>
): boolean => {
  const current = normalizeNodeColumns(currentNodeIds, currentNodeColumns);
  const server = normalizeNodeColumns(serverNodeIds, serverNodeColumns);
  return JSON.stringify(current) !== JSON.stringify(server);
};

export const normalizeCommaSeparatedWords = (value: string): string[] =>
  normalizeStringArray(
    value
      .split(',')
      .map((word) => word.trim().toLowerCase())
      .filter(Boolean)
  );

export const normalizeRequestStopWords = (value: unknown): string[] =>
  normalizeUnknownStringArray(value).map((word) => word.toLowerCase());

export type ServerEngineConfig = {
  type: 'local' | 'remote';
  url: string | null;
};

export const getServerEngineConfig = (
  request: ServerRequestLike,
  normalizeUrl?: (url: string) => string
): ServerEngineConfig => {
  const requestEngine = (request as { engine?: unknown }).engine;
  const requestEngineRecord =
    requestEngine && typeof requestEngine === 'object' ? (requestEngine as Record<string, unknown>) : null;

  const typeFromEngine = requestEngineRecord && typeof requestEngineRecord.type === 'string'
    ? requestEngineRecord.type
    : null;
  const typeFromRoot = typeof (request as { engine_type?: unknown }).engine_type === 'string'
    ? (request as { engine_type: string }).engine_type
    : null;
  const type = (typeFromEngine || typeFromRoot || 'local') === 'remote' ? 'remote' : 'local';

  const urlFromEngine = requestEngineRecord && typeof requestEngineRecord.url === 'string'
    ? requestEngineRecord.url
    : null;
  const urlFromRoot = typeof (request as { engine_url?: unknown }).engine_url === 'string'
    ? (request as { engine_url: string }).engine_url
    : null;
  const rawUrl = urlFromEngine || urlFromRoot;

  if (type !== 'remote' || !rawUrl) {
    return { type, url: null };
  }

  return { type, url: normalizeUrl ? normalizeUrl(rawUrl) : rawUrl };
};
