import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Analysis } from '@/api';
import type { RunAnalysisOptions } from '../../common/hooks/useAnalysisFeature';

async function executeAnalysis<TAnalysis extends Analysis>(options: RunAnalysisOptions<TAnalysis>) {
  try {
    options.resetBeforeRun?.();
    await options.prepare?.();
    const response = await options.submit();
    options.onSuccess?.(response);
    return response;
  } catch (error) {
    options.onError(error);
    return null;
  }
}

vi.mock('@/features/guidance/useProgressiveContextualHints', () => ({
  useProgressiveContextualHints: vi.fn(),
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
  isResultFetching: false,
  selectedNodes: [] as Record<string, unknown>[],
  nodeColumnSelections: [] as Record<string, unknown>[],
  resolvedNodes: [] as Record<string, unknown>[],
  latestResultControlsArgs: null as Record<string, unknown> | null,
  latestResultsPanelProps: null as Record<string, unknown> | null,
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => ({ currentWorkspaceId: 'workspace-1' }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: () => ({
    runQuotationAll: vi.fn(),
  }),
}));

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (state: { currentView: string }) => unknown) =>
    selector({ currentView: 'quotation' }),
}));

vi.mock('../../common/nodeInputs', () => ({
  useTabNodeInputs: () => ({
    nodeColumnSelections: quotationHydrationMocks.nodeColumnSelections,
    selectedNodes: quotationHydrationMocks.selectedNodes,
    resolvedNodes: quotationHydrationMocks.resolvedNodes,
    nodeInfoById: {},
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
      request: quotationHydrationMocks.request,
      analysisState: 'succeeded',
      analysisError: null,
      result: quotationHydrationMocks.result,
      isResultFetching: quotationHydrationMocks.isResultFetching,
      isRunning: false,
      isSubmittingRunAll: false,
      runAnalysis: executeAnalysis,
      banner: null,
      taskStatus: { tasks: [] },
      clearResults: vi.fn(() => Promise.resolve(true)),
      stopTask: vi.fn(() => Promise.resolve()),
      isStopping: false,
    };
  },
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

vi.mock('../hooks/useQuotationPage', () => ({
  useQuotationPage: (target: unknown) => {
    quotationHydrationMocks.latestResultControlsArgs = { target };
    return { data: null, isFetching: false };
  },
}));

vi.mock('../hooks/useQuotationTaskFlow', () => ({
  useQuotationTaskFlow: () => ({
    handleSearchAll: vi.fn(),
    handlePageChange: vi.fn(),
    handlePageSizeChange: vi.fn(),
    handleSort: vi.fn(),
  }),
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
  QuotationResultsPanel: (props: Record<string, unknown>) => {
    quotationHydrationMocks.latestResultsPanelProps = props;
    return null;
  },
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

const renderFeature = (element: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);
};

describe('QuotationFeature Preview lifecycle', () => {
  beforeEach(() => {
    resultApiMocks.getAnalysisResult.mockReset();
    resultApiMocks.queryAnalysisResult.mockReset();
    quotationHydrationMocks.latestConfig = null;
    quotationHydrationMocks.request = null;
    quotationHydrationMocks.result = null;
    quotationHydrationMocks.isResultFetching = false;
    quotationHydrationMocks.selectedNodes = [];
    quotationHydrationMocks.nodeColumnSelections = [];
    quotationHydrationMocks.resolvedNodes = [];
    quotationHydrationMocks.latestResultControlsArgs = null;
    quotationHydrationMocks.latestResultsPanelProps = null;
  });

  it('uses the persisted ready marker to target the Preview Arrow page', async () => {
    const host = {
      tabId: 'tab-1',
      analyses: [],
      latestPreview: { id: 'task-1' } as never,
      latestRunAll: null,
      activeAnalysis: null,
      inputSets: {},
      settings: {},
      correctionColumns: {},
      setInputSet: vi.fn(),
      setSetting: vi.fn(),
      setCorrectionColumn: vi.fn(),
      clearCorrectionColumns: vi.fn(),
      refreshAnalyses: vi.fn(),
    };
    const persistedResult = { kind: 'quotation', ready: true };
    quotationHydrationMocks.request = {
      kind: 'quotation',
      node_id: 'node-1',
      column: 'text',
      engine: { type: 'local' },
    };
    quotationHydrationMocks.result = persistedResult;

    renderFeature(<QuotationFeature host={host} />);

    await quotationHydrationMocks.latestConfig?.onRequest?.(quotationHydrationMocks.request);

    expect(host.setInputSet).toHaveBeenCalledWith('source', [
      { node_id: 'node-1', column: 'text' },
    ]);
    expect(quotationHydrationMocks.latestResultControlsArgs).toEqual({
      target: {
        kind: 'preview',
        workspaceId: 'workspace-1',
        analysisId: 'task-1',
        nodeId: 'node-1',
        documentColumn: 'text',
      },
    });
  });

  it('hydrates only the canonical ready marker through the generic Result route', async () => {
    const canonicalResult = { kind: 'quotation', ready: true };
    resultApiMocks.getAnalysisResult.mockResolvedValueOnce({ data: canonicalResult });

    renderFeature(
      <QuotationFeature
        host={{
          tabId: 'tab-1',
          analyses: [],
          latestPreview: null,
          latestRunAll: null,
          activeAnalysis: null,
          inputSets: {},
          settings: {},
          correctionColumns: {},
          setInputSet: vi.fn(),
          setSetting: vi.fn(),
          setCorrectionColumn: vi.fn(),
          clearCorrectionColumns: vi.fn(),
          refreshAnalyses: vi.fn(),
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

    expect(resultApiMocks.queryAnalysisResult).not.toHaveBeenCalled();
  });

  it('keeps the Preview table shell mounted while the first page is processing', () => {
    quotationHydrationMocks.isResultFetching = true;
    quotationHydrationMocks.selectedNodes = [{ id: 'node-1', name: 'Documents' }];
    quotationHydrationMocks.nodeColumnSelections = [{ nodeId: 'node-1', column: 'text' }];
    quotationHydrationMocks.resolvedNodes = [{ id: 'node-1', columnOptions: [{ name: 'text' }] }];

    renderFeature(
      <QuotationFeature
        host={{
          tabId: 'tab-1',
          analyses: [],
          latestPreview: null,
          latestRunAll: null,
          activeAnalysis: null,
          inputSets: {},
          settings: {},
          correctionColumns: {},
          setInputSet: vi.fn(),
          setSetting: vi.fn(),
          setCorrectionColumn: vi.fn(),
          clearCorrectionColumns: vi.fn(),
          refreshAnalyses: vi.fn(),
        }}
      />,
    );

    expect(quotationHydrationMocks.latestResultsPanelProps).toMatchObject({
      isPageLoading: true,
    });
  });
});
