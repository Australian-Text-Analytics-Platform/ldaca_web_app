import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const previewNodeCreationTableMock = vi.hoisted(() => vi.fn());
const usePreprocessingPreviewMock = vi.hoisted(() => vi.fn());

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  previewNodeCreationTable: previewNodeCreationTableMock,
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
    previewNodeCreationTableMock.mockReset();
    usePreprocessingPreviewMock.mockReset();
    usePreprocessingPreviewMock.mockReturnValue(previewState);
  });

  it('maps the Join request workspace and exact signal to the generated client', async () => {
    previewNodeCreationTableMock.mockResolvedValue({ rows: [], columns: [], hasNext: false });
    const workspaceNodes = [
      projectWorkspaceNodeMetadata({ id: 'left', name: 'Left' }),
      projectWorkspaceNodeMetadata({ id: 'right', name: 'Right' }),
    ];

    renderHook(() =>
      useJoinSubTab({
        selectedNodeIds: ['left', 'right'],
        selectedNodeColumns: {},
        setSelectedNodeColumns: vi.fn(),
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

    expect(previewNodeCreationTableMock).toHaveBeenCalledWith(
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
      projectWorkspaceNodeMetadata({ id: 'node-1', name: 'One' }),
      projectWorkspaceNodeMetadata({ id: 'node-2', name: 'Two' }),
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
