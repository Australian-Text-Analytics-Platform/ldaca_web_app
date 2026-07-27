import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Analysis } from '@/api';

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
const queryWorkspaceSqlTableMock = vi.hoisted(() => vi.fn());
const getAnalysisResultMock = vi.hoisted(() => vi.fn());
const fetchArrowTablePageMock = vi.hoisted(() => vi.fn());
const clearResultsMock = vi.fn(async () => {
  /* mock: resolves immediately */
});
let latestTaskFlowParams: { state?: Record<string, unknown> } | null = null;
let mockInitialResult: Record<string, unknown> | null = null;
let mockAnalysisState: 'successful' | null = null;
let mockRunAllAnalysis: Record<string, unknown> | null = null;
let mockIsPreviewRunning = false;
let latestAnalysisFeatureConfig: {
  onRequest?: (request: unknown) => void | Promise<void>;
} | null = null;

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getAnalysisResult: getAnalysisResultMock,
    queryWorkspaceSqlTable: queryWorkspaceSqlTableMock,
  };
});

vi.mock('@/lib/arrow/arrowTable', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchArrowTablePage: fetchArrowTablePageMock,
}));

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
    nodeInfoById: { 'node-1': { id: 'node-1', name: 'Node 1' } },
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
    runConcordanceAll: vi.fn(),
    publishAnalysisResult: vi.fn(),
    setNodeColor: vi.fn(),
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

vi.mock('../hooks/useConcordanceTaskFlow', () => ({
  /** Captures task-flow inputs while exposing controllable action mocks. */
  useConcordanceTaskFlow: (params: { state?: Record<string, unknown> }) => {
    latestTaskFlowParams = params;
    return {
      handleSearch: handleSearchMock,
      handleSort: vi.fn(),
      handlePageChange: vi.fn(),
      persistResultPreferences: vi.fn(),
    };
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
          node_tokenizer_models: { 'node-1': 'native:plain_words_en' },
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
      request,
      analysisState: mockAnalysisState === 'successful' ? 'succeeded' : null,
      analysisError: null,
      result,
      setLocalTaskId: vi.fn(),
      isRunning: mockIsPreviewRunning,
      setIsRunning: vi.fn(),
      runningRef: { current: false },
      taskStatus: {
        tasks: mockAnalysisState ? [{ state: mockAnalysisState }] : [],
      },
      banner: null,
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

import ConcordanceFeature from '../ConcordanceFeature';

const renderConcordanceFeature = (taskId: string | null = null) => {
  const setInputSet = vi.fn();
  const previewAnalysis: Analysis | null = taskId
    ? {
        cancellation_requested_at: null,
        created_at: '2026-07-25T00:00:00Z',
        error: null,
        execution_scope: 'preview',
        finished_at: '2026-07-25T00:00:01Z',
        id: taskId,
        integrity: { status: 'valid' },
        output_node_ids: [],
        parent_analysis_id: null,
        progress: { fraction: 1, message: null },
        request: {
          kind: 'concordance',
          node_ids: ['node-1'],
          node_columns: { 'node-1': 'text' },
          node_tokenizer_models: { 'node-1': 'native:plain_words_en' },
          search_word: 'old value',
          num_left_tokens: 10,
          num_right_tokens: 10,
          regex: false,
          whole_word: true,
          case_sensitive: false,
          search_mode: 'tokens',
        },
        revision: 1,
        started_at: '2026-07-25T00:00:00Z',
        state: 'succeeded',
        supersedes_analysis_ids: [],
        tab_id: 'tab-1',
      }
    : null;
  const runAllRoot: Analysis | null = mockRunAllAnalysis
    ? {
        ...previewAnalysis!,
        ...mockRunAllAnalysis,
        created_at: '2026-07-25T00:01:00Z',
        execution_scope: 'run_all',
        id: 'run-all-root',
        output_node_ids: [],
        request: {
          kind: 'concordance_run_all',
          source: previewAnalysis!.request,
        },
        supersedes_analysis_ids: taskId ? [taskId] : [],
      }
    : null;
  const runAllChild: Analysis | null =
    runAllRoot && mockRunAllAnalysis
      ? {
          ...runAllRoot,
          ...mockRunAllAnalysis,
          execution_scope: 'supporting',
          id: 'run-all-child',
          parent_analysis_id: runAllRoot.id,
          supersedes_analysis_ids: [],
        }
      : null;
  const analyses = [previewAnalysis, runAllRoot, runAllChild].filter(
    (analysis): analysis is Analysis => analysis !== null,
  );
  const activeAnalysis =
    runAllRoot?.state === 'queued' || runAllRoot?.state === 'running' ? runAllRoot : null;
  return {
    ...renderWithClient(
      <ConcordanceFeature
        host={{
          tabId: 'tab-1',
          analyses,
          latestPreview: previewAnalysis,
          latestRunAll: runAllRoot,
          activeAnalysis,
          inputSets: {},
          settings: {},
          correctionColumns: {},
          setInputSet,
          setSetting: vi.fn(),
          setCorrectionColumn: vi.fn(),
          clearCorrectionColumns: vi.fn(),
          refreshAnalyses: vi.fn(),
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
    mockInitialResult = null;
    mockAnalysisState = null;
    mockRunAllAnalysis = null;
    mockIsPreviewRunning = false;
    latestAnalysisFeatureConfig = null;
    queryWorkspaceSqlTableMock.mockReset();
    getAnalysisResultMock.mockReset();
    fetchArrowTablePageMock.mockReset();
    queryWorkspaceSqlTableMock.mockResolvedValue({
      table: {},
      columns: ['text'],
      schema: [],
      rows: [],
      hasNext: false,
      etag: 'default-etag',
    });
    fetchArrowTablePageMock.mockResolvedValue({
      table: {},
      columns: [],
      schema: [],
      rows: [],
      hasNext: false,
      etag: 'default-etag',
    });
    clearResultsMock.mockResolvedValue(true);
  });

  it('restores the persisted Analysis Data Blocks into the owning Tab input set', async () => {
    const { setInputSet } = renderConcordanceFeature('analysis-1');

    await act(async () => {
      await latestAnalysisFeatureConfig?.onRequest?.({
        node_ids: ['node-2', 'node-1'],
        node_columns: { 'node-1': 'text', 'node-2': 'body' },
        node_tokenizer_models: {
          'node-2': 'historical-model',
        },
        search_word: 'queensland',
        search_mode: 'regex',
      });
    });

    expect(setInputSet).toHaveBeenCalledWith('source', [
      { node_id: 'node-2', column: 'body' },
      { node_id: 'node-1', column: 'text' },
    ]);
    await waitFor(() => {
      expect(latestTaskFlowParams?.state).toMatchObject({
        searchMode: 'regex',
        tokenizerModelsByNode: {
          'node-2': 'historical-model',
          'node-1': '',
        },
      });
    });
  });

  it('supersedes previous Preview without clearing the forest first', () => {
    mockAnalysisState = 'successful';
    const { unmount } = renderConcordanceFeature('analysis-1');

    fireEvent.change(screen.getAllByPlaceholderText('Enter word or phrase to search for')[0]!, {
      target: { value: 'new value' },
    });

    fireEvent.click(screen.getAllByRole('button', { name: /update preview/i })[0]!);

    return waitFor(() => {
      expect(clearResultsMock).not.toHaveBeenCalled();
      expect(handleSearchMock).toHaveBeenCalledTimes(1);
    }).finally(unmount);
  });

  it('runs a fresh search when updating Preview after changing parameters', () => {
    mockAnalysisState = 'successful';
    const { unmount } = renderConcordanceFeature('analysis-1');

    fireEvent.change(screen.getAllByPlaceholderText('Enter word or phrase to search for')[0]!, {
      target: { value: 'new value' },
    });

    fireEvent.click(screen.getAllByRole('button', { name: /update preview/i })[0]!);

    return waitFor(() => {
      expect(handleSearchMock).toHaveBeenCalledWith();
    }).finally(unmount);
  });

  it('shows Update Preview instead of stale Running after Run All succeeds', () => {
    mockIsPreviewRunning = true;
    mockRunAllAnalysis = {
      state: 'succeeded',
      output_node_ids: ['result-1'],
      progress: { fraction: 1, message: 'Complete' },
    };

    const { unmount } = renderConcordanceFeature('analysis-1');

    expect(screen.getByRole('button', { name: 'Update Preview' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Running...' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();

    unmount();
  });

  it('attributes an active Run All lifecycle to Run All and explains disabled actions', async () => {
    const user = userEvent.setup();
    mockRunAllAnalysis = {
      state: 'running',
      output_node_ids: [],
      progress: { fraction: 0.5, message: 'Processing' },
    };

    const { unmount } = renderConcordanceFeature('analysis-1');

    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run All' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear Results' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Running...' })).not.toBeInTheDocument();

    const previewButton = screen.getByRole('button', { name: 'Preview' });
    await user.hover(previewButton);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Wait for Run All to finish');

    unmount();
  });

  it('loads Run All Review from the immutable Analysis table', async () => {
    mockAnalysisState = 'successful';
    mockInitialResult = {
      state: 'successful',
      message: 'ok',
      data: {},
    };
    mockRunAllAnalysis = {
      id: 'run-all-1',
      state: 'succeeded',
      output_node_ids: [],
      progress: { message: null },
    };
    getAnalysisResultMock.mockResolvedValue({
      data: {
        kind: 'concordance_run_all',
        result_type: 'source',
        source: {
          node_id: 'node-1',
          node_name: 'Node 1',
          document_column: 'text',
          metadata_columns: [],
          analysis_columns: ['CONC_matched_text', 'CONC_extraction'],
          internal_columns: ['__wordflow_source_row_id'],
          record_count: 1,
          table: {
            table_id: 'concordance-run-all',
            rows_url: '/analysis-rows',
            schema_url: '/analysis-schema',
          },
        },
      },
    });
    fetchArrowTablePageMock.mockResolvedValue({
      table: {},
      columns: ['__wordflow_source_row_id', 'text', 'CONC_matched_text', 'CONC_extraction'],
      schema: [],
      rows: [
        {
          __wordflow_source_row_id: 0,
          text: 'Queensland example',
          CONC_matched_text: 'Queensland',
          CONC_extraction: 'Queensland example',
        },
      ],
      hasNext: false,
      etag: 'review-etag',
    });

    const { unmount } = renderConcordanceFeature('analysis-1');

    await waitFor(() => {
      expect(screen.getByText('Review')).toBeInTheDocument();
    });
    expect(screen.getByText('Queensland')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Table View' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Dispersion View' })).toBeInTheDocument();
    expect(
      queryWorkspaceSqlTableMock.mock.calls.some(([options]) =>
        String((options as { body?: { sql?: string } }).body?.sql).includes('LEFT JOIN'),
      ),
    ).toBe(false);
    expect(fetchArrowTablePageMock).toHaveBeenCalledWith('/analysis-rows', {
      page: 1,
      pageSize: 20,
      sortBy: null,
      descending: false,
    });

    unmount();
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
