/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
import { useCallback, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSelectionStore } from '../stores/selectionStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useUIStore } from '../stores/uiStore';
import { useAuth } from './useAuth';
import { NodeSchemaResponse } from '../types';
// New modular API imports
import { workspacesApi } from '../api/workspaces';
import { nodesApi, FilterRequest } from '../api/nodes';
import { textApi, ConcordanceRequest, ConcordanceDetachRequest, QuotationRequest, QuotationDetachRequest, ConcordanceAnalysisRequest } from '../api/text';
import { queryKeys } from '../lib/queryKeys';

/**
 * Improved workspace hook that consolidates all workspace functionality
 * Prevents over-fetching and infinite loops through careful state management
 */
export const useWorkspaceInternal = () => {
  const { getAuthHeaders, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  
  // Selection state/actions
  const {
    selectedNodeId,
    selectedNodeIds,
    selectNode,
    setSelectedNodes,
    toggleNodeSelection,
    clearAllSelections,
  } = useSelectionStore();

  // Workspace pagination state/actions
  const {
    currentWorkspaceId,
    setCurrentWorkspaceId,
    pagination,
    setPagination,
    updateCurrentPage,
    updatePageSize,
  } = useWorkspaceStore();

  // UI loading/error state/actions
  const {
    loadingOperations,
    operationErrors,
    startOperation,
    endOperation,
    setOperationError,
  } = useUIStore();

  const setSelectedNode = selectNode;
  const clearSelection = clearAllSelections;

  const loadingOperationCount = useMemo(() => {
    if (loadingOperations instanceof Set) {
      return loadingOperations.size;
    }
    return 0;
  }, [loadingOperations]);

  const operationErrorsRecord = useMemo(() => {
    if (!operationErrors) {
      return {} as Record<string, string>;
    }
    if (operationErrors instanceof Map) {
      const result: Record<string, string> = {};
      operationErrors.forEach((value, key) => {
        if (typeof value === 'string') {
          result[key] = value;
        }
      });
      return result;
    }
    if (typeof operationErrors === 'object') {
      const entries = Object.entries(operationErrors as Record<string, string>);
      return entries.reduce<Record<string, string>>((acc, [key, value]) => {
        if (typeof value === 'string') {
          acc[key] = value;
        }
        return acc;
      }, {});
    }
    return {} as Record<string, string>;
  }, [operationErrors]);

  // Memoize auth headers to prevent unnecessary re-renders
  const authHeaders = useMemo(() => {
    if (!isAuthenticated) return {};
    const headers = getAuthHeaders();
    return headers.Authorization ? headers : {};
  }, [isAuthenticated, getAuthHeaders]);

  // Queries with proper stale time and caching
  const workspacesQuery = useQuery({
    queryKey: queryKeys.workspaces,
  queryFn: () => workspacesApi.list(authHeaders),
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false, // Don't retry auth errors
  });

  const currentWorkspaceQuery = useQuery({
    queryKey: queryKeys.currentWorkspace,
  queryFn: () => workspacesApi.current.get(authHeaders),
    enabled: isAuthenticated,
    staleTime: 1 * 60 * 1000, // 1 minute
    retry: false,
  });

  const currentWorkspaceIdFromQuery = currentWorkspaceQuery.data;
  const currentWorkspaceQueryError = currentWorkspaceQuery.isError;

  useEffect(() => {
    if (!isAuthenticated) {
      setCurrentWorkspaceId(null);
      return;
    }

    if (currentWorkspaceIdFromQuery !== undefined) {
      if (currentWorkspaceIdFromQuery !== currentWorkspaceId) {
        setCurrentWorkspaceId(currentWorkspaceIdFromQuery);
      }
    } else if (currentWorkspaceQueryError) {
      setCurrentWorkspaceId(null);
    }
  }, [
    isAuthenticated,
    currentWorkspaceIdFromQuery,
    currentWorkspaceQueryError,
    currentWorkspaceId,
    setCurrentWorkspaceId,
  ]);

  const previousWorkspaceIdRef = useRef<string | null>(currentWorkspaceId);

  useEffect(() => {
    const previous = previousWorkspaceIdRef.current;
    if (previous !== currentWorkspaceId) {
      if (previous !== null) {
        clearSelection();
      }
      previousWorkspaceIdRef.current = currentWorkspaceId;
    }
  }, [currentWorkspaceId, clearSelection]);

  const graphQuery = useQuery({
    queryKey: currentWorkspaceId ? queryKeys.workspaceGraph(currentWorkspaceId) : ['workspaces', 'graph'],
    queryFn: async () => {
  const result = await workspacesApi.graph(currentWorkspaceId!, authHeaders);
      if (localStorage.getItem('debugGraph') === '1') {
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
  } // end debugGraph logging block
  return result;
    },
    enabled: isAuthenticated && !!currentWorkspaceId,
    refetchOnWindowFocus: false,
    staleTime: 30 * 1000, // 30 seconds
    retry: false,
  });

  // Only fetch node data for selected node
  const nodeDataQuery = useQuery({
    queryKey: queryKeys.nodeData(
      currentWorkspaceId!, 
      selectedNodeId!, 
      pagination[selectedNodeId!]?.currentPage || 1,
      pagination[selectedNodeId!]?.pageSize || 20
    ),
    queryFn: () => {
      const currentPage = pagination[selectedNodeId!]?.currentPage || 1;
      const pageSize = pagination[selectedNodeId!]?.pageSize || 20;
  return nodesApi.data(currentWorkspaceId!, selectedNodeId!, currentPage, pageSize, authHeaders);
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
    return selectedNodeIds
      .map((id: string) => nodes.find((n: any) => n.id === id))
      .filter(Boolean);
  }, [selectedNodeIds, nodes]);
  const nodeData = nodeDataQuery.data || { data: [], page: 0, total_pages: 0 };

  // Consolidated loading state
  const isLoading = useMemo(() => ({
    workspaces: workspacesQuery.isLoading,
    currentWorkspace: currentWorkspaceQuery.isLoading,
    nodes: graphQuery.isLoading, // Use graph loading state for nodes
    graph: graphQuery.isLoading,
    nodeData: nodeDataQuery.isLoading,
    operations: loadingOperationCount > 0,
  }), [
    workspacesQuery.isLoading,
    currentWorkspaceQuery.isLoading,
    graphQuery.isLoading,
    nodeDataQuery.isLoading,
    loadingOperationCount,
  ]);

  // Stable getNodeShape function to prevent infinite loops
  const getNodeShapeStable = useCallback(async (nodeId: string): Promise<{ shape: [number, number]; is_lazy: boolean; calculated: boolean } | null> => {
    if (!currentWorkspaceId) return null;

    const cacheKey = `node-shape:${currentWorkspaceId}:${nodeId}`;
    try {
      if (typeof window !== 'undefined') {
        const cached = window.sessionStorage.getItem(cacheKey);
        if (cached) {
          const parts = cached.split('×').map(s => s.trim());
          if (parts.length === 2) {
            const r = parseInt(parts[0], 10);
            const c = parseInt(parts[1], 10);
            if (!Number.isNaN(r) && !Number.isNaN(c)) {
              return { shape: [r, c], is_lazy: false, calculated: true } as any;
            }
          }
        }
      }
  } catch { /* ignore */ }

    try {
      const shapeData = await nodesApi.shape(currentWorkspaceId, nodeId, authHeaders);
      try {
        if (shapeData?.shape && typeof window !== 'undefined') {
          window.sessionStorage.setItem(cacheKey, `${shapeData.shape[0]} × ${shapeData.shape[1]}`);
        }
  } catch { /* ignore */ }
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
    operations: Object.values(operationErrorsRecord)[0] || null,
  }), [
    workspacesQuery.error,
    currentWorkspaceQuery.error,
    graphQuery.error,
    nodeDataQuery.error,
    operationErrorsRecord,
  ]);

  // Mutations with proper error handling and loading states
  const setCurrentWorkspaceMutation = useMutation({
    mutationFn: (workspaceId: string | null) => workspacesApi.current.set(workspaceId, authHeaders),
    onMutate: () => {
      startOperation('setCurrentWorkspace');
    },
    onSuccess: (_data, workspaceId) => {
      setCurrentWorkspaceId(workspaceId ?? null);
      clearSelection();
      queryClient.invalidateQueries({ queryKey: queryKeys.currentWorkspace });
      queryClient.invalidateQueries({
        predicate: ({ queryKey }) =>
          Array.isArray(queryKey) &&
          queryKey[0] === 'workspaces' &&
          queryKey.some((part) => part === 'graph'),
      });
      endOperation('setCurrentWorkspace');
    },
    onError: (error: any) => {
      setOperationError('setCurrentWorkspace', error.message);
      endOperation('setCurrentWorkspace');
    },
  });

  const createWorkspaceMutation = useMutation({
    mutationFn: ({ name, description }: { name: string; description?: string }) =>
      workspacesApi.create(name, description || '', authHeaders),
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
    mutationFn: (workspaceId: string) => workspacesApi.delete(workspaceId, authHeaders),
    onMutate: () => {
      startOperation('deleteWorkspace');
    },
    onSuccess: (_data, workspaceId) => {
      if (currentWorkspaceId && workspaceId === currentWorkspaceId) {
        setCurrentWorkspaceId(null);
        clearSelection();
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      queryClient.invalidateQueries({ queryKey: queryKeys.currentWorkspace });
      endOperation('deleteWorkspace');
    },
    onError: (error: any) => {
      setOperationError('deleteWorkspace', error.message);
      endOperation('deleteWorkspace');
    },
  });

  const saveWorkspaceMutation = useMutation({
    mutationFn: () => workspacesApi.save(currentWorkspaceId!, authHeaders),
    onMutate: () => startOperation('saveWorkspace'),
    onSuccess: () => {
      endOperation('saveWorkspace');
    },
    onError: (error: any) => {
      setOperationError('saveWorkspace', error.message);
      endOperation('saveWorkspace');
    },
  });

  const saveWorkspaceAsMutation = useMutation({
    mutationFn: (filename: string) => workspacesApi.saveAs(currentWorkspaceId!, filename, authHeaders),
    onMutate: () => startOperation('saveWorkspaceAs'),
    onSuccess: (data: any) => {
      // If backend returned the new workspace info, merge it into cache so UI updates immediately
      const newWs = data?.new_workspace;
      if (newWs) {
        queryClient.setQueryData(queryKeys.workspaces, (old: any) => {
          if (!old) return [newWs];
          const exists = old.some((w: any) => w.workspace_id === newWs.workspace_id);
          return exists ? old : [...old, newWs];
        });
        // Optionally set as current (commented out; enable if desired)
        // queryClient.setQueryData(queryKeys.currentWorkspace, newWs.workspace_id);
      } else {
        // Fallback: invalidate list if structure unexpected
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      }
      endOperation('saveWorkspaceAs');
    },
    onError: (error: any) => {
      setOperationError('saveWorkspaceAs', error.message);
      endOperation('saveWorkspaceAs');
    },
  });

  const updateWorkspaceNameMutation = useMutation({
    mutationFn: (newName: string) => workspacesApi.updateName(currentWorkspaceId!, newName, authHeaders),
    onMutate: () => startOperation('updateWorkspaceName'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      queryClient.invalidateQueries({ queryKey: queryKeys.currentWorkspace });
      endOperation('updateWorkspaceName');
    },
    onError: (error: any) => {
      setOperationError('updateWorkspaceName', error.message);
      endOperation('updateWorkspaceName');
    },
  });

  const renameNodeMutation = useMutation({
    mutationFn: ({ workspaceId, nodeId, newName }: { workspaceId: string; nodeId: string; newName: string }) =>
      nodesApi.rename(workspaceId, nodeId, newName, authHeaders),
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
      nodesApi.delete(workspaceId, nodeId, authHeaders),
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
    mutationFn: ({ workspaceId, filename, mode, documentColumn }: { workspaceId: string; filename: string; mode?: 'DocLazyFrame' | 'LazyFrame' | 'DocDataFrame' | 'DataFrame'; documentColumn?: string | null }) =>
      nodesApi.createFromFile(workspaceId, filename, undefined, authHeaders, { mode, document_column: documentColumn ?? undefined }),
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
  how: joinType as 'inner' | 'left' | 'right' | 'full' | 'semi' | 'anti' | 'cross',
        new_node_name: newNodeName,
      };
  return nodesApi.join(workspaceId, request as any, authHeaders);
    },
    onMutate: async () => {
      startOperation('joinNodes');
      // Snapshot current node ids so we can diff later if API response omits id
      let previousNodeIds: string[] = [];
      try {
        if (currentWorkspaceId) {
          const prevGraph: any = queryClient.getQueryData(queryKeys.workspaceGraph(currentWorkspaceId));
          previousNodeIds = (prevGraph?.nodes || []).map((n: any) => n.id);
        }
  } catch { /* ignore */ }
      // Proactively clear existing selection so parent nodes lose highlight immediately
      clearSelection();
      return { previousNodeIds };
    },
    onSuccess: async (createdNode: any, _vars, context: any) => {
      // Single Source of Truth: ensure visual highlight follows selection state.
      // Clear prior selection (original two nodes) and auto-select the newly created join node.
      try {
        let newId = createdNode?.node_id || createdNode?.id;
        if (!newId && currentWorkspaceId) {
          // Await graph refetch to diff node ids
          await queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
          const freshGraph: any = queryClient.getQueryData(queryKeys.workspaceGraph(currentWorkspaceId));
          if (freshGraph?.nodes) {
            const prevIds: string[] = context?.previousNodeIds || [];
            const diff = freshGraph.nodes.map((n: any) => n.id).filter((id: string) => !prevIds.includes(id));
            if (diff.length === 1) newId = diff[0];
          }
        }
        if (newId) setSelectedNodes([newId]); else clearSelection();
      } catch {
        // Non-fatal; proceed with graph refresh
        clearSelection();
      }
      // Ensure graph is invalidated (if not already done above during diff)
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
      }
      endOperation('joinNodes');
    },
    onError: (error: any) => {
      setOperationError('joinNodes', error.message);
      endOperation('joinNodes');
    },
  });

  const concatNodesMutation = useMutation({
    mutationFn: ({ workspaceId, nodeIds, newNodeName }: {
      workspaceId: string;
      nodeIds: string[];
      newNodeName?: string;
    }) => nodesApi.concat(workspaceId, { node_ids: nodeIds, new_node_name: newNodeName }, authHeaders),
    onMutate: async () => {
      startOperation('concatNodes');
      let previousNodeIds: string[] = [];
      try {
        if (currentWorkspaceId) {
          const prevGraph: any = queryClient.getQueryData(queryKeys.workspaceGraph(currentWorkspaceId));
          previousNodeIds = (prevGraph?.nodes || []).map((n: any) => n.id);
        }
      } catch { /* ignore */ }
      clearSelection();
      return { previousNodeIds };
    },
    onSuccess: async (createdNode: any, _vars, context: any) => {
      try {
        let newId = createdNode?.node_id || createdNode?.id;
        if (!newId && currentWorkspaceId) {
          await queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
          const freshGraph: any = queryClient.getQueryData(queryKeys.workspaceGraph(currentWorkspaceId));
          if (freshGraph?.nodes) {
            const prevIds: string[] = context?.previousNodeIds || [];
            const diff = freshGraph.nodes.map((n: any) => n.id).filter((id: string) => !prevIds.includes(id));
            if (diff.length === 1) newId = diff[0];
          }
        }
        if (newId) setSelectedNodes([newId]); else clearSelection();
      } catch {
        clearSelection();
      }
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
      }
      endOperation('concatNodes');
    },
    onError: (error: any) => {
      setOperationError('concatNodes', error.message);
      endOperation('concatNodes');
    },
  });

  const filterNodeMutation = useMutation({
    mutationFn: ({ workspaceId, nodeId, request }: {
      workspaceId: string;
      nodeId: string;
      request: FilterRequest;
    }) => {
  return nodesApi.filter(workspaceId, nodeId, request, authHeaders);
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
      const unifiedRequest: ConcordanceAnalysisRequest = {
        node_ids: [nodeId],
        node_columns: { [nodeId]: request.column },
        search_word: request.search_word,
        num_left_tokens: request.num_left_tokens,
        num_right_tokens: request.num_right_tokens,
        regex: request.regex,
        case_sensitive: request.case_sensitive,
        combined: false,
      };
      if (request.sort_by) {
        unifiedRequest.sort_by = request.sort_by;
      }
      return textApi.concordance(workspaceId, unifiedRequest, authHeaders);
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
  return textApi.concordanceDetach(workspaceId, nodeId, request as any, authHeaders);
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

  // Quotation mutations
  const quotationMutation = useMutation({
    mutationFn: ({ workspaceId, nodeId, request }: {
      workspaceId: string;
      nodeId: string;
      request: QuotationRequest;
    }) => {
  return textApi.quotation(workspaceId, nodeId, request as any, authHeaders);
    },
    onMutate: () => {
      startOperation('quotation');
    },
    onSuccess: () => {
      endOperation('quotation');
    },
    onError: (error: any) => {
      setOperationError('quotation', error.message);
      endOperation('quotation');
    },
  });

  const detachQuotationMutation = useMutation({
    mutationFn: ({ workspaceId, nodeId, request }: {
      workspaceId: string;
      nodeId: string;
      request: QuotationDetachRequest;
    }) => {
  return textApi.quotationDetach(workspaceId, nodeId, request as any, authHeaders);
    },
    onMutate: () => {
      startOperation('detachQuotation');
    },
    onSuccess: () => {
      // Invalidate the workspace graph to refresh the nodes
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId!) });
      endOperation('detachQuotation');
    },
    onError: (error: any) => {
      setOperationError('detachQuotation', error.message);
      endOperation('detachQuotation');
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
  return nodesApi.cast(currentWorkspaceId!, nodeId, request as any, authHeaders);
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
  return nodesApi.convert(currentWorkspaceId!, nodeId, 'docdataframe', documentColumn, authHeaders);
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
  return nodesApi.convert(currentWorkspaceId!, nodeId, 'dataframe', undefined, authHeaders);
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
  return nodesApi.convert(currentWorkspaceId!, nodeId, 'doclazyframe', documentColumn, authHeaders);
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
  return nodesApi.convert(currentWorkspaceId!, nodeId, 'lazyframe', undefined, authHeaders);
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

  const resetDocumentColumnMutation = useMutation({
    mutationFn: ({ nodeId, documentColumn }: { nodeId: string; documentColumn?: string; }) => {
  return nodesApi.resetDocument(currentWorkspaceId!, nodeId, documentColumn, authHeaders);
    },
    onMutate: async ({ nodeId, documentColumn }) => {
      startOperation('resetDocumentColumn');
      if (!currentWorkspaceId) return;
      await queryClient.cancelQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
      const previous = queryClient.getQueryData(queryKeys.workspaceGraph(currentWorkspaceId));
      queryClient.setQueryData(
        queryKeys.workspaceGraph(currentWorkspaceId),
        (old: any) => {
          if (!old?.nodes) return old;
          return {
            ...old,
            nodes: old.nodes.map((n: any) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, documentColumn: documentColumn || n.data?.documentColumn } }
                : n
            ),
          };
        }
      );
      return { previous };
    },
    onSuccess: (_data, variables) => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        if (variables?.nodeId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, variables.nodeId) });
          queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId, variables.nodeId) });
        }
      }
      endOperation('resetDocumentColumn');
    },
    onError: (error: any, _vars, context: any) => {
      setOperationError('resetDocumentColumn', error.message);
      if (context?.previous && currentWorkspaceId) {
        queryClient.setQueryData(queryKeys.workspaceGraph(currentWorkspaceId), context.previous);
      }
      endOperation('resetDocumentColumn');
    },
  });

  // Memoized action functions to prevent unnecessary re-renders
  const actions = useMemo(() => ({
    // Workspace actions
    setCurrentWorkspace: (workspaceId: string | null) => {
      setCurrentWorkspaceMutation.mutate(workspaceId);
    },
    
    createWorkspace: (name: string, description?: string) => {
      return createWorkspaceMutation.mutateAsync({ name, description });
    },
    
    deleteWorkspace: (workspaceId: string) => {
      return deleteWorkspaceMutation.mutateAsync(workspaceId);
    },

    saveWorkspace: () => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return saveWorkspaceMutation.mutateAsync();
    },

    saveWorkspaceAs: (filename: string) => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return saveWorkspaceAsMutation.mutateAsync(filename);
    },

    renameWorkspace: (newName: string) => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return updateWorkspaceNameMutation.mutateAsync(newName);
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
    
  createNodeFromFile: (filename: string, opts?: { mode?: 'DocLazyFrame' | 'LazyFrame' | 'DocDataFrame' | 'DataFrame'; documentColumn?: string | null }) => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return createNodeMutation.mutateAsync({ workspaceId: currentWorkspaceId, filename, mode: opts?.mode, documentColumn: opts?.documentColumn });
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

    concatNodes: (nodeIds: string[], newNodeName?: string) => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return concatNodesMutation.mutateAsync({ workspaceId: currentWorkspaceId, nodeIds, newNodeName });
    },

    concatPreview: (nodeIds: string[], page = 1, pageSize = 10) => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return nodesApi.concatPreview(currentWorkspaceId, { node_ids: nodeIds }, page, pageSize, authHeaders);
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

    resetDocumentColumn: (nodeId: string, documentColumn?: string) => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return resetDocumentColumnMutation.mutateAsync({ nodeId, documentColumn });
    },
    
    filterNode: (nodeId: string, request: FilterRequest) => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return filterNodeMutation.mutateAsync({ workspaceId: currentWorkspaceId, nodeId, request });
    },

    filterPreview: (nodeId: string, request: FilterRequest, page = 1, pageSize = 10) => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return nodesApi.filterPreview(currentWorkspaceId, nodeId, request, page, pageSize, authHeaders);
    },
    
    concordanceSearch: (nodeId: string, request: ConcordanceRequest) => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return concordanceMutation.mutateAsync({ workspaceId: currentWorkspaceId, nodeId, request });
    },

    detachConcordance: (nodeId: string, request: ConcordanceDetachRequest) => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return detachConcordanceMutation.mutateAsync({ workspaceId: currentWorkspaceId, nodeId, request });
    },

    quotationSearch: (nodeId: string, request: QuotationRequest) => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return quotationMutation.mutateAsync({ workspaceId: currentWorkspaceId, nodeId, request });
    },

    detachQuotation: (nodeId: string, request: QuotationDetachRequest) => {
      if (!currentWorkspaceId) return Promise.reject(new Error('No workspace selected'));
      return detachQuotationMutation.mutateAsync({ workspaceId: currentWorkspaceId, nodeId, request });
    },
    
    refreshNodeSchema: async (nodeId: string): Promise<NodeSchemaResponse | null> => {
      if (!currentWorkspaceId) return null;
      
      // Check if the node still exists in the current graph before trying to fetch schema
      const graphData = queryClient.getQueryData(queryKeys.workspaceGraph(currentWorkspaceId)) as any;
      const currentNodes = graphData?.nodes || [];
      const nodeExists = currentNodes.some((node: any) => node.id === nodeId);
      
      if (!nodeExists) {
  if (localStorage.getItem('debugGraph') === '1') console.log(`Node ${nodeId} no longer exists, skipping schema refresh`);
        return null;
      }
      
      try {
  const schema = await nodesApi.info(currentWorkspaceId, nodeId, authHeaders).then((d:any)=> d.schema || {});
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
  quotationMutation,
  detachQuotationMutation,
    castNodeMutation,
  convertToDocDataFrameMutation,
  convertToDataFrameMutation,
  convertToDocLazyFrameMutation,
  convertToLazyFrameMutation,
  resetDocumentColumnMutation,
  saveWorkspaceMutation,
  saveWorkspaceAsMutation,
  updateWorkspaceNameMutation,
    concatNodesMutation,
    getNodeShapeStable,
    currentWorkspaceId,
    authHeaders,
    queryClient,
  ]);

  // Pagination management functions
  const handlePageChange = useCallback((page: number) => {
    if (!selectedNodeId) return;
    updateCurrentPage(selectedNodeId, page);
    // The query will automatically refetch due to queryKey dependency
  }, [selectedNodeId, updateCurrentPage]);

  const handlePageSizeChange = useCallback((pageSize: number) => {
    if (!selectedNodeId) return;
    updatePageSize(selectedNodeId, pageSize);
    // The query will automatically refetch due to queryKey dependency
  }, [selectedNodeId, updatePageSize]);

  // Reset pagination when node selection changes
  useEffect(() => {
    if (selectedNodeId && !pagination[selectedNodeId]) {
      setPagination(selectedNodeId, {
        currentPage: 1,
        pageSize: 20,
        totalPages: 1,
        totalItems: 0,
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

  // Structured actions object for context consumers
  actions,

  // Actions (legacy spread for direct access)
  ...actions,
    
    // Pagination
    handlePageChange,
    handlePageSizeChange,
  };
};
