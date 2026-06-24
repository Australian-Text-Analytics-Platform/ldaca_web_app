import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Wraps concordance renders with a no-retry query client for deterministic assertions. */
/**
 * Called by: Vitest cases in this file to exercise the scoped analysis behavior because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
 * Steps: arrange fixtures and mocks, run the hook or component path under test, then assert the visible behavior or generated payload.
 */
const renderWithClient = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
};

const handleSearchMock = vi.fn();
const clearResultsMock = vi.fn(async () => {
  /* mock: resolves immediately */
});
let latestTaskFlowParams: { state?: Record<string, unknown> } | null = null;
let mockPendingConcordance: Record<string, unknown> | null = null;
let mockHydrationState = { status: 'idle' as const, lastHydratedAt: 1 };
let mockInitialResult: Record<string, unknown> | null = null;
let mockSetSafeResult: React.Dispatch<React.SetStateAction<Record<string, unknown> | null>> | null =
  null;

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../../common/nodeInputs', () => ({
  /** Provides a stable per-tab node-input fixture without the workspace provider stack. */
  useTabNodeInputs: () => ({
    nodeColumnSelections: [{ nodeId: 'node-1', column: 'text' }],
    selectedNodes: [{ id: 'node-1', name: 'Node 1' }],
    resolvedNodes: [
      {
        id: 'node-1',
        name: 'Node 1',
        node: { id: 'node-1', name: 'Node 1' },
        column: 'text',
        columnOptions: [{ name: 'text', dataType: 'string' }],
      },
    ],
    inputs: [{ node_id: 'node-1', column: 'text' }],
    addNodes: vi.fn(() => []),
    removeNode: vi.fn(),
    clear: vi.fn(),
    setColumn: vi.fn(),
    getAddRejection: vi.fn(() => null),
    availableNodes: [],
    canAddMore: true,
    graphSelectedIds: [],
    workspaceId: 'ws-1',
  }),
}));

vi.mock('@/components/help/HelpIcon', () => ({
  /** Replaces help popovers with a stable marker for component rendering tests. */
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  default: () => <span data-testid="help-icon" />,
}));

vi.mock('@/components/help/InfoIcon', () => ({
  /** Replaces informational popovers with a stable marker for component rendering tests. */
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  default: () => <span data-testid="info-icon" />,
}));

vi.mock('@/features/views/common/components/AnalysisTaskBanner', () => ({
  /** Removes lifecycle banner rendering so button and handoff assertions stay focused. */
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  default: () => null,
}));

vi.mock('@/components/ui/tabs', () => {
  // Each Tabs root publishes its own onValueChange through context so that
  // multiple independent Tabs in the same tree (e.g. the search-mode picker and
  // the Table/Dispersion view switcher) each fire the correct handler. A shared
  // module-level handler would let whichever Tabs renders last hijack every
  // trigger click.
  const TabsValueChangeContext = React.createContext<((value: string) => void) | undefined>(
    undefined,
  );
  return {
    /** Captures tab value changes while keeping Radix markup out of this unit test. */
    // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
    Tabs: ({
      children,
      onValueChange,
    }: {
      children: React.ReactNode;
      onValueChange?: (value: string) => void;
      value?: string;
    }) => (
      <TabsValueChangeContext.Provider value={onValueChange}>
        <div>{children}</div>
      </TabsValueChangeContext.Provider>
    ),
    /** Simplifies tab-list structure without changing child rendering. */
    // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
    TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    /** Converts tab triggers into plain buttons that still fire their own Tabs' value change. */
    // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
    TabsTrigger: ({ children, value }: { children: React.ReactNode; value: string }) => {
      const onValueChange = React.useContext(TabsValueChangeContext);
      return (
        <button type="button" role="tab" onClick={() => onValueChange?.(value)}>
          {children}
        </button>
      );
    },
  };
});

vi.mock('@/components/ui/dialog', () => ({
  /** Keeps dialog content mounted so confirmation text is directly queryable. */
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  /** Removes Radix portal behavior for local test rendering. */
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  /** Preserves dialog heading grouping without layout dependencies. */
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  /** Renders dialog titles as plain text for screen queries. */
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/confirm-dialog', () => ({
  /** Provides a minimal confirm dialog that exercises confirm/cancel callbacks. */
  // Steps: arrange fixtures and mocks, run the hook or component path under test, then assert the visible behavior or generated payload.
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
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
        <button
          type="button"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          {cancelText}
        </button>
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

vi.mock('@/features/workspace/common/hooks/useWorkspaceSelection', () => ({
  /** Supplies one selected text node as the default concordance test fixture. */
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  useWorkspaceSelection: () => ({
    selectedNodes: [{ id: 'node-1', name: 'Node 1' }],
  }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceStatus', () => ({
  /** Keeps workspace loading false so the feature renders immediately. */
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  useWorkspaceStatus: () => ({ isLoading: { graph: false } }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  /** Supplies a stable workspace id required by concordance actions. */
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  useWorkspaceData: () => ({ currentWorkspaceId: 'ws-1' }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceActions', () => ({
  /** Stubs workspace mutations that are outside this feature-level test boundary. */
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  useWorkspaceActions: () => ({
    detachConcordance: vi.fn(),
    materializeConcordance: vi.fn(),
    selectNodes: vi.fn(),
  }),
}));

vi.mock('@/features/auth/hooks/useAuth', () => ({
  /** Provides auth shape expected by generated API calls without real credentials. */
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  useAuth: () => ({
    /** Supplies empty headers because every network boundary is mocked. */
    // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
    getAuthHeaders: () => ({}),
  }),
}));

vi.mock('@/features/workspace/common/hooks/useNodeColumnInfos', () => ({
  /** Supplies the text column needed for auto-selection and parameter rendering. */
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  useNodeColumnInfos: () => ({
    /** Reports a single string column so concordance has a valid target. */
    // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
    getColumnInfos: () => [{ name: 'text' }],
  }),
}));

vi.mock('@/stores/analysisStore', () => ({
  /** Feeds pending handoff state and materialized events into the feature under test. */
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  useAnalysisStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      pendingConcordance: mockPendingConcordance,
      clearPendingConcordance: vi.fn(),
      setTasks: vi.fn(),
      materializedEvents: [],
    }),
}));

vi.mock('@/stores', () => ({
  /** Pins the UI store to the concordance tab so lifecycle hooks stay active. */
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  useUIStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ currentView: 'concordance' }),
}));

vi.mock('@/hooks/analysisTaskUtils', () => ({
  pruneTasksById: vi.fn((tasks) => tasks),
  /** Keeps task dedupe candidates scoped to the requested type. */
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  getTaskTypeCandidates: (taskType: string) => [taskType],
  /** Produces deterministic task dedupe keys for lifecycle assertions. */
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  normalizeTaskDedupeKey: (taskId: string | null, state: string | null) =>
    taskId && state ? `${taskId}:${state}` : null,
}));

vi.mock('../components/ConcordanceDetachDialog', () => ({
  /** Removes the detach dialog from tests that focus on run/update behavior. */
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
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
  /** Captures task-flow inputs while exposing controllable action mocks. */
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  useConcordanceTaskFlow: (params: { state?: Record<string, unknown> }) => {
    latestTaskFlowParams = params;
    return {
      handleSearch: handleSearchMock,
      updateStoredResult: vi.fn(),
      handleSort: vi.fn(),
      handlePageChange: vi.fn(),
      persistResultPreferences: vi.fn(),
      handleDetach: vi.fn(),
      handleMaterialize: vi.fn(),
    };
  },
}));

vi.mock('../../common', async () => {
  const ReactModule = await import('react');
  return {
    /** Mirrors the shared node-id helper with a deterministic fallback for fixtures. */
    getNodeIdentifier: (node: { id?: string }, index: number) => node.id ?? `node-${String(index)}`,
    /** Supplies the last-run request used only for Run/Re-run button diffing. */
    useLastRunRequest: () => ({
      serverRequest: {
        node_ids: ['node-1'],
        node_columns: { 'node-1': 'text' },
        search_word: 'old value',
        num_left_tokens: 10,
        num_right_tokens: 10,
        regex: false,
        case_sensitive: false,
      },
      hasServerRequest: true,
      taskId: null,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    }),
    /** Supplies analysis lifecycle state and mockable clear behavior for feature tests. */
    // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
    useAnalysisFeature: () => ({
      resolveTaskId: vi.fn(() => 'task-1'),
      setLocalTaskId: vi.fn(),
      isRunning: false,
      setIsRunning: vi.fn(),
      taskStatus: { tasks: [] },
      banner: null,
      hasActiveTask: false,
      hydrationState: mockHydrationState,
      clearResults: clearResultsMock,
    }),
    /** Emulates the shared safe-result hook while exposing the setter to tests. */
    // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
    useSafeResult: () => {
      const [result, setResult] = ReactModule.useState<Record<string, unknown> | null>(
        mockInitialResult,
      );
      const ref = ReactModule.useRef<Record<string, unknown> | null>(result);
      ReactModule.useEffect(() => {
        ref.current = result;
        mockSetSafeResult = setResult;
      }, [result, setResult]);
      return [result, ref, vi.fn(), setResult];
    },
    /** Supplies deterministic source colours for feature tests that mock the shared analysis module. */
    useNodeColorControls: () => ({
      defaultPalette: ['#000000'],
      nodeColors: { 'node-1': '#000000' },
      nodeColorOverrides: {},
      ensureNodeColors: vi.fn(),
      setNodeColor: vi.fn(),
    }),
    VIZ_PALETTE: ['#000000'],
    executeAnalysisRerun: vi.fn(
      async ({
        hasUnrunChanges,
        clearResults,
        runFreshAnalysis,
      }: {
        hasUnrunChanges: boolean;
        clearResults: () => Promise<void>;
        runFreshAnalysis: () => Promise<void>;
      }) => {
        if (hasUnrunChanges) {
          await clearResults();
        }
        await runFreshAnalysis();
      },
    ),
  };
});

import ConcordanceFeature from '../ConcordanceFeature';

describe('ConcordanceFeature', () => {
  beforeEach(() => {
    handleSearchMock.mockClear();
    clearResultsMock.mockClear();
    latestTaskFlowParams = null;
    mockPendingConcordance = null;
    mockHydrationState = { status: 'idle', lastHydratedAt: 1 };
    mockInitialResult = null;
    mockSetSafeResult = null;
    // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async interface
    clearResultsMock.mockImplementation(async () => {
      mockSetSafeResult?.(null);
    });
  });

  it('clears previous results before rerunning when clicking Re-run', () => {
    const { unmount } = renderWithClient(<ConcordanceFeature />);

    fireEvent.change(screen.getAllByPlaceholderText('Enter word or phrase to search for')[0]!, {
      target: { value: 'new value' },
    });

    fireEvent.click(screen.getAllByRole('button', { name: /re-?run/i })[0]!);

    return waitFor(() => {
      expect(clearResultsMock).toHaveBeenCalledTimes(1);
      expect(handleSearchMock).toHaveBeenCalledTimes(1);
    }).finally(unmount);
  });

  it('runs a fresh search when clicking Re-run after changing parameters', () => {
    const { unmount } = renderWithClient(<ConcordanceFeature />);

    fireEvent.change(screen.getAllByPlaceholderText('Enter word or phrase to search for')[0]!, {
      target: { value: 'new value' },
    });

    fireEvent.click(screen.getAllByRole('button', { name: /re-?run/i })[0]!);

    return waitFor(() => {
      expect(handleSearchMock).toHaveBeenCalledWith(
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
      );
    }).finally(unmount);
  });

  it('defaults whole-word on and disables it when regex is enabled', () => {
    const { unmount } = renderWithClient(<ConcordanceFeature />);

    const wholeWordCheckbox = screen.getByRole('checkbox', { name: /whole word/i });
    const regexCheckbox = screen.getByRole('checkbox', { name: /use regular expression/i });

    expect(wholeWordCheckbox).toBeChecked();
    expect(wholeWordCheckbox).toBeEnabled();
    expect(latestTaskFlowParams?.state?.wholeWord).toBe(true);

    fireEvent.click(regexCheckbox);

    expect(regexCheckbox).toBeChecked();
    expect(wholeWordCheckbox).not.toBeChecked();
    expect(wholeWordCheckbox).toBeDisabled();
    expect(latestTaskFlowParams?.state?.wholeWord).toBe(false);

    unmount();
  });

  it('fills the concordance search box from a pending token handoff when no results exist', async () => {
    mockPendingConcordance = {
      searchWord: 'keyword',
      selectedNodes: [{ id: 'node-1', name: 'Node 1' }],
      nodeColumnSelections: [{ nodeId: 'node-1', column: 'text' }],
      autoRun: false,
      timestamp: 1,
    };

    const { unmount } = renderWithClient(<ConcordanceFeature />);

    await waitFor(() => {
      expect(screen.getAllByPlaceholderText('Enter word or phrase to search for')[0]).toHaveValue(
        'keyword',
      );
    });

    unmount();
  });

  it('fills the concordance search box directly from a token handoff even when results already exist', async () => {
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
          metadata: {
            metadata_columns: [],
            concordance_columns: [],
            all_columns: [],
          },
          pagination: {
            page: 1,
            page_size: 20,
            total_source_rows: 0,
            total_source_pages: 1,
            result_count: 0,
            has_prev: false,
            has_next: false,
          },
          sorting: { descending: false },
        },
      },
    };

    const { unmount } = renderWithClient(<ConcordanceFeature />);

    await waitFor(() => {
      expect(screen.getAllByPlaceholderText('Enter word or phrase to search for')[0]).toHaveValue(
        'replacement',
      );
    });

    // Token clicks always open a fresh tab, so the handoff applies unconditionally:
    // no overwrite prompt is shown and results are never force-cleared.
    expect(screen.queryByText('Replace concordance results?')).not.toBeInTheDocument();
    expect(clearResultsMock).not.toHaveBeenCalledWith({ preserveLocalState: true });

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
          columns: [
            'text',
            'speaker',
            'CONC_LEFT_CONTEXT',
            'CONC_MATCHED_TEXT',
            'CONC_RIGHT_CONTEXT',
          ],
          metadata: {
            metadata_columns: ['text', 'speaker'],
            concordance_columns: ['CONC_LEFT_CONTEXT', 'CONC_MATCHED_TEXT', 'CONC_RIGHT_CONTEXT'],
            all_columns: [
              'text',
              'speaker',
              'CONC_LEFT_CONTEXT',
              'CONC_MATCHED_TEXT',
              'CONC_RIGHT_CONTEXT',
            ],
          },
          pagination: {
            page: 1,
            page_size: 20,
            total_source_rows: 1,
            total_source_pages: 1,
            result_count: 1,
            has_prev: false,
            has_next: false,
          },
          sorting: { descending: false },
        },
      },
    };

    const { unmount } = renderWithClient(<ConcordanceFeature />);

    fireEvent.click(screen.getByRole('tab', { name: /dispersion view/i }));

    await waitFor(() => {
      expect(screen.getByText('CONC_dispersion')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('checkbox', { name: /bar length proportional to text length/i }),
    ).toBeInTheDocument();

    expect(screen.queryByText('CONC_LEFT_CONTEXT')).not.toBeInTheDocument();
    expect(screen.queryByText('CONC_MATCHED_TEXT')).not.toBeInTheDocument();
    expect(screen.queryByText('CONC_RIGHT_CONTEXT')).not.toBeInTheDocument();

    unmount();
  });

  it('keeps the dispersion column at 85% of the table width when metadata is shown', async () => {
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(800);
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
          columns: [
            'document',
            'speaker',
            'CONC_LEFT_CONTEXT',
            'CONC_MATCHED_TEXT',
            'CONC_RIGHT_CONTEXT',
          ],
          metadata: {
            metadata_columns: ['document', 'speaker'],
            concordance_columns: ['CONC_LEFT_CONTEXT', 'CONC_MATCHED_TEXT', 'CONC_RIGHT_CONTEXT'],
            all_columns: [
              'document',
              'speaker',
              'CONC_LEFT_CONTEXT',
              'CONC_MATCHED_TEXT',
              'CONC_RIGHT_CONTEXT',
            ],
          },
          pagination: {
            page: 1,
            page_size: 20,
            total_source_rows: 1,
            total_source_pages: 1,
            result_count: 1,
            has_prev: false,
            has_next: false,
          },
          sorting: { descending: false },
        },
      },
    };

    const { unmount } = renderWithClient(<ConcordanceFeature />);

    fireEvent.click(screen.getByRole('tab', { name: /dispersion view/i }));

    await waitFor(() => {
      expect(screen.getByText('CONC_dispersion')).toBeInTheDocument();
    });

    // The Show metadata dropdown starts with no columns selected; the user
    // must pick before any metadata column appears.
    expect(screen.queryByRole('columnheader', { name: 'document' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'speaker' })).not.toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole('button', { name: /show metadata/i }), { button: 0 });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /document/i }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /speaker/i }));
    fireEvent.keyDown(screen.getByRole('menu', { name: /show metadata/i }), { key: 'Escape' });

    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: /speaker/i })).toBeInTheDocument();
    });
    // 800 × 0.85 = 680. Metadata columns get a 200 px minimum so the table
    // can extend beyond the viewport, exposing the ScrollArea's horizontal
    // scrollbar — the user keeps a long dispersion bar and still discovers
    // any metadata that wouldn't otherwise fit.
    expect(screen.getByRole('columnheader', { name: 'CONC_dispersion' })).toHaveStyle({
      width: '680px',
    });
    expect(screen.getByRole('columnheader', { name: 'speaker' })).toHaveStyle({
      minWidth: '200px',
    });

    unmount();
    clientWidthSpy.mockRestore();
  });

  it('does not auto-select metadata columns; the dropdown starts empty', async () => {
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
                CONC_left_context: '',
                CONC_matched_text: 'alpha',
                CONC_right_context: 'beta alpha',
                CONC_start_idx: 0,
                CONC_end_idx: 5,
              },
            ],
          ],
          columns: [
            'speaker',
            'text',
            'CONC_left_context',
            'CONC_matched_text',
            'CONC_right_context',
          ],
          metadata: {
            metadata_columns: ['speaker', 'text'],
            concordance_columns: ['CONC_left_context', 'CONC_matched_text', 'CONC_right_context'],
            all_columns: [
              'speaker',
              'text',
              'CONC_left_context',
              'CONC_matched_text',
              'CONC_right_context',
            ],
          },
          pagination: {
            page: 1,
            page_size: 20,
            total_source_rows: 1,
            total_source_pages: 1,
            result_count: 1,
            has_prev: false,
            has_next: false,
          },
          sorting: { descending: false },
        },
      },
    };

    renderWithClient(<ConcordanceFeature />);

    await waitFor(() => {
      expect(screen.getByText('CONC_left_context')).toBeInTheDocument();
    });

    // No metadata column should appear as a column header until the user
    // explicitly ticks one in the Show metadata dropdown.
    expect(screen.queryByRole('columnheader', { name: /^speaker$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /^text$/i })).not.toBeInTheDocument();
  });

  it('shows the current page concordance occurrence count in the pagination label', () => {
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
          pagination: {
            page: 1,
            page_size: 20,
            total_source_rows: 1,
            total_source_pages: 1,
            result_count: 1,
            has_prev: false,
            has_next: false,
          },
          sorting: { descending: false },
        },
      },
    };

    renderWithClient(<ConcordanceFeature />);

    expect(screen.getAllByText('Documents per batch').length).toBeGreaterThan(0);
    // total_source_rows from the mock pagination (1) is now preferred over
    // page_size (20) for the "processed N documents" label — page_size is
    // a configuration knob, not an actual processed count.
    expect(
      screen.getByText('(Found 2 instances in 1 document after processing 1 document).'),
    ).toBeInTheDocument();
  });

  it('hides the proportional-width control until Dispersion View is enabled', () => {
    mockInitialResult = {
      state: 'successful',
      message: 'ok',
      data: {
        'node-1': {
          data: [],
          columns: [],
          metadata: {
            metadata_columns: [],
            concordance_columns: [],
            all_columns: [],
          },
          pagination: {
            page: 1,
            page_size: 20,
            total_source_rows: 0,
            total_source_pages: 1,
            result_count: 0,
            has_prev: false,
            has_next: false,
          },
          sorting: { descending: false },
        },
      },
    };

    const { unmount } = renderWithClient(<ConcordanceFeature />);

    expect(
      screen.queryByRole('checkbox', { name: /bar length proportional to text length/i }),
    ).not.toBeInTheDocument();

    unmount();
  });
});
