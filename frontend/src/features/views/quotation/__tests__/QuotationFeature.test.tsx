import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const detachDialogMocks = vi.hoisted(() => ({
  render: vi.fn(),
  onOpenChange: vi.fn(),
  toggleDetachColumn: vi.fn(),
  selectAllDetachColumns: vi.fn(),
  deselectAllDetachColumns: vi.fn(),
  handleDetachConfirm: vi.fn(),
}));

const quotationHydrationMocks = vi.hoisted(() => ({
  latestConfig: null as {
    onResultFetched?: (result: unknown, taskId: string) => void | Promise<void>;
    onHydratedRequest?: (request: unknown) => void | Promise<void>;
    onHydratedResult?: (result: unknown) => void | Promise<void>;
  } | null,
  updateResultState: vi.fn(),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => ({ currentWorkspaceId: 'workspace-1' }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: () => ({
    quotationSearch: vi.fn(),
    detachQuotation: vi.fn(),
    materializeQuotation: vi.fn(),
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

vi.mock('../../common/hooks/useLastRunRequest', () => ({
  useLastRunRequest: () => ({ serverRequest: null }),
}));

vi.mock('../../common/hooks/useAnalysisFeature', () => ({
  useAnalysisFeature: (config: NonNullable<typeof quotationHydrationMocks.latestConfig>) => {
    quotationHydrationMocks.latestConfig = config;
    return {
    resolveTaskId: vi.fn(() => Promise.resolve('task-1')),
    setLocalTaskId: vi.fn(),
    banner: null,
    taskStatus: { tasks: [] },
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
    lastRemoteUrl: '',
    engineError: null,
    resolvedEnginePayload: { type: 'local', isValid: true, normalizedUrl: null },
    engineReady: true,
    setTaskEngineConfig: vi.fn(),
    updateRemoteUrl: vi.fn(),
    hydrateEngineConfig: vi.fn(),
    buildEngineRequest: vi.fn(),
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
  useQuotationResultControls: () => ({
    nodeState: {},
    nodeDetaching: {},
    setNodeDetaching: vi.fn(),
    nodeMaterializing: {},
    setNodeMaterializing: vi.fn(),
    materializeTaskIds: {},
    setMaterializeTaskIds: vi.fn(),
    materializedPaths: {},
    materializeSummary: {},
    resultsByNode: {},
    updateResultState: quotationHydrationMocks.updateResultState,
    applyMaterializedRequest: vi.fn(),
    resetAfterClear: vi.fn(),
  }),
}));

vi.mock('../hooks/useQuotationTaskFlow', () => ({
  useQuotationTaskFlow: () => ({
    persistContextLengthPreference: vi.fn(() => Promise.resolve()),
    handleSearchAll: vi.fn(),
    handlePageChange: vi.fn(),
    handlePageSizeChange: vi.fn(),
    handleSort: vi.fn(),
    handleDetach: vi.fn(),
    handleMaterialize: vi.fn(),
  }),
}));

vi.mock('../hooks/useQuotationMaterializeLifecycle', () => ({
  useQuotationMaterializeLifecycle: vi.fn(),
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

  it('restores the persisted result after hydrating its saved request', async () => {
    const host = {
      taskId: 'task-1',
      inputSets: {},
      settings: {},
      setTaskId: vi.fn(),
      setInputSet: vi.fn(),
      setSetting: vi.fn(),
    };
    render(<QuotationFeature host={host} />);

    const persistedResult = {
      kind: 'quotation',
      state: 'successful',
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

    await quotationHydrationMocks.latestConfig?.onHydratedRequest?.({
      kind: 'quotation',
      node_id: 'node-1',
      column: 'text',
      engine: { type: 'local' },
    });
    expect(quotationHydrationMocks.updateResultState).not.toHaveBeenCalled();

    await quotationHydrationMocks.latestConfig?.onResultFetched?.(persistedResult, 'task-1');

    expect(quotationHydrationMocks.updateResultState).toHaveBeenCalledWith(
      'node-1',
      'text',
      expect.objectContaining({ kind: 'quotation', state: 'successful' }),
    );
  });
});
