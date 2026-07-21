import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PendingConcordance } from '@/stores/analysisStore';
import { useConcordancePendingHandoff } from '../useConcordancePendingHandoff';

const pendingHandoff: PendingConcordance = {
  targetTabId: 'target-tab',
  searchWord: 'keyword',
  selectedNodes: [{ id: 'node-1', name: 'Node 1' }],
  nodeColumnSelections: [{ nodeId: 'node-1', column: 'text' }],
  autoRun: true,
  timestamp: 1,
};

describe('useConcordancePendingHandoff', () => {
  it('ignores a handoff targeted at a different tab', () => {
    const clearPendingConcordance = vi.fn();
    const setSearchWord = vi.fn();
    const setNodeColumnSelections = vi.fn();

    renderHook(() =>
      useConcordancePendingHandoff({
        tabId: 'other-tab',
        pendingConcordance: pendingHandoff,
        clearPendingConcordance,
        hydrationState: { status: 'idle', lastHydratedAt: 1 },
        selectedNodes: [],
        setSearchWord,
        setNodeColumnSelections,
        replaceSelectedNodes: vi.fn(),
      }),
    );

    expect(clearPendingConcordance).not.toHaveBeenCalled();
    expect(setSearchWord).not.toHaveBeenCalled();
    expect(setNodeColumnSelections).not.toHaveBeenCalled();
  });

  it('consumes the targeted handoff once across callback and selection rerenders', async () => {
    const clearPendingConcordance = vi.fn();
    const setSearchWord = vi.fn();
    const setNodeColumnSelections = vi.fn();
    const replaceSelectedNodes = vi.fn();

    const { result, rerender } = renderHook(
      ({ renderNumber }) =>
        useConcordancePendingHandoff({
          tabId: 'target-tab',
          pendingConcordance: pendingHandoff,
          clearPendingConcordance,
          hydrationState: { status: 'idle', lastHydratedAt: 1 },
          selectedNodes:
            renderNumber > 1 ? [{ id: 'node-1', name: 'Node 1' }] : [],
          setSearchWord: (value) => {
            setSearchWord(value);
          },
          setNodeColumnSelections: (selections, options) => {
            setNodeColumnSelections(selections, options);
          },
          replaceSelectedNodes: (ids, activeId) => {
            replaceSelectedNodes(ids, activeId);
          },
        }),
      { initialProps: { renderNumber: 1 } },
    );

    await waitFor(() => {
      expect(clearPendingConcordance).toHaveBeenCalledOnce();
      expect(setSearchWord).toHaveBeenCalledWith('keyword');
      expect(setNodeColumnSelections).toHaveBeenCalledOnce();
      expect(result.current.autoSearchRequest).toEqual({
        searchWord: 'keyword',
        nodeIds: ['node-1'],
        nodeColumnSelections: [{ nodeId: 'node-1', column: 'text' }],
      });
    });

    rerender({ renderNumber: 2 });
    rerender({ renderNumber: 3 });

    expect(clearPendingConcordance).toHaveBeenCalledOnce();
    expect(setSearchWord).toHaveBeenCalledOnce();
    expect(setNodeColumnSelections).toHaveBeenCalledOnce();
    expect(replaceSelectedNodes).toHaveBeenCalledOnce();
  });
});
