import React from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const detachDialogMocks = vi.hoisted(() => ({
  render: vi.fn(),
  onOpenChange: vi.fn(),
  toggleDetachColumn: vi.fn(),
  selectAllDetachColumns: vi.fn(),
  deselectAllDetachColumns: vi.fn(),
  handleDetachConfirm: vi.fn(),
}));

const resultApiMocks = vi.hoisted(() => ({
  getAnalysisResult: vi.fn(),
  queryAnalysisResult: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  getAnalysisResult: resultApiMocks.getAnalysisResult,
  queryAnalysisResult: resultApiMocks.queryAnalysisResult,
}));

const quotationHydrationMocks = vi.hoisted(() => ({
  latestConfig: null as {
    onRequest?: (request: unknown) => void | Promise<void>;
    resultQuery?: Readonly<Record<string, unknown>>;
    fetchResult: (taskId: string, query?: Readonly<Record<string, unknown>>) => Promise<unknown>;
  } | null,
  request: null as Record<string, unknown> | null,
  result: null as Record<string, unknown> | null,
  latestResultControlsArgs: null as Record<string, unknown> | null,
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => ({ currentWorkspaceId: 'workspace-1' }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: () => ({
    detachQuotation: vi.fn(),
  }),
}));

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (state: { currentView: string }) => unknown) =>
    selector({ currentView: 'quotation' }),
}));

vi.mock('../../common/nodeInputs', () => ({
  useTabNodeInputs: () => ({
    nodeColumnSelections: [],
    selectedNodes: [],
    resolvedNodes: [],
    availableNodes: [],
    graphSelectedIds: [],
    recentPresets: [],
    canAddMore: true,
    addNodes: vi.fn(() => []),
    getAddRejection: vi.fn(() => null),
    removeNode: vi.fn(),
    clear: vi.fn(),
    setColumn: vi.fn(),
  }),
}));

vi.mock('../../common/hooks/useAnalysisFeature', () => ({
  useAnalysisFeature: (config: NonNullable<typeof quotationHydrationMocks.latestConfig>) => {
    quotationHydrationMocks.latestConfig = config;
    return {
      analysisId: 'task-1',
      request: quotationHydrationMocks.request,
      analysisState: 'succeeded',
      analysisError: null,
      result: quotationHydrationMocks.result,
      resolveTaskId: vi.fn(() => Promise.resolve('task-1')),
      setLocalTaskId: vi.fn(),
      isRunning: false,
      setIsRunning: vi.fn(),
      runningRef: { current: false },
      lastFetchedRef: { current: { taskId: null, state: null } },
      banner: null,
      taskStatus: { tasks: [] },
      hydrationState: { status: 'idle' },
      clearResults: vi.fn(() => Promise.resolve(true)),
      stopTask: vi.fn(() => Promise.resolve()),
      isStopping: false,
    };
  },
}));

vi.mock('../../common/rerunAnalysis', () => ({
  executeAnalysisRerun: vi.fn(),
}));

vi.mock('../hooks/useQuotationEngineSettings', () => ({
  useQuotationEngineSettings: () => ({
    engineConfig: { type: 'local' },
    lastRemoteEngineId: '',
    engineError: null,
    resolvedEnginePayload: { type: 'local' },
    engineReady: true,
    setTaskEngineConfig: vi.fn(),
    updateRemoteEngineId: vi.fn(),
    hydrateEngineConfig: vi.fn(),
    buildEngineRequest: vi.fn(() => ({ type: 'local' })),
  }),
}));

vi.mock('../hooks/useQuotationContextPreference', () => ({
  useQuotationContextPreference: () => ({
    contextLength: 50,
    contextLengthInput: '50',
    contextLengthError: null,
    isSavingContextLength: false,
    setContextLengthInput: vi.fn(),
    handleContextLengthBlur: vi.fn(),
    handleContextLengthKeyDown: vi.fn(),
    applyPreferenceFromResult: vi.fn(),
  }),
}));

vi.mock('../hooks/useQuotationRowDetail', () => ({
  useQuotationRowDetail: () => ({
    detailPayload: null,
    detailOpen: false,
    setDetailOpen: vi.fn(),
    quotationCustomization: null,
    handleRowClick: vi.fn(),
  }),
}));

vi.mock('../hooks/useQuotationResultControls', () => ({
  useQuotationResultControls: (args: Record<string, unknown>) => {
    quotationHydrationMocks.latestResultControlsArgs = args;
    return {
      nodeState: {},
      nodeDetaching: {},
      setNodeDetaching: vi.fn(),
      resultsByNode: {},
    };
  },
}));

vi.mock('../hooks/useQuotationTaskFlow', () => ({
  useQuotationTaskFlow: () => ({
    handleSearchAll: vi.fn(),
    handlePageChange: vi.fn(),
    handlePageSizeChange: vi.fn(),
    handleSort: vi.fn(),
    handleDetach: vi.fn(),
  }),
}));

vi.mock('../hooks/useQuotationDetachDialog', () => ({
  useQuotationDetachDialog: () => ({
    openDetachDialog: vi.fn(),
    detachDialog: {
      open: false,
      isDetaching: false,
      detachNodeOptions: [],
      selectedDetachColumns: {},
      onOpenChange: detachDialogMocks.onOpenChange,
      toggleDetachColumn: detachDialogMocks.toggleDetachColumn,
      selectAllDetachColumns: detachDialogMocks.selectAllDetachColumns,
      deselectAllDetachColumns: detachDialogMocks.deselectAllDetachColumns,
      handleDetachConfirm: detachDialogMocks.handleDetachConfirm,
    },
  }),
}));

vi.mock('../../common/components/DetachColumnsDialog', () => ({
  DetachColumnsDialog: (props: Record<string, unknown>) => {
    detachDialogMocks.render(props);
    return null;
  },
}));

vi.mock('../../common/components/AnalysisCardLayout', () => ({
  AnalysisCardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../common/components/RowDetailPanel', () => ({
  RowDetailPanel: () => null,
}));

vi.mock('../../common/hooks/usePersistNodeDocumentColumn', () => ({
  usePersistNodeDocumentColumn: () => vi.fn(),
}));

vi.mock('@/features/views/common/components/NodeInputsPanel', () => ({
  NodeInputsPanel: () => null,
}));

vi.mock('@/features/views/common/components/AnalysisTaskBanner', () => ({
  default: () => null,
}));

vi.mock('../components/QuotationEngineSettingsFields', () => ({
  QuotationEngineSettingsFields: () => null,
}));

vi.mock('../components/QuotationResultsPanel', () => ({
  QuotationResultsPanel: () => null,
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AlertDialogAction: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import QuotationFeature from '../QuotationFeature';

describe('QuotationFeature detach dialog', () => {
  beforeEach(() => {
    resultApiMocks.getAnalysisResult.mockReset();
    resultApiMocks.queryAnalysisResult.mockReset();
    quotationHydrationMocks.latestConfig = null;
    quotationHydrationMocks.request = null;
    quotationHydrationMocks.result = null;
    quotationHydrationMocks.latestResultControlsArgs = null;
  });

  it('owns quotation copy and forwards the hook-owned handlers', () => {
    render(
      <QuotationFeature
        host={{
          taskId: null,
          inputSets: {},
          settings: {},
          setTaskId: vi.fn(),
          setInputSet: vi.fn(),
          setSetting: vi.fn(),
        }}
      />,
    );

    expect(detachDialogMocks.render).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Detach Quotation Results',
        description:
          'Select optional source columns to include alongside the quotation results. Required output columns stay checked automatically.',
        onOpenChange: detachDialogMocks.onOpenChange,
        toggleDetachColumn: detachDialogMocks.toggleDetachColumn,
        selectAllDetachColumns: detachDialogMocks.selectAllDetachColumns,
        deselectAllDetachColumns: detachDialogMocks.deselectAllDetachColumns,
        handleDetachConfirm: detachDialogMocks.handleDetachConfirm,
      }),
    );
  });

  it('passes the persisted Query-owned Result to quotation controls after hydration', async () => {
    const host = {
      taskId: 'task-1',
      inputSets: {},
      settings: {},
      setTaskId: vi.fn(),
      setInputSet: vi.fn(),
      setSetting: vi.fn(),
    };
    const persistedResult = {
      kind: 'quotation',
      data: [],
      columns: ['QUOTE_extraction'],
      metadata: { all_columns: ['QUOTE_extraction'] },
      pagination: {
        page: 1,
        page_size: 50,
        total_source_rows: 1,
        total_source_pages: 1,
        result_count: 0,
        has_next: false,
        has_prev: false,
      },
      query: { kind: 'quotation', page: 1, page_size: 50 },
      sorting: { sort_by: null, descending: false },
    };
    quotationHydrationMocks.request = {
      kind: 'quotation',
      node_id: 'node-1',
      column: 'text',
      engine: { type: 'local' },
    };
    quotationHydrationMocks.result = persistedResult;

    render(<QuotationFeature host={host} />);

    await quotationHydrationMocks.latestConfig?.onRequest?.(quotationHydrationMocks.request);

    expect(host.setInputSet).toHaveBeenCalledWith('source', [
      { node_id: 'node-1', column: 'text' },
    ]);
    expect(quotationHydrationMocks.latestResultControlsArgs).toEqual({
      result: persistedResult,
      nodeId: 'node-1',
      column: 'text',
    });
  });

  it('hydrates the canonical Result before requesting alternate projections', async () => {
    const canonicalResult = { kind: 'quotation', data: [] };
    const projectedResult = { kind: 'quotation', data: [[{ text: 'projected' }]] };
    resultApiMocks.getAnalysisResult.mockResolvedValueOnce({ data: canonicalResult });
    resultApiMocks.queryAnalysisResult.mockResolvedValueOnce({ data: projectedResult });

    render(
      <QuotationFeature
        host={{
          taskId: 'task-1',
          inputSets: {},
          settings: {},
          setTaskId: vi.fn(),
          setInputSet: vi.fn(),
          setSetting: vi.fn(),
        }}
      />,
    );

    const config = quotationHydrationMocks.latestConfig;
    if (!config) throw new Error('Quotation analysis config was not captured');
    expect(config.resultQuery).toBeUndefined();
    await expect(config.fetchResult('task-1')).resolves.toBe(canonicalResult);
    expect(resultApiMocks.getAnalysisResult).toHaveBeenCalledWith({
      path: { workspace_id: 'workspace-1', analysis_id: 'task-1' },
      throwOnError: true,
    });
    expect(resultApiMocks.queryAnalysisResult).not.toHaveBeenCalled();

    const projection = {
      page: 2,
      page_size: 50,
      sort_by: null,
      descending: false,
    };
    await expect(config.fetchResult('task-1', projection)).resolves.toBe(projectedResult);
    expect(resultApiMocks.queryAnalysisResult).toHaveBeenCalledWith({
      body: { kind: 'quotation', ...projection },
      path: { workspace_id: 'workspace-1', analysis_id: 'task-1' },
      throwOnError: true,
    });
  });
});
