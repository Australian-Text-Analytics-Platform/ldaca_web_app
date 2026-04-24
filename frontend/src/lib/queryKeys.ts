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

  workspaceGraph: (workspaceId: string) =>
    ['workspaces', workspaceId, 'graph'] as const,

  /** All file-tree queries. */
  files: ['files'] as const,
};
