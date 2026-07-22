import type { QueryClient } from '@tanstack/react-query';
import type { WorkspaceGraphResponse, WorkspaceNodeInfo } from '@/api';
import { invalidateNodeInfoQuery } from '@/lib/nodeInfo';
import { queryKeys } from '@/lib/queryKeys';

type NodePreferenceField = 'document' | 'tokenizer_model';

const isNodeInfoBatchKey = (queryKey: readonly unknown[], workspaceId: string): boolean =>
  queryKey[0] === 'workspaces' &&
  queryKey[1] === workspaceId &&
  queryKey[2] === 'nodes' &&
  queryKey[3] === 'info' &&
  queryKey[4] === 'batch';

/** Applies only the field written by one preference PATCH to every relevant cache. */
/**
 * Used by: document-column and tokenizer preference persistence hooks.
 * Flow: merge one returned field into graph and node-info caches, preserving a
 * concurrently returned value for the other independent preference, then
 * refresh both server projections.
 */
export function updateNodePreferenceCache(
  queryClient: QueryClient,
  workspaceId: string,
  nodeId: string,
  field: NodePreferenceField,
  value: string | null,
): void {
  queryClient.setQueryData<WorkspaceGraphResponse>(
    queryKeys.workspaceGraph(workspaceId),
    (previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        nodes: previous.nodes.map((node) =>
          node.id === nodeId ? { ...node, [field]: value } : node,
        ),
      };
    },
  );
  queryClient.setQueriesData<WorkspaceNodeInfo[]>(
    {
      predicate: (query) =>
        Array.isArray(query.queryKey) && isNodeInfoBatchKey(query.queryKey, workspaceId),
    },
    (previous) =>
      previous?.map((node) => (node.id === nodeId ? { ...node, [field]: value } : node)),
  );
  void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(workspaceId) });
  invalidateNodeInfoQuery(queryClient, workspaceId, nodeId);
}
