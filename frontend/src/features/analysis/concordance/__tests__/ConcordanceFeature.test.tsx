import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handleSearchMock = vi.fn();
const clearResultsMock = vi.fn(async () => {});

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@/components/NodeSelectionPanel', () => ({
  default: () => <div data-testid="node-selection-panel" />,
}));

vi.mock('@/components/help/HelpIcon', () => ({
  default: () => <span data-testid="help-icon" />,
}));

vi.mock('@/components/tabs/AnalysisTaskBanner', () => ({
  default: () => null,
}));

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/hooks/useWorkspaceSelection', () => ({
  useWorkspaceSelection: () => ({
    selectedNodes: [{ id: 'node-1', name: 'Node 1' }],
  }),
}));

vi.mock('@/hooks/useWorkspaceStatus', () => ({
  useWorkspaceStatus: () => ({ isLoading: { graph: false } }),
}));

vi.mock('@/hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => ({ currentWorkspaceId: 'ws-1' }),
}));

vi.mock('@/hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: () => ({
    detachConcordance: vi.fn(),
    selectNodes: vi.fn(),
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ getAuthHeaders: () => ({}) }),
}));

vi.mock('@/hooks/useNodeColumnInfos', () => ({
  default: () => ({
    getColumnInfos: () => [{ name: 'text' }],
  }),
}));

vi.mock('@/stores/analysisStore', () => ({
  useAnalysisStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      pendingConcordance: null,
      clearPendingConcordance: vi.fn(),
      setTasks: vi.fn(),
    }),
}));

vi.mock('@/stores', () => ({
  useUIStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ currentView: 'concordance' }),
}));

vi.mock('@/api/text', () => ({
  textApi: {},
}));

vi.mock('@/hooks/analysisTaskUtils', () => ({
  pruneTasksById: vi.fn((tasks) => tasks),
}));

vi.mock('../components/ConcordanceDetachDialog', () => ({
  ConcordanceDetachDialog: () => null,
}));

vi.mock('../generatedColumns', () => ({
  CONCORDANCE_COLUMN_KEYS: {
    matchedText: 'CONC_MATCHED_TEXT',
    startIdx: 'CONC_START_IDX',
    endIdx: 'CONC_END_IDX',
    leftToken: 'L1',
    rightToken: 'R1',
  },
  CONCORDANCE_CORE_COLUMNS: ['CONC_LEFT_CONTEXT', 'CONC_MATCHED_TEXT', 'CONC_RIGHT_CONTEXT'],
}));

vi.mock('../hooks/useConcordanceTaskFlow', () => ({
  useConcordanceTaskFlow: () => ({
    handleSearch: handleSearchMock,
    updateStoredResult: vi.fn(),
    handleSort: vi.fn(),
    handlePageChange: vi.fn(),
    persistResultPreferences: vi.fn(),
    handleDetach: vi.fn(),
  }),
}));

vi.mock('../../common', async () => {
  const ReactModule = await import('react');
  return {
    ANALYSIS_LOCKED_MESSAGE: 'Locked',
    hasLockedParameterDiff: vi.fn(() => true),
    resetAnalysisSelectionAfterClear: vi.fn(),
    restoreAnalysisLockFromRequest: vi.fn(),
    getNodeIdentifier: (node: { id?: string }, index: number) => node.id ?? `node-${index}`,
    useAnalysisLock: () => ({
      isLocked: true,
      lockWithSnapshots: vi.fn(),
      unlockSelection: vi.fn(),
      nodeColumnSelections: [{ nodeId: 'node-1', column: 'text' }],
      setNodeColumnSelection: vi.fn(),
      setNodeColumnSelections: vi.fn(),
      recomputeAutoColumns: vi.fn(),
      activeNodeColumnSelections: [{ nodeId: 'node-1', column: 'text' }],
      activeNodeIds: ['node-1'],
      panelSelectedNodes: [{ id: 'node-1', name: 'Node 1' }],
      displayNodeCount: 1,
      serverRequest: {
        search_word: 'old value',
        num_left_tokens: 10,
        num_right_tokens: 10,
        regex: false,
        case_sensitive: false,
      },
    }),
    useAnalysisFeature: () => ({
      resolveTaskId: vi.fn(async () => 'task-1'),
      setLocalTaskId: vi.fn(),
      isRunning: false,
      setIsRunning: vi.fn(),
      taskStatus: { tasks: [] },
      banner: null,
      hasActiveTask: false,
      clearResults: clearResultsMock,
    }),
    useNodeColorManagement: () => ({
      nodeColors: {},
      handleColorChange: vi.fn(),
      defaultPalette: ['#000000'],
    }),
    useSafeResult: () => {
      const ref = ReactModule.createRef();
      return [null, ref, vi.fn(), vi.fn()];
    },
    EXTENDED_PALETTE: ['#000000'],
    executeAnalysisRunOrUpdate: vi.fn(async ({
      hasLockedParameterChanges,
      clearResults,
      runFreshAnalysis,
    }: {
      hasLockedParameterChanges: boolean;
      clearResults: () => Promise<void>;
      runFreshAnalysis: () => Promise<void>;
    }) => {
      if (hasLockedParameterChanges) {
        await clearResults();
      }
      await runFreshAnalysis();
    }),
    getAnalysisActionState: vi.fn(({ allowRunWhenLocked }: { allowRunWhenLocked?: boolean }) => ({
      runDisabled: false,
      clearDisabled: false,
      runLabel: allowRunWhenLocked ? 'Update' : 'Run',
    })),
  };
});

import ConcordanceFeature from '../ConcordanceFeature';

describe('ConcordanceFeature', () => {
  beforeEach(() => {
    handleSearchMock.mockClear();
    clearResultsMock.mockClear();
  });

  it('clears previous results before rerunning when clicking Update', () => {
    render(<ConcordanceFeature />);

    fireEvent.change(screen.getAllByPlaceholderText('Enter word or phrase to search for')[0], {
      target: { value: 'new value' },
    });

    fireEvent.click(screen.getAllByRole('button', { name: /update/i })[0]);

    return waitFor(() => {
      expect(clearResultsMock).toHaveBeenCalledTimes(1);
      expect(handleSearchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('passes the locked-update flag when clicking Update', () => {
    render(<ConcordanceFeature />);

    fireEvent.change(screen.getAllByPlaceholderText('Enter word or phrase to search for')[0], {
      target: { value: 'new value' },
    });

    fireEvent.click(screen.getAllByRole('button', { name: /update/i })[0]);

    return waitFor(() => {
      expect(handleSearchMock).toHaveBeenCalledWith(true, undefined, undefined, undefined, undefined, true);
    });
  });
});
