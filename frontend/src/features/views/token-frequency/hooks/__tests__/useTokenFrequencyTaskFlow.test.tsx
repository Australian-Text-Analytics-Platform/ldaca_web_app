import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ViewType } from '@/features/views/viewIds';
import { useTokenFrequencyTaskFlow } from '../useTokenFrequencyTaskFlow';

const {
  createConcordanceTabMock,
  deleteTabMock,
  setConcordanceTabTaskMock,
  submitTabAnalysisMock,
} = vi.hoisted(() => ({
  createConcordanceTabMock: vi.fn(),
  deleteTabMock: vi.fn(),
  setConcordanceTabTaskMock: vi.fn(),
  submitTabAnalysisMock: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  deleteTab: deleteTabMock,
  submitTabAnalysis: submitTabAnalysisMock,
}));

vi.mock('@/features/views/common/tabs/useWorkspaceTabs', () => ({
  useWorkspaceTabs: () => ({
    createTab: createConcordanceTabMock,
    setTabTask: setConcordanceTabTaskMock,
  }),
}));

describe('useTokenFrequencyTaskFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createConcordanceTabMock.mockResolvedValue({ id: 'concordance-tab' });
    deleteTabMock.mockResolvedValue({ data: undefined });
    submitTabAnalysisMock.mockResolvedValue({
      data: {
        id: 'analysis-1',
        kind: 'token_frequency',
        state: 'queued',
        request: {},
      },
    });
  });

  it('assigns the returned Analysis id without submitting the frontend Tab id in the body', async () => {
    const setLocalTaskId = vi.fn();
    const setIsRunning = vi.fn();
    const onTaskIdAssigned = vi.fn();

    const { result } = renderHook(() =>
      useTokenFrequencyTaskFlow({
        state: {
          currentWorkspaceId: 'workspace-1',
          tabId: 'tab-1',
          panelNodeIds: ['node-1'],
          panelSelectedNodes: [{ id: 'node-1', name: 'Corpus' }],
          effectiveNodeColumnSelections: [{ nodeId: 'node-1', column: 'text' }],
          tokenizerModelsByNode: { 'node-1': 'native:plain_words_en' },
          stopWords: 'and, the',
          lastCompareNodeIds: [],
        },
        actions: {
          setLocalTaskId,
          setIsRunning,
          runningRef: { current: false },
          setLastCompareNodeIds: vi.fn(),
          setAppliedStopSet: vi.fn(),
          setStopWords: vi.fn(),
          lastFetchedRef: { current: { taskId: null, state: null } },
          onTaskIdAssigned,
        },
        navigation: {
          setCurrentView: vi.fn(),
          applyStopSetFromText: vi.fn(),
        },
      }),
    );

    await act(async () => {
      await result.current.handleAnalyze();
    });

    expect(submitTabAnalysisMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { workspace_id: 'workspace-1', tab_id: 'tab-1' },
        body: expect.objectContaining({
          kind: 'token_frequency',
          node_ids: ['node-1'],
          node_columns: { 'node-1': 'text' },
          node_tokenizer_models: { 'node-1': 'native:plain_words_en' },
          stop_words: ['and', 'the'],
        }),
      }),
    );
    expect(submitTabAnalysisMock.mock.calls[0]?.[0]?.body).not.toHaveProperty('tab_id');
    expect(setLocalTaskId).toHaveBeenCalledWith('analysis-1');
    expect(onTaskIdAssigned).toHaveBeenCalledWith('analysis-1');
  });

  const renderTwoNodeFlow = (setCurrentView: (view: ViewType) => void = vi.fn()) =>
    renderHook(() =>
      useTokenFrequencyTaskFlow({
        state: {
          currentWorkspaceId: 'workspace-1',
          tabId: 'frequency-tab',
          panelNodeIds: ['node-1', 'node-2'],
          panelSelectedNodes: [
            { id: 'node-1', name: 'Corpus A' },
            { id: 'node-2', name: 'Corpus B' },
          ],
          effectiveNodeColumnSelections: [
            { nodeId: 'node-1', column: 'text' },
            { nodeId: 'node-2', column: 'text' },
          ],
          tokenizerModelsByNode: {
            'node-1': 'native:plain_words_en',
            'node-2': 'native:plain_words_en',
          },
          stopWords: '',
          lastCompareNodeIds: ['node-1', 'node-2'],
        },
        actions: {
          setLocalTaskId: vi.fn(),
          setIsRunning: vi.fn(),
          runningRef: { current: false },
          setLastCompareNodeIds: vi.fn(),
          setAppliedStopSet: vi.fn(),
          setStopWords: vi.fn(),
          lastFetchedRef: { current: { taskId: null, state: null } },
          onTaskIdAssigned: vi.fn(),
        },
        navigation: {
          setCurrentView,
          applyStopSetFromText: vi.fn(),
        },
      }),
    );

  it('creates and submits a durable Concordance Analysis scoped to the clicked Data Block', async () => {
    const setCurrentView = vi.fn<(view: ViewType) => void>();
    const { result } = renderTwoNodeFlow(setCurrentView);

    act(() => {
      result.current.handleTokenClick('hello', 'node-2');
    });

    await waitFor(() => {
      expect(submitTabAnalysisMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          kind: 'concordance',
          node_ids: ['node-2'],
          node_columns: { 'node-2': 'text' },
          search_word: 'hello',
        }),
        path: { workspace_id: 'workspace-1', tab_id: 'concordance-tab' },
        throwOnError: true,
      });
    });
    expect(setConcordanceTabTaskMock).toHaveBeenCalledWith('concordance-tab', 'analysis-1');
    expect(setCurrentView).toHaveBeenCalledWith('concordance');
  });

  it('keeps both compared Data Blocks when the comparative result supplies no source id', async () => {
    const { result } = renderTwoNodeFlow();

    act(() => {
      result.current.handleTokenClick('hello');
    });

    await waitFor(() => {
      expect(submitTabAnalysisMock).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            kind: 'concordance',
            node_ids: ['node-1', 'node-2'],
            node_columns: { 'node-1': 'text', 'node-2': 'text' },
          }),
        }),
      );
    });
  });

  it('does not submit or navigate until the destination Tab exists', async () => {
    let resolveCreatedTab: ((value: { id: string }) => void) | undefined;
    createConcordanceTabMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreatedTab = resolve;
        }),
    );
    const setCurrentView = vi.fn<(view: ViewType) => void>();
    const { result } = renderTwoNodeFlow(setCurrentView);

    act(() => {
      result.current.handleTokenClick('hello');
    });

    expect(submitTabAnalysisMock).not.toHaveBeenCalled();
    expect(setCurrentView).not.toHaveBeenCalled();

    resolveCreatedTab?.({ id: 'delayed-tab' });

    await waitFor(() => {
      expect(submitTabAnalysisMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { workspace_id: 'workspace-1', tab_id: 'delayed-tab' },
        }),
      );
      expect(setCurrentView).toHaveBeenCalledWith('concordance');
    });
  });

  it('deletes a newly created empty Tab and stays in Token Frequency when submission fails', async () => {
    submitTabAnalysisMock.mockRejectedValueOnce(new Error('submission failed'));
    const setCurrentView = vi.fn<(view: ViewType) => void>();
    const { result } = renderTwoNodeFlow(setCurrentView);

    act(() => {
      result.current.handleTokenClick('hello');
    });

    await waitFor(() => {
      expect(deleteTabMock).toHaveBeenCalledWith({
        path: { workspace_id: 'workspace-1', tab_id: 'concordance-tab' },
        throwOnError: true,
      });
    });
    expect(setConcordanceTabTaskMock).toHaveBeenCalledWith('concordance-tab', null);
    expect(setCurrentView).not.toHaveBeenCalled();
  });
});
