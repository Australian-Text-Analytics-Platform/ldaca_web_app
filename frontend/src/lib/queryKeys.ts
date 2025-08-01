// Query key factory for consistent key management
export const queryKeys = {
  // Workspaces
  workspaces: ['workspaces'] as const,
  currentWorkspace: ['workspaces', 'current'] as const,
  workspace: (id: string) => ['workspaces', id] as const,
  
  // Nodes
  workspaceNodes: (workspaceId: string) => ['workspaces', workspaceId, 'nodes'] as const,
  node: (workspaceId: string, nodeId: string) => ['workspaces', workspaceId, 'nodes', nodeId] as const,
  nodeData: (workspaceId: string, nodeId: string, page?: number) => 
    page !== undefined 
      ? ['workspaces', workspaceId, 'nodes', nodeId, 'data', page] as const
      : ['workspaces', workspaceId, 'nodes', nodeId, 'data'] as const,
  nodeSchema: (workspaceId: string, nodeId: string) => 
    ['workspaces', workspaceId, 'nodes', nodeId, 'schema'] as const,
  
  // Graph
  workspaceGraph: (workspaceId: string) => ['workspaces', workspaceId, 'graph'] as const,
  
  // Files
  files: ['files'] as const,
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
