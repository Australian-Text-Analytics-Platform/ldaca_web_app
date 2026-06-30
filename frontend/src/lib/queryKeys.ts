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
/**
 * Used by: src/components/dialogs/DataFolderDialog.tsx, src/components/dialogs/__tests__/DataFolderDialog.test.tsx, src/features/views/common/components/TokenizerModelSelector.tsx and 14 other importers because the tests need reusable fixtures or mocks before exercising the behavior under assertion.
 * Flow: validate inputs, normalize values, branch on runtime conditions, then return the shared result.
 */
export const queryKeys = {
  /** All workspace-related queries (broad invalidation). */
  workspaces: ['workspaces'] as const,

  /** The currently active workspace ID (written directly to the cache). */
  currentWorkspace: ['workspaces', 'current'] as const,

  /** Nodes list for a workspace; invalidated after graph-changing workspace mutations. */
  /** Consumed by: TanStack Query hooks and invalidation helpers because query callers need stable cache keys, fetchers, and invalidation targets for the request lifecycle. */
  workspaceNodes: (workspaceId: string) => ['workspaces', workspaceId, 'nodes'] as const,

  /** Paginated node data. Includes page, size, sort, and filter for distinct cache entries. */
  /**
   * Consumed by: TanStack Query hooks and invalidation helpers because query callers need stable cache keys, fetchers, and invalidation targets for the request lifecycle.
   * Flow: return the node-data prefix for broad invalidation, or append page/sort/filter values for a concrete table request.
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

  /** Lightweight schema cache for panels that only need columns/types, not full node info. */
  /** Consumed by: TanStack Query hooks and invalidation helpers because query callers need stable cache keys, fetchers, and invalidation targets for the request lifecycle. */
  nodeSchema: (workspaceId: string, nodeId: string) =>
    ['workspaces', workspaceId, 'nodes', nodeId, 'schema'] as const,

  /**
   * Full backend node info (`GET /workspaces/nodes/:id`) — schema, columns,
   * shape, undo/redo flags. Replaces the previous `lib/nodeInfoCache.ts`
   * parallel cache. `nodeSchema` lives separately so it can be invalidated
   * without dropping the heavier full-info payload.
   */
  /** Consumed by: TanStack Query hooks and invalidation helpers because query callers need stable cache keys, fetchers, and invalidation targets for the request lifecycle. */
  nodeInfo: (workspaceId: string, nodeId: string) =>
    ['workspaces', workspaceId, 'nodes', nodeId, 'info'] as const,

  tokenizerModels: ['workspaces', 'tokenizer-models'] as const,

  /**
   * Workspace graph topology consumed by the graph/sidebar workspace view.
   * Why: importers need one shared normalization boundary to keep behavior consistent.
   */
  workspaceGraph: (workspaceId: string) => ['workspaces', workspaceId, 'graph'] as const,

  /** All file-tree queries. */
  files: ['files'] as const,

  /** Paginated preview of an unsaved file (sheets/CSV/etc). */
  /** Consumed by: TanStack Query hooks and invalidation helpers because query callers need stable cache keys, fetchers, and invalidation targets for the request lifecycle. */
  filePreview: (filename: string, page: number, pageSize: number, selectedSheet: string | null) =>
    ['file-preview', filename, page, pageSize, selectedSheet] as const,

  /**
   * Per-column unique-value counts (used by sequential-analysis).
   * Why: importers need one shared normalization boundary to keep behavior consistent.
   */
  columnUniqueValues: (workspaceId: string, nodeId: string, columnName: string) =>
    ['workspaces', workspaceId, 'nodes', nodeId, 'columns', columnName, 'unique-values'] as const,

  /**
   * Per-(analysisType, workspace) last-run request used by Run/Re-run diffing.
   * Why: importers need one shared normalization boundary to keep behavior consistent.
   */
  analysisLastRunRequest: (analysisType: string, workspaceId: string | null) =>
    ['analysis', analysisType, 'last-run-request', workspaceId] as const,
};
