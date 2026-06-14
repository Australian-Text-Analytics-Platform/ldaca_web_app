import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTokenFrequencyTaskFlow } from '../useTokenFrequencyTaskFlow';

const { calculateTokenFrequenciesMock } = vi.hoisted(() => ({
  calculateTokenFrequenciesMock: vi.fn(),
}));

vi.mock('@/api/generated/sdk.gen', () => ({
  calculateTokenFrequencies: calculateTokenFrequenciesMock,
}));

vi.mock('@/features/views/common/tabs/useWorkspaceTabs', () => ({
  useWorkspaceTabs: () => ({ createTab: vi.fn() }),
}));

describe('useTokenFrequencyTaskFlow', () => {
  beforeEach(() => {
    calculateTokenFrequenciesMock.mockReset();
    calculateTokenFrequenciesMock.mockResolvedValue({
      data: { state: 'running', metadata: { task_id: 'task-1' } },
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
        lock: { getAuthHeaders: () => ({ Authorization: 'Bearer test' }) },
        navigation: {
          selectNodes: vi.fn(),
          setPendingConcordance: vi.fn(),
          setCurrentView: vi.fn(),
          applyStopSetFromText: vi.fn(),
        },
      }),
    );

    await act(async () => {
      await result.current.handleAnalyze();
    });

    expect(calculateTokenFrequenciesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          node_ids: ['node-1'],
          node_columns: { 'node-1': 'text' },
          stop_words: ['and', 'the'],
        }),
      }),
    );
    expect(calculateTokenFrequenciesMock.mock.calls[0]?.[0]?.body).not.toHaveProperty('tab_id');
    expect(setLocalTaskId).toHaveBeenCalledWith('task-1');
    expect(onTaskIdAssigned).toHaveBeenCalledWith('task-1');
  });

  // Two-node comparison fixture shared by the token-click handoff tests below.
  const renderTwoNodeFlow = (
    navigation: {
      selectNodes: ReturnType<typeof vi.fn>;
      setPendingConcordance: ReturnType<typeof vi.fn>;
      setCurrentView: ReturnType<typeof vi.fn>;
    },
  ) =>
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
        lock: { getAuthHeaders: () => ({ Authorization: 'Bearer test' }) },
        navigation: {
          ...navigation,
          applyStopSetFromText: vi.fn(),
        },
      }),
    );

  it('scopes the concordance handoff to the clicked node when a source id is given', () => {
    const selectNodes = vi.fn();
    const setPendingConcordance = vi.fn();
    const setCurrentView = vi.fn();

    const { result } = renderTwoNodeFlow({ selectNodes, setPendingConcordance, setCurrentView });

    act(() => {
      result.current.handleTokenClick('hello', 'node-2');
    });

    expect(selectNodes).toHaveBeenCalledWith(['node-2']);
    expect(setPendingConcordance).toHaveBeenCalledWith(
      expect.objectContaining({
        searchWord: 'hello',
        selectedNodes: [{ id: 'node-2', name: 'Corpus B' }],
        nodeColumnSelections: [{ nodeId: 'node-2', column: 'text' }],
        autoRun: true,
      }),
    );
    expect(setCurrentView).toHaveBeenCalledWith('concordance');
  });

  it('keeps both compared nodes when no source id is given', () => {
    const selectNodes = vi.fn();
    const setPendingConcordance = vi.fn();
    const setCurrentView = vi.fn();

    const { result } = renderTwoNodeFlow({ selectNodes, setPendingConcordance, setCurrentView });

    act(() => {
      result.current.handleTokenClick('hello');
    });

    expect(selectNodes).toHaveBeenCalledWith(['node-1', 'node-2']);
    expect(setPendingConcordance).toHaveBeenCalledWith(
      expect.objectContaining({
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
