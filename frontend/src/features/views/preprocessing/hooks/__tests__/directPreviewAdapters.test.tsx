import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const joinNodesPreviewMock = vi.hoisted(() => vi.fn());
const usePreprocessingPreviewMock = vi.hoisted(() => vi.fn());

vi.mock('@/api', () => ({
  joinNodesPreview: joinNodesPreviewMock,
}));

vi.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => ({
    getAuthHeaders: () => ({ Authorization: 'Bearer test' }),
  }),
}));

vi.mock('../../hooks/usePreprocessingPreview', () => ({
  usePreprocessingPreview: usePreprocessingPreviewMock,
}));

import { useConcatSubTab } from '../../concat/hooks/useConcatSubTab';
import { useJoinSubTab } from '../../join/hooks/useJoinSubTab';
import { projectWorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';

const previewState = {
  data: [],
  columns: [],
  pagination: null,
  loading: false,
  error: null,
  ready: true,
  page: 1,
  pageSize: 10,
  setPage: vi.fn(),
  setPageSize: vi.fn(),
  refresh: vi.fn(),
};

describe('direct preprocessing preview adapters', () => {
  beforeEach(() => {
    joinNodesPreviewMock.mockReset();
    usePreprocessingPreviewMock.mockReset();
    usePreprocessingPreviewMock.mockReturnValue(previewState);
  });

  it('maps the Join request workspace and exact signal to the generated client', async () => {
    joinNodesPreviewMock.mockResolvedValue({
      data: { data: [], columns: [], pagination: null },
    });
    const workspaceNodes = [
      projectWorkspaceNodeMetadata(
        { id: 'left', name: 'Left' },
        { id: 'left', name: 'Left', columns: ['id'], schema: { id: 'String' } },
      ),
      projectWorkspaceNodeMetadata(
        { id: 'right', name: 'Right' },
        { id: 'right', name: 'Right', columns: ['id'], schema: { id: 'String' } },
      ),
    ];

    renderHook(() =>
      useJoinSubTab({
        selectedNodeIds: ['left', 'right'],
        selectedNodeColumns: {},
        currentWorkspaceId: 'closure-workspace',
        workspaceNodes,
        getColumnInfos: () => [{ name: 'id', dataType: 'string' }],
        joinNodes: vi.fn(),
        isLoading: { operations: false },
        onAlert: vi.fn(),
      }),
    );

    const fetcher = usePreprocessingPreviewMock.mock.calls[0]?.[0].fetcher as (args: {
      request: {
        workspaceId: string;
        leftNodeId: string;
        rightNodeId: string;
        joinType: 'left';
      };
      page: number;
      pageSize: number;
      signal: AbortSignal;
    }) => Promise<unknown>;
    const signal = new AbortController().signal;
    await fetcher({
      request: {
        workspaceId: 'request-workspace',
        leftNodeId: 'left',
        rightNodeId: 'right',
        joinType: 'left',
      },
      page: 2,
      pageSize: 25,
      signal,
    });

    expect(joinNodesPreviewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { workspace_id: 'request-workspace' },
        query: expect.objectContaining({ page: 2, page_size: 25 }),
        signal,
      }),
    );
  });

  it('maps the Stack request workspace and exact signal to its workspace action', async () => {
    const concatPreview = vi.fn().mockResolvedValue({ data: [], columns: [], pagination: null });
    const workspaceNodes = [
      projectWorkspaceNodeMetadata(
        { id: 'node-1', name: 'One' },
        { id: 'node-1', name: 'One', columns: ['id'], schema: { id: 'String' } },
      ),
      projectWorkspaceNodeMetadata(
        { id: 'node-2', name: 'Two' },
        { id: 'node-2', name: 'Two', columns: ['id'], schema: { id: 'String' } },
      ),
    ];

    renderHook(() =>
      useConcatSubTab({
        selectedNodeIds: ['node-1', 'node-2'],
        currentWorkspaceId: 'closure-workspace',
        workspaceNodes,
        getColumnInfos: () => [{ name: 'id', dataType: 'string' }],
        concatPreview,
        concatNodes: vi.fn(),
        isLoading: { operations: false },
        onAlert: vi.fn(),
      }),
    );

    const fetcher = usePreprocessingPreviewMock.mock.calls[0]?.[0].fetcher as (args: {
      request: { workspaceId: string; nodeIds: string[]; deduplicate: boolean };
      page: number;
      pageSize: number;
      signal: AbortSignal;
    }) => Promise<unknown>;
    const signal = new AbortController().signal;
    await fetcher({
      request: {
        workspaceId: 'request-workspace',
        nodeIds: ['node-1', 'node-2'],
        deduplicate: true,
      },
      page: 2,
      pageSize: 25,
      signal,
    });

    expect(concatPreview).toHaveBeenCalledWith({
      workspaceId: 'request-workspace',
      nodeIds: ['node-1', 'node-2'],
      deduplicate: true,
      page: 2,
      pageSize: 25,
      signal,
    });
  });
});
