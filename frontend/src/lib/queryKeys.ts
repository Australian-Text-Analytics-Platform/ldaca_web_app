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

  /** Paginated node data. Passing only `page` keeps per-page caches distinct. */
  nodeData: (workspaceId: string, nodeId: string, page?: number, pageSize?: number) =>
    page !== undefined && pageSize !== undefined
      ? (['workspaces', workspaceId, 'nodes', nodeId, 'data', page, pageSize] as const)
      : page !== undefined
        ? (['workspaces', workspaceId, 'nodes', nodeId, 'data', page] as const)
        : (['workspaces', workspaceId, 'nodes', nodeId, 'data'] as const),

  nodeSchema: (workspaceId: string, nodeId: string) =>
    ['workspaces', workspaceId, 'nodes', nodeId, 'schema'] as const,

  workspaceGraph: (workspaceId: string) =>
    ['workspaces', workspaceId, 'graph'] as const,

  /** All file-tree queries. */
  files: ['files'] as const,
};
