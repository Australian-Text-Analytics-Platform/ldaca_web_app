import type { GetNodeDataByWorkspaceIdData } from '@/api';

type GeneratedNodeDataQuery = NonNullable<GetNodeDataByWorkspaceIdData['query']>;

export type NodeDataRequest = Required<GeneratedNodeDataQuery>;

/**
 * Builds the complete generated node-data query shape used by both the SDK
 * request and TanStack cache identity.
 * Used by: Data View plus node-page consumers such as annotation and language
 * detection, which must not let omitted defaults create cache aliases.
 * Flow: apply backend defaults, preserve explicit nullable sort/filter fields,
 * and return one serializable request value including `filter_op`.
 */
export const createNodeDataRequest = (
  request: Pick<NodeDataRequest, 'page' | 'page_size'> & Partial<NodeDataRequest>,
): NodeDataRequest => ({
  page: request.page,
  page_size: request.page_size,
  sort_by: request.sort_by ?? null,
  descending: request.descending ?? false,
  filter_column: request.filter_column ?? null,
  filter_value: request.filter_value ?? null,
  filter_op: request.filter_op ?? 'contains',
});

/**
 * TanStack Query key factory.
 *
 * Keys form a hierarchy `['workspaces', wsId, 'nodes', nodeId, 'data']`
 * so partial prefixes invalidate subtrees (e.g. invalidating
 * `['workspaces']` clears every workspace-scoped query).
 *
 * Only keys with at least one call site are listed here — add entries when
 * a new cached query needs targeted invalidation.
 */
export const queryKeys = {
  /** All workspace-related queries (broad invalidation). */
  workspaces: ['workspaces'] as const,

  /** Authenticated user's selected workspace id. */
  currentWorkspace: ['users', 'me', 'current-workspace'] as const,

  /** Nodes list for a workspace; invalidated after graph-changing workspace mutations. */
  workspaceNodes: (workspaceId: string) => ['workspaces', workspaceId, 'nodes'] as const,

  /** Paginated node data keyed by the exact generated request query. */
  /**
   * Returns the node-data prefix for broad invalidation, or appends
   * page/sort/filter values for a concrete table request.
   */
  nodeData: (
    workspaceId: string,
    nodeId: string,
    request?: NodeDataRequest,
  ) => {
    const base = ['workspaces', workspaceId, 'nodes', nodeId, 'data'] as const;
    return request ? ([...base, request] as const) : base;
  },

  /** Annotation class-description rows for one selected class table node. */
  annotationClassDescriptions: (
    workspaceId: string,
    nodeId: string,
    classColumn: string,
    descriptionColumn: string,
  ) =>
    [
      'workspaces',
      workspaceId,
      'annotation',
      'class-descriptions',
      nodeId,
      classColumn,
      descriptionColumn,
    ] as const,

  /**
   * Full backend node info — schema, columns, shape, undo/redo flags.
   * Replaces the previous `lib/nodeInfoCache.ts` parallel cache and is also
   * the source of truth for schema-only readers.
   */
  nodeInfo: (workspaceId: string, nodeId: string) =>
    ['workspaces', workspaceId, 'nodes', nodeId, 'info'] as const,

  /** Batched backend node info for selectors that need metadata for several nodes at once. */
  nodeInfos: (workspaceId: string, nodeIds: string[]) =>
    ['workspaces', workspaceId, 'nodes', 'info', 'batch', ...nodeIds] as const,

  tokenizerModels: ['workspaces', 'tokenizer-models'] as const,

  /** Workspace graph topology consumed by the graph/sidebar workspace view. */
  workspaceGraph: (workspaceId: string) => ['workspaces', workspaceId, 'graph'] as const,

  /** All file-tree queries. */
  files: ['files'] as const,

  /** Paginated preview of an unsaved file (sheets/CSV/etc). */
  filePreview: (filename: string, page: number, pageSize: number, selectedSheet: string | null) =>
    ['file-preview', filename, page, pageSize, selectedSheet] as const,

  /** Per-column unique-value counts (used by sequential-analysis). */
  columnUniqueValues: (workspaceId: string, nodeId: string, columnName: string) =>
    ['workspaces', workspaceId, 'nodes', nodeId, 'columns', columnName, 'unique-values'] as const,

  /** Per-(analysisType, workspace) last-run request used by Run/Re-run diffing. */
  analysisLastRunRequest: (analysisType: string, workspaceId: string | null) =>
    ['analysis', analysisType, 'last-run-request', workspaceId] as const,
};
