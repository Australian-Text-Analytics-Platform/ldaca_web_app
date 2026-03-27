import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handleSearchMock = vi.fn();
const clearResultsMock = vi.fn(async () => {});
let mockPendingConcordance: Record<string, unknown> | null = null;
let mockHydrationState = { status: 'idle' as const, lastHydratedAt: 1 };
let mockInitialResult: Record<string, unknown> | null = null;
let mockSetSafeResult: React.Dispatch<React.SetStateAction<Record<string, unknown> | null>> | null = null;

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

vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: ({
    open,
    title,
    description,
    confirmText = 'Continue',
    cancelText = 'Cancel',
    onConfirm,
    onOpenChange,
  }: {
    open: boolean;
    title: string;
    description: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div>
        <div>{title}</div>
        <div>{description}</div>
        <button type="button" onClick={() => onOpenChange(false)}>{cancelText}</button>
        <button
          type="button"
          onClick={() => {
            onConfirm();
            onOpenChange(false);
          }}
        >
          {confirmText}
        </button>
      </div>
    ) : null,
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
      pendingConcordance: mockPendingConcordance,
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
    dispersion: 'CONC_dispersion',
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
      hydrationState: mockHydrationState,
      clearResults: clearResultsMock,
    }),
    useNodeColorManagement: () => ({
      nodeColors: {},
      handleColorChange: vi.fn(),
      defaultPalette: ['#000000'],
    }),
    useSafeResult: () => {
      const [result, setResult] = ReactModule.useState<Record<string, unknown> | null>(mockInitialResult);
      const ref = ReactModule.useRef<Record<string, unknown> | null>(result);
      ReactModule.useEffect(() => {
        ref.current = result;
        mockSetSafeResult = setResult;
      }, [result, setResult]);
      return [result, ref, vi.fn(), setResult];
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
    mockPendingConcordance = null;
    mockHydrationState = { status: 'idle', lastHydratedAt: 1 };
    mockInitialResult = null;
    mockSetSafeResult = null;
    clearResultsMock.mockImplementation(async () => {
      mockSetSafeResult?.(null);
    });
  });

  it('clears previous results before rerunning when clicking Update', () => {
    const { unmount } = render(<ConcordanceFeature />);

    fireEvent.change(screen.getAllByPlaceholderText('Enter word or phrase to search for')[0], {
      target: { value: 'new value' },
    });

    fireEvent.click(screen.getAllByRole('button', { name: /update/i })[0]);

    return waitFor(() => {
      expect(clearResultsMock).toHaveBeenCalledTimes(1);
      expect(handleSearchMock).toHaveBeenCalledTimes(1);
    }).finally(unmount);
  });

  it('passes the locked-update flag when clicking Update', () => {
    const { unmount } = render(<ConcordanceFeature />);

    fireEvent.change(screen.getAllByPlaceholderText('Enter word or phrase to search for')[0], {
      target: { value: 'new value' },
    });

    fireEvent.click(screen.getAllByRole('button', { name: /update/i })[0]);

    return waitFor(() => {
      expect(handleSearchMock).toHaveBeenCalledWith(true, undefined, undefined, undefined, undefined, true);
    }).finally(unmount);
  });

  it('fills the concordance search box from a pending token handoff when no results exist', async () => {
    mockPendingConcordance = {
      searchWord: 'keyword',
      selectedNodes: [{ id: 'node-1', name: 'Node 1' }],
      nodeColumnSelections: [{ nodeId: 'node-1', column: 'text' }],
      autoRun: false,
      timestamp: 1,
    };

    const { unmount } = render(<ConcordanceFeature />);

    await waitFor(() => {
      expect(screen.getAllByPlaceholderText('Enter word or phrase to search for')[0]).toHaveValue('keyword');
    });

    unmount();
  });

  it('asks for confirmation before replacing existing concordance results from a token handoff', async () => {
    mockPendingConcordance = {
      searchWord: 'replacement',
      selectedNodes: [{ id: 'node-1', name: 'Node 1' }],
      nodeColumnSelections: [{ nodeId: 'node-1', column: 'text' }],
      autoRun: false,
      timestamp: 2,
    };
    mockInitialResult = {
      state: 'successful',
      data: {
        'node-1': {
          data: [],
          columns: [],
          pagination: {
            has_prev: false,
            has_next: false,
          },
        },
      },
    };

    const { unmount } = render(<ConcordanceFeature />);

    await waitFor(() => {
      expect(screen.getByText('Replace concordance results?')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Clear and fill token' }));

    await waitFor(() => {
      expect(clearResultsMock).toHaveBeenCalledWith({ preserveLocalState: true });
    });

    await waitFor(() => {
      expect(screen.getAllByPlaceholderText('Enter word or phrase to search for')[0]).toHaveValue('replacement');
    });

    unmount();
  });

  it('replaces concordance columns with a dispersion column when Dispersion View is enabled', async () => {
    mockInitialResult = {
      state: 'successful',
      message: 'ok',
      data: {
        'node-1': {
          data: [
            [
              {
                text: 'alpha beta alpha',
                speaker: 'A',
                CONC_LEFT_CONTEXT: '',
                CONC_MATCHED_TEXT: 'alpha',
                CONC_RIGHT_CONTEXT: 'beta alpha',
                CONC_START_IDX: 0,
                CONC_END_IDX: 5,
              },
            ],
          ],
          columns: ['text', 'speaker', 'CONC_LEFT_CONTEXT', 'CONC_MATCHED_TEXT', 'CONC_RIGHT_CONTEXT'],
          metadata: {
            metadata_columns: ['text', 'speaker'],
            concordance_columns: ['CONC_LEFT_CONTEXT', 'CONC_MATCHED_TEXT', 'CONC_RIGHT_CONTEXT'],
            all_columns: ['text', 'speaker', 'CONC_LEFT_CONTEXT', 'CONC_MATCHED_TEXT', 'CONC_RIGHT_CONTEXT'],
          },
          pagination: {
            page: 1,
            page_size: 20,
            has_prev: false,
            has_next: false,
          },
          sorting: { descending: false },
        },
      },
    };

    const { unmount } = render(<ConcordanceFeature />);

    fireEvent.click(screen.getByRole('checkbox', { name: /dispersion view/i }));

    await waitFor(() => {
      expect(screen.getByText('CONC_dispersion')).toBeInTheDocument();
    });

    expect(screen.getByRole('checkbox', { name: /bar length proportional to text length/i })).toBeInTheDocument();

    expect(screen.queryByText('CONC_LEFT_CONTEXT')).not.toBeInTheDocument();
    expect(screen.queryByText('CONC_MATCHED_TEXT')).not.toBeInTheDocument();
    expect(screen.queryByText('CONC_RIGHT_CONTEXT')).not.toBeInTheDocument();

    unmount();
  });

  it('keeps the dispersion column at half the table width when metadata is shown', async () => {
    const clientWidthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    mockInitialResult = {
      state: 'successful',
      message: 'ok',
      data: {
        'node-1': {
          data: [
            [
              {
                document: 'Doc 1',
                speaker: 'A',
                CONC_LEFT_CONTEXT: '',
                CONC_MATCHED_TEXT: 'alpha',
                CONC_RIGHT_CONTEXT: 'beta alpha',
                CONC_START_IDX: 0,
                CONC_END_IDX: 5,
              },
            ],
          ],
          columns: ['document', 'speaker', 'CONC_LEFT_CONTEXT', 'CONC_MATCHED_TEXT', 'CONC_RIGHT_CONTEXT'],
          metadata: {
            metadata_columns: ['document', 'speaker'],
            concordance_columns: ['CONC_LEFT_CONTEXT', 'CONC_MATCHED_TEXT', 'CONC_RIGHT_CONTEXT'],
            all_columns: ['document', 'speaker', 'CONC_LEFT_CONTEXT', 'CONC_MATCHED_TEXT', 'CONC_RIGHT_CONTEXT'],
          },
          pagination: {
            page: 1,
            page_size: 20,
            has_prev: false,
            has_next: false,
          },
          sorting: { descending: false },
        },
      },
    };

    const { unmount } = render(<ConcordanceFeature />);

    fireEvent.click(screen.getByRole('checkbox', { name: /dispersion view/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /show metadata/i }));

    await waitFor(() => {
      expect(screen.getByText('CONC_dispersion')).toBeInTheDocument();
    });

    expect(screen.getByText('document')).toBeInTheDocument();
    expect(screen.queryByText('speaker')).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'CONC_dispersion' })).toHaveStyle({ width: '400px' });

    fireEvent.pointerDown(screen.getByRole('button', { name: /metadata columns/i }), { button: 0 });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /speaker/i }));
    fireEvent.keyDown(screen.getByRole('menu', { name: /metadata columns/i }), { key: 'Escape' });

    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: /speaker/i })).toBeInTheDocument();
    });

    unmount();
    clientWidthSpy.mockRestore();
  });

  it('prefers the selected text column over the first metadata column by default', async () => {
    mockInitialResult = {
      state: 'successful',
      message: 'ok',
      data: {
        'node-1': {
          data: [
            [
              {
                speaker: 'A',
                text: 'alpha beta alpha',
                CONC_LEFT_CONTEXT: '',
                CONC_MATCHED_TEXT: 'alpha',
                CONC_RIGHT_CONTEXT: 'beta alpha',
                CONC_START_IDX: 0,
                CONC_END_IDX: 5,
              },
            ],
          ],
          columns: ['speaker', 'text', 'CONC_LEFT_CONTEXT', 'CONC_MATCHED_TEXT', 'CONC_RIGHT_CONTEXT'],
          metadata: {
            metadata_columns: ['speaker', 'text'],
            concordance_columns: ['CONC_LEFT_CONTEXT', 'CONC_MATCHED_TEXT', 'CONC_RIGHT_CONTEXT'],
            all_columns: ['speaker', 'text', 'CONC_LEFT_CONTEXT', 'CONC_MATCHED_TEXT', 'CONC_RIGHT_CONTEXT'],
          },
          pagination: {
            page: 1,
            page_size: 20,
            has_prev: false,
            has_next: false,
          },
          sorting: { descending: false },
        },
      },
    };

    render(<ConcordanceFeature />);

    fireEvent.click(screen.getByRole('checkbox', { name: /show metadata/i }));

    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: /text/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole('columnheader', { name: /speaker/i })).not.toBeInTheDocument();
  });

  it('shows the current page concordance occurrence count in the pagination label', async () => {
    mockInitialResult = {
      state: 'successful',
      message: 'ok',
      data: {
        'node-1': {
          data: [
            [
              {
                text: 'alpha beta alpha',
                CONC_LEFT_CONTEXT: '',
                CONC_MATCHED_TEXT: 'alpha',
                CONC_RIGHT_CONTEXT: 'beta alpha',
                CONC_START_IDX: 0,
                CONC_END_IDX: 5,
              },
              {
                text: 'alpha beta alpha',
                CONC_LEFT_CONTEXT: 'alpha beta',
                CONC_MATCHED_TEXT: 'alpha',
                CONC_RIGHT_CONTEXT: '',
                CONC_START_IDX: 11,
                CONC_END_IDX: 16,
              },
            ],
          ],
          columns: ['text', 'CONC_LEFT_CONTEXT', 'CONC_MATCHED_TEXT', 'CONC_RIGHT_CONTEXT'],
          metadata: {
            metadata_columns: ['text'],
            concordance_columns: ['CONC_LEFT_CONTEXT', 'CONC_MATCHED_TEXT', 'CONC_RIGHT_CONTEXT'],
            all_columns: ['text', 'CONC_LEFT_CONTEXT', 'CONC_MATCHED_TEXT', 'CONC_RIGHT_CONTEXT'],
          },
          total_matches: 0,
          pagination: {
            page: 1,
            page_size: 20,
            has_prev: false,
            has_next: false,
          },
          sorting: { descending: false },
        },
      },
    };

    render(<ConcordanceFeature />);

    expect(screen.getByText('Documents searched per page (2 matches found)')).toBeInTheDocument();
  });

  it('hides the proportional-width control until Dispersion View is enabled', () => {
    mockInitialResult = {
      state: 'successful',
      message: 'ok',
      data: {
        'node-1': {
          data: [],
          columns: [],
          pagination: {
            page: 1,
            page_size: 20,
            has_prev: false,
            has_next: false,
          },
        },
      },
    };

    const { unmount } = render(<ConcordanceFeature />);

    expect(screen.queryByRole('checkbox', { name: /bar length proportional to text length/i })).not.toBeInTheDocument();

    unmount();
  });
});
