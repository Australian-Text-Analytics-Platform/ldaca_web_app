/**
 * Query key factory for consistent TanStack Query key management across the application.
 * 
 * This factory ensures that all query keys follow a consistent hierarchical structure,
 * making cache invalidation predictable and preventing key collisions.
 * 
 * @example
 * ```tsx
 * // Fetch workspace data
 * useQuery({ queryKey: queryKeys.workspace('ws-123'), ... })
 * 
 * // Invalidate all workspace queries
 * queryClient.invalidateQueries({ queryKey: queryKeys.workspaces })
 * 
 * // Invalidate specific node data
 * queryClient.invalidateQueries({ 
 *   queryKey: queryKeys.nodeData('ws-123', 'node-456') 
 * })
 * ```
 */
export const queryKeys = {
  // Workspaces
  /** Base key for all workspace-related queries */
  workspaces: ['workspaces'] as const,
  
  /** Key for the current active workspace */
  currentWorkspace: ['workspaces', 'current'] as const,
  
  /**
   * Key for a specific workspace by ID
   * @param id - Workspace identifier
   */
  workspace: (id: string) => ['workspaces', id] as const,
  
  // Nodes
  /**
   * Key for all nodes within a workspace
   * @param workspaceId - Workspace identifier
   */
  workspaceNodes: (workspaceId: string) => ['workspaces', workspaceId, 'nodes'] as const,
  
  /**
   * Key for a specific node
   * @param workspaceId - Workspace identifier
   * @param nodeId - Node identifier
   */
  node: (workspaceId: string, nodeId: string) => ['workspaces', workspaceId, 'nodes', nodeId] as const,
  
  /**
   * Key for node data with optional pagination
   * @param workspaceId - Workspace identifier
   * @param nodeId - Node identifier
   * @param page - Optional page number (0-indexed)
   * @param pageSize - Optional number of rows per page
   */
  nodeData: (workspaceId: string, nodeId: string, page?: number, pageSize?: number) => 
    page !== undefined && pageSize !== undefined
      ? ['workspaces', workspaceId, 'nodes', nodeId, 'data', page, pageSize] as const
      : page !== undefined 
        ? ['workspaces', workspaceId, 'nodes', nodeId, 'data', page] as const
        : ['workspaces', workspaceId, 'nodes', nodeId, 'data'] as const,
  
  /**
   * Key for node schema information
   * @param workspaceId - Workspace identifier
   * @param nodeId - Node identifier
   */
  nodeSchema: (workspaceId: string, nodeId: string) => 
    ['workspaces', workspaceId, 'nodes', nodeId, 'schema'] as const,
  
  // Graph
  /**
   * Key for workspace graph visualization data
   * @param workspaceId - Workspace identifier
   */
  workspaceGraph: (workspaceId: string) => ['workspaces', workspaceId, 'graph'] as const,
  
  // Text Analysis
  /**
   * Key for concordance analysis results
   * @param workspaceId - Workspace identifier
   * @param nodeIds - Array of node identifiers to analyze
   * @param searchWord - Word or phrase to search for
   * @param leftTokens - Number of context tokens to the left
   * @param rightTokens - Number of context tokens to the right
   * @param regex - Whether to use regex matching
   * @param caseSensitive - Whether search is case-sensitive
   * @param combined - Whether to combine results across nodes
   */
  concordance: (workspaceId: string, nodeIds: string[], searchWord: string, leftTokens?: number, rightTokens?: number, regex?: boolean, caseSensitive?: boolean, combined?: boolean) =>
    ['workspaces', workspaceId, 'concordance', nodeIds, searchWord, leftTokens, rightTokens, regex, caseSensitive, combined] as const,
  
  /**
   * Key for token frequency analysis results
   * @param workspaceId - Workspace identifier
   * @param nodeIds - Array of node identifiers to analyze
   * @param stopWords - Optional array of stop words to exclude
   */
  tokenFrequencies: (workspaceId: string, nodeIds: string[], stopWords?: string[]) =>
    ['workspaces', workspaceId, 'token-frequencies', nodeIds, stopWords] as const,
  
  /**
   * Key for topic modeling analysis results
   * @param workspaceId - Workspace identifier
   * @param nodeIds - Array of node identifiers to analyze
   */
  topicModeling: (workspaceId: string, nodeIds: string[]) =>
    ['workspaces', workspaceId, 'topic-modeling', nodeIds] as const,
  
  // Files
  /** Base key for all file-related queries */
  files: ['files'] as const,
  
  /**
   * Key for a specific file by filename
   * @param filename - Name of the file
   */
  file: (filename: string) => ['files', filename] as const,
};

// Type helpers for query keys
export type QueryKey = 
  | typeof queryKeys.workspaces
  | typeof queryKeys.currentWorkspace
  | ReturnType<typeof queryKeys.workspace>
  | ReturnType<typeof queryKeys.workspaceNodes>
  | ReturnType<typeof queryKeys.node>
  | ReturnType<typeof queryKeys.nodeData>
  | ReturnType<typeof queryKeys.nodeSchema>
  | ReturnType<typeof queryKeys.workspaceGraph>
  | typeof queryKeys.files
  | ReturnType<typeof queryKeys.file>;
