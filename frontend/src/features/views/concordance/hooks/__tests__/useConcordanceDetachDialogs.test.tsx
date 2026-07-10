import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { analysisTaskDetachOptions } from '@/api';
import { useConcordanceDetachDialogs } from '../useConcordanceDetachDialogs';

vi.mock('@/api', () => ({
  analysisTaskDetachOptions: vi.fn(),
}));

const mockedAnalysisTaskDetachOptions = vi.mocked(analysisTaskDetachOptions);

const getAuthHeaders = vi.fn(() => ({ Authorization: 'Bearer test-token' }));
const resolveTaskId = vi.fn(() => Promise.resolve('task-1'));
const handleDetach = vi.fn(
  (
    _nodeId: string,
    _column: string,
    _nodeLabel: string,
    _selectedColumns: string[],
    _materializedPath: string | null,
  ) => Promise.resolve(),
);
const handleDispersionDetach = vi.fn(
  (
    _nodeId: string,
    _column: string,
    _options: {
      nodeLabel: string;
      materializedPath: string | null;
      selectedBins: ReadonlySet<number> | null;
      binCount: number;
      selectedColumns: string[];
      selectedMatchedTexts: string[] | null;
      matchCaseInsensitive: boolean;
    },
  ) => Promise.resolve(),
);

const defaultArgs = {
  workspaceId: 'workspace-1',
  resolveTaskId,
  getAuthHeaders,
  handleDetach,
  handleDispersionDetach,
  materializedPaths: { 'node-1': '/tmp/node-1.parquet' },
  nodeDetaching: {},
};

describe('useConcordanceDetachDialogs', () => {
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
              available_columns: [
                'text',
                'CONC_left_context',
                'CONC_matched_text',
                'CONC_extraction',
                'speaker',
              ],
              disabled_columns: ['CONC_matched_text'],
              text_column: 'text',
            },
          ],
        },
      },
      error: undefined,
    });
  });

  it('opens the per-hit dialog with generated concordance columns selected by default', async () => {
    const { result } = renderHook(() => useConcordanceDetachDialogs(defaultArgs));

    await act(async () => {
      await result.current.openDetachDialog([
        { nodeId: 'node-1', column: 'text', nodeLabel: 'Node 1' },
      ]);
    });

    expect(mockedAnalysisTaskDetachOptions).toHaveBeenCalledWith({
      path: { workspace_id: 'workspace-1', task_id: 'task-1' },
      query: { node_id: 'node-1', column: 'text' },
      throwOnError: true,
    });
    expect(result.current.detachDialog.open).toBe(true);
    expect(result.current.detachDialog.detachNodeOptions).toHaveLength(1);
    expect(result.current.detachDialog.selectedDetachColumns).toEqual({
      'node-1': ['CONC_left_context', 'CONC_matched_text', 'CONC_extraction'],
    });

    await act(async () => {
      await result.current.detachDialog.handleDetachConfirm();
    });

    expect(handleDetach).toHaveBeenCalledWith(
      'node-1',
      'text',
      'Node 1',
      ['CONC_left_context', 'CONC_matched_text', 'CONC_extraction'],
      '/tmp/node-1.parquet',
    );
    expect(result.current.detachDialog.open).toBe(false);
    expect(result.current.detachDialog.selectedDetachColumns).toEqual({});
  });

  it('resets per-hit dialog payload and selected columns when closed without confirming', async () => {
    const { result } = renderHook(() => useConcordanceDetachDialogs(defaultArgs));

    await act(async () => {
      await result.current.openDetachDialog([
        { nodeId: 'node-1', column: 'text', nodeLabel: 'Node 1' },
      ]);
    });

    expect(result.current.detachDialog.open).toBe(true);
    expect(result.current.detachDialog.detachNodeOptions).toHaveLength(1);
    expect(result.current.detachDialog.selectedDetachColumns['node-1']).toContain(
      'CONC_extraction',
    );

    act(() => {
      result.current.detachDialog.onOpenChange(false);
    });

    expect(result.current.detachDialog.open).toBe(false);
    expect(result.current.detachDialog.detachNodeOptions).toEqual([]);
    expect(result.current.detachDialog.selectedDetachColumns).toEqual({});
  });

  it('opens the dispersion dialog with hidden generated columns removed and forwards filters', async () => {
    const { result } = renderHook(() => useConcordanceDetachDialogs(defaultArgs));

    await act(async () => {
      await result.current.openDispersionDetachDialog(
        [{ nodeId: 'node-1', column: 'text', nodeLabel: 'Node 1' }],
        new Set([2, 1]),
        10,
        { selectedMatchedTexts: ['alpha'], matchCaseInsensitive: true },
      );
    });

    expect(result.current.dispersionDetachDialog.open).toBe(true);
    expect(result.current.dispersionDetachDialog.detachNodeOptions).toEqual([
      {
        node_id: 'node-1',
        node_name: 'Node 1',
        available_columns: ['text', 'CONC_left_context', 'speaker'],
        disabled_columns: [],
        text_column: 'text',
      },
    ]);
    expect(result.current.dispersionDetachDialog.selectedDetachColumns).toEqual({
      'node-1': [],
    });

    act(() => {
      result.current.dispersionDetachDialog.toggleDetachColumn('node-1', 'speaker', true);
    });

    await act(async () => {
      await result.current.dispersionDetachDialog.handleDetachConfirm();
    });

    expect(handleDispersionDetach).toHaveBeenCalledWith('node-1', 'text', {
      nodeLabel: 'Node 1',
      materializedPath: '/tmp/node-1.parquet',
      selectedBins: expect.any(Set),
      binCount: 10,
      selectedColumns: ['speaker'],
      selectedMatchedTexts: ['alpha'],
      matchCaseInsensitive: true,
    });
    const dispersionDetachCall = handleDispersionDetach.mock.calls[0];
    expect(dispersionDetachCall).toBeDefined();
    const selectedBins = dispersionDetachCall?.[2].selectedBins ?? null;
    expect(Array.from(selectedBins ?? [])).toEqual([2, 1]);
    expect(result.current.dispersionDetachDialog.open).toBe(false);
    expect(result.current.dispersionDetachDialog.selectedDetachColumns).toEqual({});
  });
});
