import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useHintConditions } from '../conditions';
import { useHintsStore } from '@/stores/hintsStore';

const mockWorkspaceData = vi.hoisted(() => ({
  currentWorkspaceId: 'workspace-1',
  workspaceGraph: {
    nodes: [{ id: 'node-1', data: { name: 'Corpus' } }],
  },
}));

const mockSelection = vi.hoisted(() => ({
  activeNodeId: null as string | null,
}));

const mockUIState = vi.hoisted(() => ({
  currentView: 'filter',
  feedbackOpen: false,
  documentTarget: null as object | null,
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  /**
   * Supplies mutable workspace context for condition checks under test.
   */
  useWorkspaceData: () => mockWorkspaceData,
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceSelection', () => ({
  /**
   * Supplies mutable selection context for node-dependent hint conditions.
   */
  useWorkspaceSelection: () => mockSelection,
}));

vi.mock('@/stores/uiStore', () => ({
  /**
   * Runs selectors against the mutable UI fixture used by each condition test.
   */
  useUIStore: (selector: (state: typeof mockUIState) => unknown) => selector(mockUIState),
}));

describe('useHintConditions', () => {
  beforeEach(() => {
    mockWorkspaceData.currentWorkspaceId = 'workspace-1';
    mockWorkspaceData.workspaceGraph = {
      nodes: [{ id: 'node-1', data: { name: 'Corpus' } }],
    };
    mockSelection.activeNodeId = null;
    mockUIState.currentView = 'filter';
    mockUIState.feedbackOpen = false;
    mockUIState.documentTarget = null;
    useHintsStore.setState({ lastUploadedFilePath: null });
  });

  it('activates the filter node-selection hint when the filter view has workspace nodes but no selected node', () => {
    const { result } = renderHook(() => useHintConditions());

    expect(result.current.conditions['filter-no-node-selected']).toBe(true);
    expect(result.current.conditions['filter-awaiting-column-selection']).toBe(false);
  });

  it('activates the filter column-selection hint when a node is selected in the filter view', () => {
    mockSelection.activeNodeId = 'node-1';

    const { result } = renderHook(() => useHintConditions());

    expect(result.current.conditions['filter-no-node-selected']).toBe(false);
    expect(result.current.conditions['filter-awaiting-column-selection']).toBe(true);
  });

  it('suppresses filter hints when any modal is open', () => {
    mockSelection.activeNodeId = 'node-1';
    mockUIState.documentTarget = {
      kind: 'info',
      key: 'general.overview',
      file: 'information/general.md',
      anchor: 'info-general-overview',
    };

    const { result } = renderHook(() => useHintConditions());

    expect(result.current.conditions['filter-no-node-selected']).toBe(false);
    expect(result.current.conditions['filter-awaiting-column-selection']).toBe(false);
  });
});
