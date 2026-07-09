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

  /** Paginated node data. Includes page, size, sort, and filter for distinct cache entries. */
  /**
   * Returns the node-data prefix for broad invalidation, or appends
   * page/sort/filter values for a concrete table request.
   */
  nodeData: (
    workspaceId: string,
    nodeId: string,
    page?: number,
    pageSize?: number,
    sortBy?: string | null,
    descending?: boolean,
    filterColumn?: string | null,
    filterValue?: string | null,
  ) => {
    const base = ['workspaces', workspaceId, 'nodes', nodeId, 'data'] as const;
    if (page === undefined || pageSize === undefined) return base;
    return [
      ...base,
      page,
      pageSize,
      sortBy ?? null,
      descending ?? false,
      filterColumn ?? null,
      filterValue ?? null,
    ] as const;
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
