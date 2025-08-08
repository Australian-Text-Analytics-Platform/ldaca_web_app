import { useCallback, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../stores/appStore';
import { useAuth } from './useAuth';
import { NodeSchemaResponse } from '../types';
import { 
  getWorkspaces, 
  getCurrentWorkspace, 
  getWorkspaceGraph,
  getNodeData,
  getNodeShape,
  getNodeSchema,
  castNode as apiCastNode,
  convertToDocDataFrame as apiConvertToDocDataFrame,
  convertToDataFrame as apiConvertToDataFrame,
  convertToDocLazyFrame as apiConvertToDocLazyFrame,
  convertToLazyFrame as apiConvertToLazyFrame,
  renameNode as apiRenameNode,
  deleteNode as apiDeleteNode,
  createNodeFromFile as apiCreateNodeFromFile,
  joinNodes as apiJoinNodes,
  filterNode,
  FilterRequest,
  concordanceSearch,
  detachConcordance,
  ConcordanceRequest,
  ConcordanceDetachRequest,
  setCurrentWorkspace as apiSetCurrentWorkspace,
  createWorkspace as apiCreateWorkspace,
  deleteWorkspace as apiDeleteWorkspace,
} from '../api';
import { queryKeys } from '../lib/queryKeys';

/**
 * Improved workspace hook that consolidates all workspace functionality
 * Prevents over-fetching and infinite loops through careful state management
 */
export const useWorkspace = () => {
  const { getAuthHeaders, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  
  // Get state from centralized store
  const {
    selection: { nodeId: selectedNodeId, nodeIds: selectedNodeIds },
    ui: { loading, errors },
    pagination,
    setPagination,
    setSelectedNode,
    setSelectedNodes,
    toggleNodeSelection,
    clearSelection,
    startOperation,
    endOperation,
    setOperationError,
  } = useAppStore();

  // Memoize auth headers to prevent unnecessary re-renders
  const authHeaders = useMemo(() => {
    if (!isAuthenticated) return {};
    const headers = getAuthHeaders();
    return headers.Authorization ? headers : {};
  }, [isAuthenticated, getAuthHeaders]);

  // Queries with proper stale time and caching
  const workspacesQuery = useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: () => getWorkspaces(authHeaders),
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false, // Don't retry auth errors
  });

  const currentWorkspaceQuery = useQuery({
    queryKey: queryKeys.currentWorkspace,
    queryFn: () => getCurrentWorkspace(authHeaders),
    enabled: isAuthenticated,
    staleTime: 1 * 60 * 1000, // 1 minute
    retry: false,
  });

  const currentWorkspaceId = currentWorkspaceQuery.data || null;

  // Remove the redundant nodesQuery - use only graphQuery as single source of truth
  // const nodesQuery = ... (REMOVED - using workspaceGraph.nodes instead)

  const graphQuery = useQuery({
    queryKey: currentWorkspaceId ? queryKeys.workspaceGraph(currentWorkspaceId) : ['workspaces', 'graph'],
    queryFn: async () => {
      const result = await getWorkspaceGraph(currentWorkspaceId!, authHeaders);
      console.log('=== API Response Success ===');
      console.log('API response structure:', {
        nodes: result?.nodes?.length || 0,
        edges: result?.edges?.length || 0,
        workspace_info: !!result?.workspace_info
      });
      
      if (result?.nodes && result.nodes.length > 0) {
        const sampleNode = result.nodes[0];
        console.log('Sample node structure:', {
          id: sampleNode.id,
          type: sampleNode.type,
          position: sampleNode.position,
          dataKeys: Object.keys(sampleNode.data || {}),
          sampleData: sampleNode.data
        });
      }
      
      return result;
    },
    enabled: isAuthenticated && !!currentWorkspaceId,
    refetchOnWindowFocus: false,
    staleTime: 30 * 1000, // 30 seconds
    retry: false,
  });

  // Only fetch node data for selected node
  const nodeDataQuery = useQuery({
    queryKey: queryKeys.nodeData(currentWorkspaceId!, selectedNodeId!, pagination[selectedNodeId!]?.currentPage || 1),
    queryFn: () => {
      const currentPage = pagination[selectedNodeId!]?.currentPage || 1;
      const pageSize = pagination[selectedNodeId!]?.pageSize || 50;
      return getNodeData(currentWorkspaceId!, selectedNodeId!, currentPage, pageSize, authHeaders);
    },
    enabled: isAuthenticated && !!currentWorkspaceId && !!selectedNodeId,
    staleTime: 30 * 1000, // 30 seconds
    retry: false,
  });

  // Computed values - ensure proper initialization order
  const workspaces = workspacesQuery.data || [];
  const currentWorkspace = workspaces.find((w: any) => w.workspace_id === currentWorkspaceId) || null;
  
  // Get graph data first
  const workspaceGraph = graphQuery.data || null;
  
    // Then compute dependent values
  const nodes = useMemo(() => workspaceGraph?.nodes || [], [workspaceGraph?.nodes]);
  const selectedNode = nodes.find((n: any) => n.id === selectedNodeId) || null;
  // Preserve selection order by mapping selectedNodeIds to their corresponding nodes
  // Memoize selectedNodes to prevent infinite re-renders
  const selectedNodes = useMemo(() => {
    return selectedNodeIds.map(id => nodes.find((n: any) => n.id === id)).filter(Boolean);
  }, [selectedNodeIds, nodes]);
  const nodeData = nodeDataQuery.data || { data: [], page: 0, total_pages: 0 };

  // Consolidated loading state
  const isLoading = useMemo(() => ({
    workspaces: workspacesQuery.isLoading,
    currentWorkspace: currentWorkspaceQuery.isLoading,
    nodes: graphQuery.isLoading, // Use graph loading state for nodes
    graph: graphQuery.isLoading,
    nodeData: nodeDataQuery.isLoading,
    operations: loading.operations.length > 0,
  }), [
    workspacesQuery.isLoading,
    currentWorkspaceQuery.isLoading,
    graphQuery.isLoading,
    nodeDataQuery.isLoading,
    loading.operations.length,
  ]);

  // Stable getNodeShape function to prevent infinite loops
  const getNodeShapeStable = useCallback(async (nodeId: string): Promise<{ shape: [number, number]; is_lazy: boolean; calculated: boolean } | null> => {
    if (!currentWorkspaceId) return null;
    
    try {
      const shapeData = await getNodeShape(currentWorkspaceId, nodeId, authHeaders);
      return shapeData;
    } catch (error) {
      console.error('Failed to get node shape:', error);
      return null;
    }
  }, [currentWorkspaceId, authHeaders]);

  // Consolidated error state
  const errorState = useMemo(() => ({
    workspaces: workspacesQuery.error?.message || null,
    currentWorkspace: currentWorkspaceQuery.error?.message || null,
    nodes: graphQuery.error?.message || null, // Use graph error state for nodes
    graph: graphQuery.error?.message || null,
    nodeData: nodeDataQuery.error?.message || null,
    operations: Object.values(errors.operations)[0] || null,
  }), [
    workspacesQuery.error,
    currentWorkspaceQuery.error,
    graphQuery.error,
    nodeDataQuery.error,
    errors.operations,
  ]);

  // Mutations with proper error handling and loading states
  const setCurrentWorkspaceMutation = useMutation({
    mutationFn: (workspaceId: string | null) => apiSetCurrentWorkspace(workspaceId, authHeaders),
    onMutate: () => {
      startOperation('setCurrentWorkspace');
    },
    onSuccess: () => {
      clearSelection();
      queryClient.invalidateQueries({ queryKey: queryKeys.currentWorkspace });
      queryClient.invalidateQueries({ queryKey: ['workspaces', '*', 'graph'] });
      endOperation('setCurrentWorkspace');
    },
    onError: (error: any) => {
      setOperationError('setCurrentWorkspace', error.message);
      endOperation('setCurrentWorkspace');
    },
  });

  const createWorkspaceMutation = useMutation({
    mutationFn: ({ name, description, initialDataFile }: { name: string; description?: string; initialDataFile?: string }) =>
      apiCreateWorkspace(name, description || '', authHeaders, initialDataFile),
    onMutate: () => {
      startOperation('createWorkspace');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      endOperation('createWorkspace');
    },
    onError: (error: any) => {
      setOperationError('createWorkspace', error.message);
      endOperation('createWorkspace');
    },
  });

  const deleteWorkspaceMutation = useMutation({
    mutationFn: (workspaceId: string) => apiDeleteWorkspace(workspaceId, authHeaders),
    onMutate: () => {
      startOperation('deleteWorkspace');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      endOperation('deleteWorkspace');
    },
    onError: (error: any) => {
      setOperationError('deleteWorkspace', error.message);
      endOperation('deleteWorkspace');
    },
  });

  const renameNodeMutation = useMutation({
    mutationFn: ({ workspaceId, nodeId, newName }: { workspaceId: string; nodeId: string; newName: string }) =>
      apiRenameNode(workspaceId, nodeId, newName, authHeaders),
    onMutate: () => {
      startOperation('renameNode');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId!) });
      endOperation('renameNode');
    },
    onError: (error: any) => {
      setOperationError('renameNode', error.message);
      endOperation('renameNode');
    },
  });

  const deleteNodeMutation = useMutation({
    mutationFn: ({ workspaceId, nodeId }: { workspaceId: string; nodeId: string }) =>
      apiDeleteNode(workspaceId, nodeId, authHeaders),
    onMutate: () => {
      startOperation('deleteNode');
    },
    onSuccess: (_, { nodeId }) => {
      // Clear selection if deleted node was selected
      if (selectedNodeId === nodeId) {
        clearSelection();
      }
      
      // Invalidate both graph and node data queries
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId!) });
      // Also invalidate the specific node data query to cancel any pending requests
      queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId!, nodeId) });
      
      endOperation('deleteNode');
    },
    onError: (error: any) => {
      setOperationError('deleteNode', error.message);
      endOperation('deleteNode');
    },
  });

  const createNodeMutation = useMutation({
    mutationFn: ({ workspaceId, filename }: { workspaceId: string; filename: string }) =>
      apiCreateNodeFromFile(workspaceId, filename, undefined, authHeaders),
    onMutate: () => {
      startOperation('createNode');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId!) });
      endOperation('createNode');
    },
    onError: (error: any) => {
      setOperationError('createNode', error.message);
      endOperation('createNode');
    },
  });

  const joinNodesMutation = useMutation({
    mutationFn: ({ workspaceId, leftNodeId, rightNodeId, joinType, leftColumns, rightColumns, newNodeName }: {
      workspaceId: string;
      leftNodeId: string;
      rightNodeId: string;
      joinType: string;
      leftColumns: string[];
      rightColumns: string[];
      newNodeName?: string;
    }) => {
      const request = {
        left_node_id: leftNodeId,
        right_node_id: rightNodeId,
        left_on: leftColumns[0] || '',
        right_on: rightColumns[0] || '',
        how: joinType as 'inner' | 'left' | 'right' | 'outer',
        new_node_name: newNodeName,
      };
      return apiJoinNodes(workspaceId, request, authHeaders);
    },
    onMutate: () => {
      startOperation('joinNodes');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId!) });
      endOperation('joinNodes');
    },
    onError: (error: any) => {
      setOperationError('joinNodes', error.message);
      endOperation('joinNodes');
    },
  });

  const filterNodeMutation = useMutation({
    mutationFn: ({ workspaceId, nodeId, request }: {
      workspaceId: string;
      nodeId: string;
      request: FilterRequest;
    }) => {
      return filterNode(workspaceId, nodeId, request, authHeaders);
    },
    onMutate: () => {
      startOperation('filterNode');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId!) });
      endOperation('filterNode');
    },
    onError: (error: any) => {
      setOperationError('filterNode', error.message);
      endOperation('filterNode');
    },
  });

  const concordanceMutation = useMutation({
    mutationFn: ({ workspaceId, nodeId, request }: {
      workspaceId: string;
      nodeId: string;
      request: ConcordanceRequest;
    }) => {
      return concordanceSearch(workspaceId, nodeId, request, authHeaders);
    },
    onMutate: () => {
      startOperation('concordance');
    },
    onSuccess: () => {
      endOperation('concordance');
    },
    onError: (error: any) => {
      setOperationError('concordance', error.message);
      endOperation('concordance');
    },
  });

  const detachConcordanceMutation = useMutation({
    mutationFn: ({ workspaceId, nodeId, request }: {
      workspaceId: string;
      nodeId: string;
      request: ConcordanceDetachRequest;
    }) => {
      return detachConcordance(workspaceId, nodeId, request, authHeaders);
    },
    onMutate: () => {
      startOperation('detachConcordance');
    },
    onSuccess: () => {
      // Invalidate the workspace graph to refresh the nodes
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId!) });
      endOperation('detachConcordance');
    },
    onError: (error: any) => {
      setOperationError('detachConcordance', error.message);
      endOperation('detachConcordance');
    },
  });

  const castNodeMutation = useMutation({
    mutationFn: ({ nodeId, column, targetType, format }: {
      nodeId: string;
      column: string;
      targetType: string;
      format?: string;
    }) => {
      const request = {
        column,
        target_type: targetType,
        format,
      };
      return apiCastNode(currentWorkspaceId!, nodeId, request, authHeaders);
    },
    onMutate: () => {
      startOperation('castNode');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId!, selectedNodeId!) });
      endOperation('castNode');
    },
    onError: (error: any) => {
      setOperationError('castNode', error.message);
      endOperation('castNode');
    },
  });

  // Conversions
  const convertToDocDataFrameMutation = useMutation({
    mutationFn: ({ nodeId, documentColumn }: { nodeId: string; documentColumn: string; }) => {
      return apiConvertToDocDataFrame(currentWorkspaceId!, nodeId, documentColumn, authHeaders);
    },
    onMutate: () => startOperation('convertToDocDataFrame'),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId!) });
      if (variables?.nodeId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId!, variables.nodeId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId!, variables.nodeId) });
      }
      endOperation('convertToDocDataFrame');
    },
    onError: (error: any) => {
      setOperationError('convertToDocDataFrame', error.message);
      endOperation('convertToDocDataFrame');
    },
  });

  const convertToDataFrameMutation = useMutation({
    mutationFn: ({ nodeId }: { nodeId: string; }) => {
      return apiConvertToDataFrame(currentWorkspaceId!, nodeId, authHeaders);
    },
    onMutate: () => startOperation('convertToDataFrame'),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId!) });
      if (variables?.nodeId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId!, variables.nodeId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId!, variables.nodeId) });
      }
      endOperation('convertToDataFrame');
    },
    onError: (error: any) => {
      setOperationError('convertToDataFrame', error.message);
      endOperation('convertToDataFrame');
    },
  });

  const convertToDocLazyFrameMutation = useMutation({
    mutationFn: ({ nodeId, documentColumn }: { nodeId: string; documentColumn: string; }) => {
      return apiConvertToDocLazyFrame(currentWorkspaceId!, nodeId, documentColumn, authHeaders);
    },
    onMutate: () => startOperation('convertToDocLazyFrame'),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId!) });
      if (variables?.nodeId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId!, variables.nodeId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId!, variables.nodeId) });
      }
      endOperation('convertToDocLazyFrame');
    },
    onError: (error: any) => {
      setOperationError('convertToDocLazyFrame', error.message);
      endOperation('convertToDocLazyFrame');
    },
  });

  const convertToLazyFrameMutation = useMutation({
    mutationFn: ({ nodeId }: { nodeId: string; }) => {
      return apiConvertToLazyFrame(currentWorkspaceId!, nodeId, authHeaders);
    },
    onMutate: () => startOperation('convertToLazyFrame'),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId!) });
      if (variables?.nodeId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId!, variables.nodeId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId!, variables.nodeId) });
      }
      endOperation('convertToLazyFrame');
    },
    onError: (error: any) => {
      setOperationError('convertToLazyFrame', error.message);
      endOperation('convertToLazyFrame');
    },
  });

  // Memoized action functions to prevent unnecessary re-renders
  const actions = useMemo(() => ({
    // Workspace actions
    setCurrentWorkspace: (workspaceId: string | null) => {
      setCurrentWorkspaceMutation.mutate(workspaceId);
    },
    
    createWorkspace: (name: string, description?: string, initialDataFile?: string) => {
      return createWorkspaceMutation.mutateAsync({ name, description, initialDataFile });
    },
    
    deleteWorkspace: (workspaceId: string) => {
      return deleteWorkspaceMutation.mutateAsync(workspaceId);
    },

    // Node actions
    selectNode: setSelectedNode,
    selectNodes: setSelectedNodes,
    toggleNodeSelection,
    clearSelection,
    
    renameNode: (nodeId: string, newName: string) => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return renameNodeMutation.mutateAsync({ workspaceId: currentWorkspaceId, nodeId, newName });
    },
    
    deleteNode: (nodeId: string) => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return deleteNodeMutation.mutateAsync({ workspaceId: currentWorkspaceId, nodeId });
    },
    
    createNodeFromFile: (filename: string) => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return createNodeMutation.mutateAsync({ workspaceId: currentWorkspaceId, filename });
    },
    
  joinNodes: (leftNodeId: string, rightNodeId: string, joinType: string, leftColumns: string[], rightColumns: string[], newNodeName?: string) => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return joinNodesMutation.mutateAsync({
        workspaceId: currentWorkspaceId,
        leftNodeId,
        rightNodeId,
        joinType,
        leftColumns,
    rightColumns,
    newNodeName,
      });
    },
    
    castColumn: (nodeId: string, column: string, targetType: string, format?: string) => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return castNodeMutation.mutateAsync({ nodeId, column, targetType, format });
    },

    convertToDocDataFrame: (nodeId: string, documentColumn: string) => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return convertToDocDataFrameMutation.mutateAsync({ nodeId, documentColumn });
    },

    convertToDataFrame: (nodeId: string) => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return convertToDataFrameMutation.mutateAsync({ nodeId });
    },

    convertToDocLazyFrame: (nodeId: string, documentColumn: string) => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return convertToDocLazyFrameMutation.mutateAsync({ nodeId, documentColumn });
    },

    convertToLazyFrame: (nodeId: string) => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return convertToLazyFrameMutation.mutateAsync({ nodeId });
    },
    
    filterNode: (nodeId: string, request: FilterRequest) => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return filterNodeMutation.mutateAsync({ workspaceId: currentWorkspaceId, nodeId, request });
    },
    
    concordanceSearch: (nodeId: string, request: ConcordanceRequest) => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return concordanceMutation.mutateAsync({ workspaceId: currentWorkspaceId, nodeId, request });
    },

    detachConcordance: (nodeId: string, request: ConcordanceDetachRequest) => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return detachConcordanceMutation.mutateAsync({ workspaceId: currentWorkspaceId, nodeId, request });
    },
    
    refreshNodeSchema: async (nodeId: string): Promise<NodeSchemaResponse | null> => {
      if (!currentWorkspaceId) return null;
      
      // Check if the node still exists in the current graph before trying to fetch schema
      const graphData = queryClient.getQueryData(queryKeys.workspaceGraph(currentWorkspaceId)) as any;
      const currentNodes = graphData?.nodes || [];
      const nodeExists = currentNodes.some((node: any) => node.id === nodeId);
      
      if (!nodeExists) {
        console.log(`Node ${nodeId} no longer exists, skipping schema refresh`);
        return null;
      }
      
      try {
        const schema = await getNodeSchema(currentWorkspaceId, nodeId, authHeaders);
        // Return in the format expected by DataTable component
        return {
          node_id: nodeId,
          schema: schema,  // Record<string, string> with js_type compatible values
          columns: Object.keys(schema),
          column_types: schema,  // Also provide as column_types for fallback
          is_text_data: false
        };
      } catch (error) {
        console.error('Failed to refresh node schema:', error);
        return null;
      }
    },
    
    getNodeShape: getNodeShapeStable,
  }), [
    setCurrentWorkspaceMutation,
    createWorkspaceMutation,
    deleteWorkspaceMutation,
    setSelectedNode,
    setSelectedNodes,
    toggleNodeSelection,
    clearSelection,
    renameNodeMutation,
    deleteNodeMutation,
    createNodeMutation,
    joinNodesMutation,
    filterNodeMutation,
    concordanceMutation,
    detachConcordanceMutation,
    castNodeMutation,
  convertToDocDataFrameMutation,
  convertToDataFrameMutation,
  convertToDocLazyFrameMutation,
  convertToLazyFrameMutation,
    getNodeShapeStable,
    currentWorkspaceId,
    authHeaders,
    queryClient,
  ]);

  // Pagination management functions
  const handlePageChange = useCallback((page: number) => {
    if (selectedNodeId) {
      const currentPageSize = pagination[selectedNodeId]?.pageSize || 50;
      setPagination(selectedNodeId, {
        currentPage: page,
        pageSize: currentPageSize,
        totalPages: pagination[selectedNodeId]?.totalPages || 1
      });
      
      // The query will automatically refetch due to queryKey dependency
    }
  }, [selectedNodeId, pagination]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePageSizeChange = useCallback((pageSize: number) => {
    if (selectedNodeId) {
      setPagination(selectedNodeId, {
        currentPage: 1, // Reset to first page when changing page size
        pageSize: pageSize,
        totalPages: pagination[selectedNodeId]?.totalPages || 1
      });
      
      // The query will automatically refetch due to queryKey dependency
    }
  }, [selectedNodeId, pagination, setPagination]);

  // Reset pagination when node selection changes
  useEffect(() => {
    if (selectedNodeId && !pagination[selectedNodeId]) {
      setPagination(selectedNodeId, {
        currentPage: 1,
        pageSize: 50,
        totalPages: 1
      });
    }
  }, [selectedNodeId, pagination, setPagination]);

  return {
    // Data
    workspaces,
    currentWorkspace,
    currentWorkspaceId,
    nodes,
    selectedNode,
    selectedNodes,
    selectedNodeId,
    selectedNodeIds,
    workspaceGraph,
    nodeData,
    
    // State
    isLoading,
    errors: errorState,
    
    // Actions
    ...actions,
    
    // Pagination
    handlePageChange,
    handlePageSizeChange,
  };
};
