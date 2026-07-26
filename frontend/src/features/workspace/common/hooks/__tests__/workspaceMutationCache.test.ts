import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '@/lib/queryKeys';
import {
  invalidateNodeWorkspaceQueries,
  invalidateWorkspaceSummaries,
} from '../workspaceMutationCache';

const createClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });

describe('workspaceMutationCache', () => {
  it('refreshes the Workspace list without invalidating Workspace detail resources', () => {
    const queryClient = createClient();
    const graphKey = queryKeys.workspaceGraph('workspace-1');
    queryClient.setQueryData(queryKeys.workspaceList, [{ id: 'workspace-1' }]);
    queryClient.setQueryData(graphKey, { nodes: [], edges: [] });

    invalidateWorkspaceSummaries(queryClient);

    expect(queryClient.getQueryState(queryKeys.workspaceList)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(graphKey)?.isInvalidated).toBe(false);
  });

  it('invalidates every node-dependent data projection and leaves unrelated nodes fresh', () => {
    const queryClient = createClient();
    const graphKey = queryKeys.workspaceGraph('workspace-1');
    const nodeOneSql = queryKeys.workspaceSql(
      'workspace-1',
      ['node-1'],
      'SELECT * FROM "node-1"',
      1,
      20,
    );
    const nodeTwoSql = queryKeys.workspaceSql(
      'workspace-1',
      ['node-2'],
      'SELECT * FROM "node-2"',
      1,
      20,
    );
    const nodeOneUnique = queryKeys.columnUniqueValues('workspace-1', 'node-1', 'kind');
    const nodeTwoUnique = queryKeys.columnUniqueValues('workspace-1', 'node-2', 'kind');
    const nodeOnePreview = queryKeys.preprocessingPreview(
      'workspace-1',
      'filter',
      ['node-1'],
      { conditions: [] },
      1,
      10,
    );
    const nodeTwoPreview = queryKeys.preprocessingPreview(
      'workspace-1',
      'filter',
      ['node-2'],
      { conditions: [] },
      1,
      10,
    );

    for (const key of [
      graphKey,
      nodeOneSql,
      nodeTwoSql,
      nodeOneUnique,
      nodeTwoUnique,
      nodeOnePreview,
      nodeTwoPreview,
    ]) {
      queryClient.setQueryData(key, {});
    }

    invalidateNodeWorkspaceQueries(queryClient, 'workspace-1', 'node-1', {
      includeData: true,
    });

    expect(queryClient.getQueryState(graphKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(nodeOneSql)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(nodeOneUnique)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(nodeOnePreview)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(nodeTwoSql)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(nodeTwoUnique)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(nodeTwoPreview)?.isInvalidated).toBe(false);
  });
});
