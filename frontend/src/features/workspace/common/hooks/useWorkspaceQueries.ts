import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCurrentWorkspace, getNodeData, getWorkspaceGraph, listWorkspaces } from '@/api/generated/sdk.gen';
import { queryKeys } from '@/lib/queryKeys';
import type { GraphNode, NodeDataResponse } from '@/types/api';
import { type PaginationState } from './types';

// Frozen module-scope fallback so every "no node selected" render shares
// the same reference — the WorkspaceProvider's `data` slice would
// otherwise see a fresh `nodeData` literal every render and force every
// downstream consumer to re-render.
const EMPTY_NODE_DATA: NodeDataResponse = Object.freeze({
  data: [],
  pagination: {
    page: 0,
    page_size: 20,
    total_rows: 0,
    total_pages: 0,
    has_next: false,
    has_prev: false,
  },
  columns: [],
  dtypes: {},
  sorting: { sort_by: null, descending: false },
  filtering: { column: null, value: null, op: 'contains' },
}) as NodeDataResponse;

interface WorkspaceQueriesParams {
  authHeaders: Record<string, string>;
  isAuthenticated: boolean;
  currentWorkspaceId: string | null;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  getPaginationForNode: (nodeId?: string | null) => PaginationState;
}

export const useWorkspaceQueries = ({
  authHeaders,
  isAuthenticated,
  currentWorkspaceId,
  selectedNodeId,
  selectedNodeIds,
  getPaginationForNode,
}: WorkspaceQueriesParams) => {
  const workspacesQuery = useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: async () => {
      const { data } = await listWorkspaces({ headers: authHeaders, throwOnError: true });
      return data;
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });

  const currentWorkspaceQuery = useQuery({
    queryKey: queryKeys.currentWorkspace,
    queryFn: async () => {
      const { data } = await getCurrentWorkspace({ headers: authHeaders, throwOnError: true });
      return data.id ?? null;
    },
    enabled: isAuthenticated,
    staleTime: 60 * 1000,
  });

  const graphQuery = useQuery({
    queryKey: currentWorkspaceId
      ? queryKeys.workspaceGraph(currentWorkspaceId)
      : ['workspaces', 'graph'],
    queryFn: async () => {
      const { data } = await getWorkspaceGraph({ headers: authHeaders, throwOnError: true });
      return data;
    },
    enabled: isAuthenticated && !!currentWorkspaceId,
    refetchOnWindowFocus: false,
    staleTime: 30 * 1000,
  });

  const nodeDataQuery = useQuery({
    queryKey: queryKeys.nodeData(
      currentWorkspaceId ?? '',
      selectedNodeId ?? '',
      getPaginationForNode(selectedNodeId).currentPage,
      getPaginationForNode(selectedNodeId).pageSize,
      getPaginationForNode(selectedNodeId).sortBy,
      getPaginationForNode(selectedNodeId).descending,
      getPaginationForNode(selectedNodeId).filterColumn,
      getPaginationForNode(selectedNodeId).filterValue,
    ),
    queryFn: () => {
      if (!currentWorkspaceId || !selectedNodeId) throw new Error('Missing workspace or node ID');
      const { currentPage, pageSize, sortBy, descending, filterColumn, filterValue, filterOp } = getPaginationForNode(selectedNodeId);
      return getNodeData({
        headers: authHeaders,
        path: { node_id: selectedNodeId },
        query: {
          page: currentPage,
          page_size: pageSize,
          sort_by: sortBy ?? undefined,
          descending: descending ?? false,
          filter_column: filterColumn ?? undefined,
          filter_value: filterValue ?? undefined,
          filter_op: filterOp ?? 'contains',
        },
        throwOnError: true,
      }).then(({ data }) => data);
    },
    enabled: isAuthenticated && !!currentWorkspaceId && !!selectedNodeId,
    staleTime: 30 * 1000,
  });

  const workspaces = workspacesQuery.data || [];
  const currentWorkspace =
    workspaces.find((workspace) => workspace.id === currentWorkspaceId) || null;
  const workspaceGraph = graphQuery.data || null;

  const nodes = workspaceGraph?.nodes ?? [];
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;

  const selectedNodes = selectedNodeIds
        .map((id: string) => nodes.find((node) => node.id === id))
        .filter((n): n is GraphNode => Boolean(n));

  const nodeData: NodeDataResponse = nodeDataQuery.data ?? EMPTY_NODE_DATA;

  const queryLoadingState = useMemo(
    () => ({
      workspaces: workspacesQuery.isLoading,
      currentWorkspace: currentWorkspaceQuery.isLoading,
      nodes: graphQuery.isLoading,
      graph: graphQuery.isLoading,
      nodeData: nodeDataQuery.isLoading,
    }),
    [
      workspacesQuery.isLoading,
      currentWorkspaceQuery.isLoading,
      graphQuery.isLoading,
      nodeDataQuery.isLoading,
    ],
  );

  const queryErrorState = useMemo(
    () => ({
      workspaces: workspacesQuery.error?.message || null,
      currentWorkspace: currentWorkspaceQuery.error?.message || null,
      nodes: graphQuery.error?.message || null,
      graph: graphQuery.error?.message || null,
      nodeData: nodeDataQuery.error?.message || null,
    }),
    [
      workspacesQuery.error?.message,
      currentWorkspaceQuery.error?.message,
      graphQuery.error?.message,
      nodeDataQuery.error?.message,
    ],
  );

  return {
    workspacesQuery,
    currentWorkspaceQuery,
    graphQuery,
    nodeDataQuery,
    workspaces,
    currentWorkspace,
    workspaceGraph,
    nodes,
    selectedNode,
    selectedNodes,
    nodeData,
    queryLoadingState,
    queryErrorState,
    currentWorkspaceIdFromQuery: currentWorkspaceQuery.data,
    currentWorkspaceQueryError: currentWorkspaceQuery.isError,
  } as const;
};
