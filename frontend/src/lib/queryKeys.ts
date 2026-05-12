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

  /** The currently active workspace ID (written directly to the cache). */
  currentWorkspace: ['workspaces', 'current'] as const,

  workspaceNodes: (workspaceId: string) =>
    ['workspaces', workspaceId, 'nodes'] as const,

  /** Paginated node data. Includes page, size, sort, and filter for distinct cache entries. */
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

  nodeSchema: (workspaceId: string, nodeId: string) =>
    ['workspaces', workspaceId, 'nodes', nodeId, 'schema'] as const,

  /**
   * Full backend node info (`GET /workspaces/nodes/:id`) — schema, columns,
   * shape, undo/redo flags. Replaces the previous `lib/nodeInfoCache.ts`
   * parallel cache. `nodeSchema` lives separately so it can be invalidated
   * without dropping the heavier full-info payload.
   */
  nodeInfo: (workspaceId: string, nodeId: string) =>
    ['workspaces', workspaceId, 'nodes', nodeId, 'info'] as const,

  workspaceGraph: (workspaceId: string) =>
    ['workspaces', workspaceId, 'graph'] as const,

  /** All file-tree queries. */
  files: ['files'] as const,

  /** Paginated preview of an unsaved file (sheets/CSV/etc). */
  filePreview: (
    filename: string,
    page: number,
    pageSize: number,
    selectedSheet: string | null,
  ) => ['file-preview', filename, page, pageSize, selectedSheet] as const,

  /** Per-column unique-value counts (used by sequential-analysis). */
  columnUniqueValues: (workspaceId: string, nodeId: string, columnName: string) =>
    ['workspaces', workspaceId, 'nodes', nodeId, 'columns', columnName, 'unique-values'] as const,

  /** Per-(analysisType, workspace) server-request-lock used by useAnalysisServerRequestLock. */
  analysisServerRequestLock: (
    analysisType: string,
    workspaceId: string | null,
  ) => ['analysis', analysisType, 'server-request-lock', workspaceId] as const,

  /** Cached bundled stop-word list for a language (served from
   *  ``/text/default-stop-words``). ``strict`` is part of the key
   *  because it changes the unknown-language fallback behaviour. */
  defaultStopWords: (language: string, strict: boolean) =>
    ['default-stop-words', language, strict] as const,
};
