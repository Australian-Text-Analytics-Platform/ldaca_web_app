export interface NodeDataRequest {
  page: number;
  page_size: number;
  sort_by: string | null;
  descending: boolean;
}

export type AnalysisResultQueryKey = Readonly<Record<string, unknown>>;

/**
 * Builds the complete node-data query shape used by SQL and cache identity.
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

  /** Every cached server resource owned by one Analysis session. */
  analysisSession: (workspaceId: string, analysisId: string) =>
    ['workspaces', workspaceId, 'analyses', analysisId] as const,

  /** Stable paginated list of Analyses owned by one Workspace. */
  workspaceAnalyses: (workspaceId: string) =>
    ['workspaces', workspaceId, 'analyses', 'list'] as const,

  /** Canonical lifecycle and immutable request for one Analysis. */
  analysis: (workspaceId: string, analysisId: string) =>
    ['workspaces', workspaceId, 'analyses', analysisId, 'resource'] as const,

  /** Every output projection belonging to one successful Analysis. */
  analysisResults: (workspaceId: string, analysisId: string) =>
    ['workspaces', workspaceId, 'analyses', analysisId, 'results'] as const,

  /** Output-only Result keyed by the complete projection query. */
  analysisResult: (workspaceId: string, analysisId: string, query?: AnalysisResultQueryKey) =>
    [...queryKeys.analysisResults(workspaceId, analysisId), query ?? { kind: 'default' }] as const,

  /** Paginated user-owned file imports shown in the Task Inbox. */
  userFileImports: ['user-file-imports', 'list'] as const,

  /** One authoritative user-owned file import resource. */
  userFileImport: (importId: string) => ['user-file-imports', importId] as const,

  /** All durable Tabs for one Workspace, shared by every analysis view. */
  workspaceTabs: (workspaceId: string) => ['workspaces', workspaceId, 'tabs'] as const,

  /** Workspace SQL pages include every declared Data Block dependency. */
  workspaceSql: (
    workspaceId: string,
    nodeIds: string[],
    sql: string,
    page: number,
    pageSize: number,
  ) => ['workspaces', workspaceId, 'sql', { nodeIds: [...nodeIds], sql, page, pageSize }] as const,

  /** Infinite SQL projection whose page identity is owned by TanStack Query's page params. */
  workspaceSqlInfinite: (workspaceId: string, nodeIds: string[], sql: string, pageSize: number) =>
    ['workspaces', workspaceId, 'sql', { nodeIds: [...nodeIds], sql, pageSize }] as const,

  /** Complete multi-page SQL projection drained into one immutable resource. */
  workspaceSqlDrain: (workspaceId: string, nodeIds: string[], sql: string, pageSize: number) =>
    [
      'workspaces',
      workspaceId,
      'sql',
      { mode: 'drain', nodeIds: [...nodeIds], sql, pageSize },
    ] as const,

  /** Authoritative Arrow schema for one data block. */
  nodeSchema: (workspaceId: string, nodeId: string) =>
    ['workspaces', workspaceId, 'nodes', nodeId, 'schema'] as const,

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
};
