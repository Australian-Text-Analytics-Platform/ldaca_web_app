import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTokenFrequencyTaskFlow } from '../useTokenFrequencyTaskFlow';
import type { PendingConcordance } from '@/stores/analysisStore';
import type { ViewType } from '@/features/views/viewIds';

const { submitTabAnalysisMock, createConcordanceTabMock } = vi.hoisted(() => ({
  submitTabAnalysisMock: vi.fn(),
  createConcordanceTabMock: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  submitTabAnalysis: submitTabAnalysisMock,
}));

vi.mock('@/features/views/common/tabs/useWorkspaceTabs', () => ({
  useWorkspaceTabs: () => ({ createTab: createConcordanceTabMock }),
}));

describe('useTokenFrequencyTaskFlow', () => {
  beforeEach(() => {
    submitTabAnalysisMock.mockReset();
    createConcordanceTabMock.mockReset();
    createConcordanceTabMock.mockResolvedValue({ id: 'concordance-tab' });
    submitTabAnalysisMock.mockResolvedValue({
      data: {
        id: 'analysis-1',
        kind: 'token_frequency',
        state: 'queued',
        request: {},
      },
    });
  });

  it('assigns the returned task id without submitting the frontend tab id', async () => {
    const setLocalTaskId = vi.fn();
    const setIsRunning = vi.fn();
    const setResultsSafely = vi.fn();
    const setLastCompareNodeIds = vi.fn();
    const setAppliedStopSet = vi.fn();
    const setStopWords = vi.fn();
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
          results: null,
          lastCompareNodeIds: [],
          lockedNodeNameMap: {},
          nodeIdToName: { 'node-1': 'Corpus' },
        },
        actions: {
          setLocalTaskId,
          setIsRunning,
          runningRef: { current: false },
          setResultsSafely,
          setLastCompareNodeIds,
          setAppliedStopSet,
          setStopWords,
          lastFetchedRef: { current: { taskId: null, state: null } },
          onTaskIdAssigned,
        },
        navigation: {
          replaceSelectedNodes: vi.fn(),
          setPendingConcordance: vi.fn(),
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

  // Two-node comparison fixture shared by the token-click handoff tests below.
  interface TwoNodeNavigation {
    replaceSelectedNodes: (nodeIds: string[], activeNodeId?: string | null) => void;
    setPendingConcordance: (payload: PendingConcordance) => void;
    setCurrentView: (view: ViewType) => void;
  }

  const renderTwoNodeFlow = (navigation: TwoNodeNavigation) =>
    renderHook(() =>
      useTokenFrequencyTaskFlow({
        state: {
          currentWorkspaceId: 'workspace-1',
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
          results: null,
          lastCompareNodeIds: ['node-1', 'node-2'],
          lockedNodeNameMap: {},
          nodeIdToName: { 'node-1': 'Corpus A', 'node-2': 'Corpus B' },
        },
        actions: {
          setLocalTaskId: vi.fn(),
          setIsRunning: vi.fn(),
          runningRef: { current: false },
          setResultsSafely: vi.fn(),
          setLastCompareNodeIds: vi.fn(),
          setAppliedStopSet: vi.fn(),
          setStopWords: vi.fn(),
          lastFetchedRef: { current: { taskId: null, state: null } },
          onTaskIdAssigned: vi.fn(),
        },
        navigation: {
          ...navigation,
          applyStopSetFromText: vi.fn(),
        },
      }),
    );

  it('scopes the concordance handoff to the clicked node when a source id is given', async () => {
    const replaceSelectedNodes = vi.fn<(nodeIds: string[], activeNodeId?: string | null) => void>();
    const setPendingConcordance = vi.fn<(payload: PendingConcordance) => void>();
    const setCurrentView = vi.fn<(view: ViewType) => void>();

    const { result } = renderTwoNodeFlow({
      replaceSelectedNodes,
      setPendingConcordance,
      setCurrentView,
    });

    act(() => {
      result.current.handleTokenClick('hello', 'node-2');
    });

    expect(createConcordanceTabMock).toHaveBeenCalledWith('hello');
    await waitFor(() => {
      expect(replaceSelectedNodes).toHaveBeenCalledWith(['node-2'], 'node-2');
      expect(setPendingConcordance).toHaveBeenCalledWith(
        expect.objectContaining({
          targetTabId: 'concordance-tab',
          searchWord: 'hello',
          selectedNodes: [{ id: 'node-2', name: 'Corpus B' }],
          nodeColumnSelections: [{ nodeId: 'node-2', column: 'text' }],
          autoRun: true,
        }),
      );
      expect(setCurrentView).toHaveBeenCalledWith('concordance');
    });
  });

  it('keeps both compared nodes when no source id is given', async () => {
    const replaceSelectedNodes = vi.fn<(nodeIds: string[], activeNodeId?: string | null) => void>();
    const setPendingConcordance = vi.fn<(payload: PendingConcordance) => void>();
    const setCurrentView = vi.fn<(view: ViewType) => void>();

    const { result } = renderTwoNodeFlow({
      replaceSelectedNodes,
      setPendingConcordance,
      setCurrentView,
    });

    act(() => {
      result.current.handleTokenClick('hello');
    });

    await waitFor(() => {
      expect(replaceSelectedNodes).toHaveBeenCalledWith(['node-1', 'node-2'], 'node-2');
      expect(setPendingConcordance).toHaveBeenCalledWith(
        expect.objectContaining({
          targetTabId: 'concordance-tab',
          searchWord: 'hello',
          selectedNodes: [
            { id: 'node-1', name: 'Corpus A' },
            { id: 'node-2', name: 'Corpus B' },
          ],
          nodeColumnSelections: [
            { nodeId: 'node-1', column: 'text' },
            { nodeId: 'node-2', column: 'text' },
          ],
          autoRun: true,
        }),
      );
    });
  });

  it('does not navigate until the destination tab has been created', async () => {
    let resolveCreatedTab: ((value: { id: string }) => void) | undefined;
    createConcordanceTabMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreatedTab = resolve;
        }),
    );
    const setPendingConcordance = vi.fn<(payload: PendingConcordance) => void>();
    const setCurrentView = vi.fn<(view: ViewType) => void>();
    const { result } = renderTwoNodeFlow({
      replaceSelectedNodes: vi.fn(),
      setPendingConcordance,
      setCurrentView,
    });

    act(() => {
      result.current.handleTokenClick('hello');
    });

    expect(setPendingConcordance).not.toHaveBeenCalled();
    expect(setCurrentView).not.toHaveBeenCalled();

    resolveCreatedTab?.({ id: 'delayed-tab' });

    await waitFor(() => {
      expect(setPendingConcordance).toHaveBeenCalledWith(
        expect.objectContaining({ targetTabId: 'delayed-tab' }),
      );
      expect(setCurrentView).toHaveBeenCalledWith('concordance');
    });
  });
});
