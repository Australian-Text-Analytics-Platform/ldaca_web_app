import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wraps Concordance feature tests with a no-retry query client so failed
 * request fixtures settle immediately instead of scheduling background retries.
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
const detachDialogMocks = vi.hoisted(() => ({
  render: vi.fn(),
  openTable: vi.fn(),
  openDispersion: vi.fn(),
  table: {
    onOpenChange: vi.fn(),
    toggleDetachColumn: vi.fn(),
    selectAllDetachColumns: vi.fn(),
    deselectAllDetachColumns: vi.fn(),
    handleDetachConfirm: vi.fn(),
  },
  dispersion: {
    onOpenChange: vi.fn(),
    toggleDetachColumn: vi.fn(),
    selectAllDetachColumns: vi.fn(),
    deselectAllDetachColumns: vi.fn(),
    handleDetachConfirm: vi.fn(),
  },
}));
let latestTaskFlowParams: { state?: Record<string, unknown> } | null = null;
let mockHydrationState = { status: 'idle' as const };
let mockInitialResult: Record<string, unknown> | null = null;
let mockAnalysisState: 'successful' | null = null;
let latestAnalysisFeatureConfig: {
  onRequest?: (request: unknown) => void | Promise<void>;
} | null = null;

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../../common/nodeInputs', () => ({
  nodeInputsFromSelections: (selections: { nodeId: string; column?: string | null }[]) =>
    selections.map((selection) => ({
      node_id: selection.nodeId,
      column: selection.column ?? null,
    })),
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
    nodeInfoCache: { 'node-1': { id: 'node-1', name: 'Node 1' } },
    getColumnInfos: vi.fn(() => [{ name: 'text', dataType: 'string' }]),
    getNodeInfo: vi.fn(() => ({ id: 'node-1', name: 'Node 1' })),
  }),
}));

vi.mock('@/components/help/HelpIcon', () => ({
  /** Replaces help popovers with a stable marker for component rendering tests. */
  default: () => <span data-testid="help-icon" />,
}));

vi.mock('@/components/help/InfoIcon', () => ({
  /** Replaces informational popovers with a stable marker for component rendering tests. */
  default: () => <span data-testid="info-icon" />,
}));

vi.mock('@/features/views/common/components/AnalysisTaskBanner', () => ({
  /** Removes lifecycle banner rendering so button and handoff assertions stay focused. */
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
    TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    /** Converts tab triggers into plain buttons that still fire their own Tabs' value change. */
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
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  /** Removes Radix portal behavior for local test rendering. */
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  /** Preserves dialog heading grouping without layout dependencies. */
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  /** Renders dialog titles as plain text for screen queries. */
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/confirm-dialog', () => ({
  /** Provides a minimal confirm dialog that exercises confirm/cancel callbacks. */
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
  useWorkspaceSelection: () => ({
    selectedNodes: [{ id: 'node-1', name: 'Node 1' }],
  }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceStatus', () => ({
  /** Keeps workspace loading false so the feature renders immediately. */
  useWorkspaceStatus: () => ({ isLoading: { graph: false } }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  /** Supplies a stable workspace id required by concordance actions. */
  useWorkspaceData: () => ({ currentWorkspaceId: 'ws-1' }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceActions', () => ({
  /** Stubs workspace mutations that are outside this feature-level test boundary. */
  useWorkspaceActions: () => ({
    detachConcordance: vi.fn(),
    materializeConcordance: vi.fn(),
    replaceSelectedNodes: vi.fn(),
  }),
}));

vi.mock('@/features/auth/hooks/useAuth', () => ({
  /** Provides auth shape expected by generated API calls without real credentials. */
  useAuth: () => ({}),
}));

vi.mock('@/features/workspace/common/hooks/useNodeColumnInfos', () => ({
  /** Supplies the text column needed for auto-selection and parameter rendering. */
  useNodeColumnInfos: () => ({
    /** Reports a single string column so concordance has a valid target. */
    getColumnInfos: () => [{ name: 'text' }],
  }),
}));

vi.mock('@/stores', () => ({
  /** Pins the UI store to the concordance tab so lifecycle hooks stay active. */
  useUIStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ currentView: 'concordance' }),
}));

vi.mock('@/hooks/analysisTaskUtils', () => ({
  pruneTasksById: vi.fn((tasks) => tasks),
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

vi.mock('../hooks/useConcordanceDetachDialogs', () => ({
  useConcordanceDetachDialogs: () => ({
    openDetachDialog: detachDialogMocks.openTable,
    openDispersionDetachDialog: detachDialogMocks.openDispersion,
    detachDialog: {
      open: false,
      isDetaching: false,
      detachNodeOptions: [],
      selectedDetachColumns: {},
      ...detachDialogMocks.table,
    },
    dispersionDetachDialog: {
      open: false,
      isDetaching: false,
      detachNodeOptions: [],
      selectedDetachColumns: {},
      ...detachDialogMocks.dispersion,
    },
  }),
}));

vi.mock('../../common/components/DetachColumnsDialog', () => ({
  DetachColumnsDialog: (props: Record<string, unknown>) => {
    detachDialogMocks.render(props);
    return null;
  },
}));

vi.mock('../../common/hooks/useAnalysisFeature', () => ({
  /** Supplies canonical Query-owned Analysis and Result resources for feature tests. */
  useAnalysisFeature: (config: {
    hydrationTaskId?: string | null;
    onRequest?: (request: unknown) => void | Promise<void>;
  }) => {
    latestAnalysisFeatureConfig = config;
    const request = config.hydrationTaskId
      ? {
          kind: 'concordance',
          node_ids: ['node-1'],
          node_columns: { 'node-1': 'text' },
          search_word: 'old value',
          num_left_tokens: 10,
          num_right_tokens: 10,
          regex: false,
          whole_word: true,
          case_sensitive: false,
          search_mode: 'tokens',
        }
      : null;
    const result =
      config.hydrationTaskId && mockInitialResult
        ? {
            kind: 'concordance',
            sources: [],
            metadata: {},
            query: { kind: 'concordance' },
            ...mockInitialResult,
          }
        : null;
    return {
      analysisId: config.hydrationTaskId ?? null,
      request,
      analysisState: mockAnalysisState === 'successful' ? 'succeeded' : null,
      analysisError: null,
      result,
      resolveTaskId: vi.fn(() => 'task-1'),
      setLocalTaskId: vi.fn(),
      isRunning: false,
      setIsRunning: vi.fn(),
      runningRef: { current: false },
      lastFetchedRef: { current: { taskId: null, state: null } },
      taskStatus: {
        tasks: mockAnalysisState ? [{ state: mockAnalysisState }] : [],
      },
      banner: null,
      hydrationState: mockHydrationState,
      clearResults: clearResultsMock,
      stopTask: vi.fn(),
      isStopping: false,
    };
  },
}));

vi.mock('../../common/hooks/useNodeColorControls', () => ({
  /** Supplies deterministic source colours for feature tests. */
  useNodeColorControls: () => ({
    defaultPalette: ['#000000'],
    nodeColors: { 'node-1': '#000000' },
    nodeColorOverrides: {},
    ensureNodeColors: vi.fn(),
    setNodeColor: vi.fn(),
  }),
}));

vi.mock('../../common/rerunAnalysis', () => ({
  executeAnalysisRerun: vi.fn(
    async ({
      hasAttachedAnalysis,
      clearResults,
      runFreshAnalysis,
    }: {
      hasAttachedAnalysis: boolean;
      clearResults: () => Promise<boolean>;
      runFreshAnalysis: () => Promise<void>;
    }) => {
      if (hasAttachedAnalysis) {
        const cleared = await clearResults();
        if (!cleared) return;
      }
      await runFreshAnalysis();
    },
  ),
}));

import ConcordanceFeature from '../ConcordanceFeature';

const renderConcordanceFeature = (taskId: string | null = null) => {
  const setInputSet = vi.fn();
  return {
    ...renderWithClient(
      <ConcordanceFeature
        host={{
          tabId: 'tab-1',
          taskId,
          inputSets: {},
          settings: {},
          setTaskId: vi.fn(),
          setInputSet,
          setSetting: vi.fn(),
        }}
      />,
    ),
    setInputSet,
  };
};

describe('ConcordanceFeature', () => {
  beforeEach(() => {
    handleSearchMock.mockClear();
    clearResultsMock.mockClear();
    latestTaskFlowParams = null;
    mockHydrationState = { status: 'idle' };
    mockInitialResult = null;
    mockAnalysisState = null;
    latestAnalysisFeatureConfig = null;
    detachDialogMocks.render.mockClear();

    clearResultsMock.mockResolvedValue(true);
  });

  it('restores the persisted Analysis Data Blocks into the owning Tab input set', async () => {
    const { setInputSet } = renderConcordanceFeature('analysis-1');

    await act(async () => {
      await latestAnalysisFeatureConfig?.onRequest?.({
        node_ids: ['node-2', 'node-1'],
        node_columns: { 'node-1': 'text', 'node-2': 'body' },
        search_word: 'queensland',
      });
    });

    expect(setInputSet).toHaveBeenCalledWith('source', [
      { node_id: 'node-2', column: 'body' },
      { node_id: 'node-1', column: 'text' },
    ]);
  });

  it('owns table and dispersion detach copy and forwards each dialog handler set', () => {
    const { unmount } = renderConcordanceFeature('analysis-1');

    const calls = detachDialogMocks.render.mock.calls.map(([props]) => props);
    const table = calls.find((props) => props.title === 'Detach Concordance Results');
    const dispersion = calls.find(
      (props) => props.title === 'Add aggregated concordance to workspace',
    );

    expect(table).toEqual(
      expect.objectContaining({
        description:
          'Select optional source columns to include alongside the concordance results. Required output columns stay checked automatically.',
        ...detachDialogMocks.table,
      }),
    );
    expect(dispersion).toEqual(
      expect.objectContaining({
        description:
          'The detached data block always includes the per-document extract, matched-text list, and L1/R1 contexts as list columns. Optionally include the document column and any source metadata columns. The document column is selected by default — uncheck to omit it.',
        ...detachDialogMocks.dispersion,
      }),
    );

    unmount();
  });

  it('clears previous results before rerunning when clicking Re-run', () => {
    mockAnalysisState = 'successful';
    const { unmount } = renderConcordanceFeature('analysis-1');

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
    mockAnalysisState = 'successful';
    const { unmount } = renderConcordanceFeature('analysis-1');

    fireEvent.change(screen.getAllByPlaceholderText('Enter word or phrase to search for')[0]!, {
      target: { value: 'new value' },
    });

    fireEvent.click(screen.getAllByRole('button', { name: /re-?run/i })[0]!);

    return waitFor(() => {
      expect(handleSearchMock).toHaveBeenCalledWith();
    }).finally(unmount);
  });

  it('defaults whole-word on and disables it when regex is enabled', () => {
    const { unmount } = renderConcordanceFeature('analysis-1');

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

    const { unmount } = renderConcordanceFeature('analysis-1');

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

    const { unmount } = renderConcordanceFeature('analysis-1');

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

    renderConcordanceFeature('analysis-1');

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

    renderConcordanceFeature('analysis-1');

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

    const { unmount } = renderConcordanceFeature('analysis-1');

    expect(
      screen.queryByRole('checkbox', { name: /bar length proportional to text length/i }),
    ).not.toBeInTheDocument();

    unmount();
  });
});
