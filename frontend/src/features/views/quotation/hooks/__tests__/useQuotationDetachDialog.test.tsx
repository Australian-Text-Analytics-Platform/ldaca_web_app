import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { analysisTaskDetachOptions } from '@/api';
import { useQuotationDetachDialog } from '../useQuotationDetachDialog';

vi.mock('@/api', () => ({
  analysisTaskDetachOptions: vi.fn(),
}));

const mockedAnalysisTaskDetachOptions = vi.mocked(analysisTaskDetachOptions);

const getAuthHeaders = vi.fn(() => ({ Authorization: 'Bearer test-token' }));
const resolveTaskId = vi.fn(() => Promise.resolve('task-1'));
const handleDetach = vi.fn(
  (_nodeId: string, _selectedColumns: string[], _materializedPath: string | null) =>
    Promise.resolve(),
);
const showErrorDialog = vi.fn();

const defaultArgs = {
  workspaceId: 'workspace-1',
  activeSelections: [{ nodeId: 'node-1', column: 'text' }],
  resolveTaskId,
  getAuthHeaders,
  handleDetach,
  materializedPaths: { 'node-1': '/tmp/node-1.parquet' },
  nodeDetaching: {},
  showErrorDialog,
};

describe('useQuotationDetachDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTaskId.mockResolvedValue('task-1');
    mockedAnalysisTaskDetachOptions.mockResolvedValue({
      data: {
        state: 'successful',
        message: 'ok',
        data: {
          nodes: [
            {
              node_id: 'node-1',
              node_name: 'Node 1',
              available_columns: ['text', 'speaker'],
              disabled_columns: [],
              text_column: 'text',
            },
          ],
        },
      },
      error: undefined,
    });
  });

  it('opens with empty source-column selections and confirms with the materialized path', async () => {
    const { result } = renderHook(() => useQuotationDetachDialog(defaultArgs));

    await act(async () => {
      await result.current.openDetachDialog('node-1');
    });

    expect(mockedAnalysisTaskDetachOptions).toHaveBeenCalledWith({
      path: { workspace_id: 'workspace-1', task_id: 'task-1' },
      query: { node_id: 'node-1', column: 'text' },
      throwOnError: true,
    });
    expect(result.current.detachDialog.open).toBe(true);
    expect(result.current.detachDialog.detachNodeOptions).toHaveLength(1);
    expect(result.current.detachDialog.selectedDetachColumns).toEqual({
      'node-1': [],
    });

    act(() => {
      result.current.detachDialog.toggleDetachColumn('node-1', 'speaker', true);
    });

    await act(async () => {
      await result.current.detachDialog.handleDetachConfirm();
    });

    expect(handleDetach).toHaveBeenCalledWith('node-1', ['speaker'], '/tmp/node-1.parquet');
    expect(result.current.detachDialog.open).toBe(false);
    expect(result.current.detachDialog.selectedDetachColumns).toEqual({});
  });

  it('does not load options when the node has no active text column', async () => {
    const { result } = renderHook(() =>
      useQuotationDetachDialog({
        ...defaultArgs,
        activeSelections: [{ nodeId: 'node-1', column: '' }],
      }),
    );

    await act(async () => {
      await result.current.openDetachDialog('node-1');
    });

    expect(mockedAnalysisTaskDetachOptions).not.toHaveBeenCalled();
    expect(result.current.detachDialog.open).toBe(false);
  });

  it('reports load failures and leaves the dialog closed', async () => {
    mockedAnalysisTaskDetachOptions.mockRejectedValueOnce(new Error('options failed'));
    const { result } = renderHook(() => useQuotationDetachDialog(defaultArgs));

    await act(async () => {
      await result.current.openDetachDialog('node-1');
    });

    expect(showErrorDialog).toHaveBeenCalledWith('options failed');
    expect(result.current.detachDialog.open).toBe(false);
    expect(result.current.detachDialog.detachNodeOptions).toEqual([]);
  });
});
