import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useHintConditions } from '../conditions';

const mockWorkspaceData = vi.hoisted(() => ({
  currentWorkspaceId: 'workspace-1',
  workspaceGraph: {
    nodes: [{ id: 'node-1', data: { name: 'Corpus' } }],
  },
}));

const mockSelection = vi.hoisted(() => ({
  selectedNodeId: null as string | null,
}));

const mockUIState = vi.hoisted(() => ({
  currentView: 'filter',
  lastUploadedFilePath: null as string | null,
  modals: {
    feedbackModal: false,
    tutorialModal: false,
    warningModal: false,
    infoModal: false,
    referenceModal: false,
  },
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => mockWorkspaceData,
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceSelection', () => ({
  useWorkspaceSelection: () => mockSelection,
}));

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (state: typeof mockUIState) => unknown) => selector(mockUIState),
}));

describe('useHintConditions', () => {
  beforeEach(() => {
    mockWorkspaceData.currentWorkspaceId = 'workspace-1';
    mockWorkspaceData.workspaceGraph = {
      nodes: [{ id: 'node-1', data: { name: 'Corpus' } }],
    };
    mockSelection.selectedNodeId = null;
    mockUIState.currentView = 'filter';
    mockUIState.lastUploadedFilePath = null;
    mockUIState.modals = {
      feedbackModal: false,
      tutorialModal: false,
      warningModal: false,
      infoModal: false,
      referenceModal: false,
    };
  });

  it('activates the filter node-selection hint when the filter view has workspace nodes but no selected node', () => {
    const { result } = renderHook(() => useHintConditions());

    expect(result.current.conditions['filter-no-node-selected']).toBe(true);
    expect(result.current.conditions['filter-awaiting-column-selection']).toBe(false);
  });

  it('activates the filter column-selection hint when a node is selected in the filter view', () => {
    mockSelection.selectedNodeId = 'node-1';

    const { result } = renderHook(() => useHintConditions());

    expect(result.current.conditions['filter-no-node-selected']).toBe(false);
    expect(result.current.conditions['filter-awaiting-column-selection']).toBe(true);
  });

  it('suppresses filter hints when any modal is open', () => {
    mockSelection.selectedNodeId = 'node-1';
    mockUIState.modals.infoModal = true;

    const { result } = renderHook(() => useHintConditions());

    expect(result.current.conditions['filter-no-node-selected']).toBe(false);
    expect(result.current.conditions['filter-awaiting-column-selection']).toBe(false);
  });
});