import { useState } from 'react';

import type { NodeColumnSelection, WorkspaceNodeLike } from '@/features/analysis/common/components/NodeSelectionPanel';
import { usePreprocessingPreview } from '../../hooks/usePreprocessingPreview';
import type {
  ConcatNodeSummary,
  ConcatPreviewRequestPayload,
  ConcatSchemaAnalysis,
  PreviewPagination,
  PreviewRow,
} from '../../types';
import { MAX_CONCAT_NODES } from '../../types';
import { buildWorkspaceNodeMap, deriveNodeLabel, extractNodeColumns, extractNodeDtypes, getNodeKey } from '../../utils/nodeMetadata';
import { dedupeNodeIds, takeMostRecent } from '@/utils/selectionUtils';

const DEFAULT_CONCAT_PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#f97316', '#d946ef', '#0ea5e9', '#f59e0b', '#14b8a6'];

export interface ConcatSubTabProps {
  selectedNodeIds: string[];
  currentWorkspaceId: string | null;
  workspaceNodes: WorkspaceNodeLike[];
  concatNodes: (nodeIds: string[], newNodeName?: string) => Promise<unknown>;
  concatPreview: (
    nodeIds: string[],
    page: number,
    pageSize: number,
  ) => Promise<{
    data: PreviewRow[];
    columns: string[];
    pagination: PreviewPagination | null;
  }>;
  isLoading: {
    operations: boolean;
  };
  onAlert: (message: string) => void;
}

interface ConcatSelectionPanelConfig {
  selectedNodes: WorkspaceNodeLike[];
  nodeColumnSelections: NodeColumnSelection[];
  nodeColors: Record<string, string>;
  defaultPalette: string[];
  disabled: boolean;
  originalCount: number;
  statusMessage: string | null;
  statusVariant: 'warning' | 'error' | null;
  maxCompare: number;
  onColumnChange: () => void;
  onColorChange: () => void;
}

interface ConcatFormControllers {
  value: string;
  setValue: (value: string) => void;
  placeholder: string;
}

interface ConcatPreviewConfig {
  columns: string[];
  data: PreviewRow[];
  pagination: PreviewPagination | null;
  loading: boolean;
  error: string | null;
  ready: boolean;
  readyMessage: string;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

interface ConcatApplyState {
  run: () => Promise<void>;
  disabled: boolean;
  disabledReason: string | undefined;
  isBusy: boolean;
}

export interface UseConcatSubTabResult {
  selectionPanel: ConcatSelectionPanelConfig;
  form: ConcatFormControllers;
  statusMessage: string;
  statusVariant: 'warning' | 'error' | null;
  extraSelectionMessage: string | null;
  analysis: ConcatSchemaAnalysis;
  preview: ConcatPreviewConfig;
  apply: ConcatApplyState;
  mismatches: ConcatSchemaAnalysis['mismatches'];
  showActivityTag: boolean;
}

const noop = () => undefined;

const buildConcatNodeSummaries = (nodes: WorkspaceNodeLike[]): ConcatNodeSummary[] => {
  return nodes.map((node) => {
    const nodeId = getNodeKey(node);
    const displayName = deriveNodeLabel(node) || nodeId;

    const columns = extractNodeColumns(node);
    const rawDtypes = extractNodeDtypes(node);

    const uniqueColumns = Array.from(new Set(columns.map((name) => String(name))));
    const normalizedColumns = uniqueColumns.toSorted((a, b) => a.localeCompare(b));
    const normalizedDtypes = normalizedColumns.reduce<Record<string, string>>((acc, column) => {
      const dtype = rawDtypes[column];
      acc[column] = dtype ? dtype.toString().toLowerCase() : '';
      return acc;
    }, {});

    return {
      nodeId,
      displayName,
      columns: uniqueColumns,
      normalizedColumns,
      dtypes: normalizedDtypes,
      rawDtypes,
      columnCount: uniqueColumns.length,
    };
  });
};

const analyzeSchema = (summaries: ConcatNodeSummary[]): ConcatSchemaAnalysis => {
  const result: ConcatSchemaAnalysis = {
    summaries,
    ready: false,
    issues: '',
    mismatches: [],
    baseColumns: [],
    baseColumnCount: 0,
  };

  if (summaries.length === 0) {
    result.issues = 'Select data blocks in the workspace to enable stacking.';
    return result;
  }

  if (summaries.length < 2) {
    result.issues = 'Pick at least two data blocks to stack.';
    return result;
  }

  const base = summaries[0]!;
  if (!base.normalizedColumns.length) {
    result.issues = `${base.displayName || base.nodeId} has no columns to align.`;
    return result;
  }

  result.baseColumns = base.normalizedColumns;
  result.baseColumnCount = base.normalizedColumns.length;

  const baseColumnSet = new Set(base.normalizedColumns);
  const baseDtypes = base.normalizedColumns.reduce<Record<string, string>>((acc, column) => {
    acc[column] = base.dtypes[column] ?? '';
    return acc;
  }, {});

  summaries.slice(1).forEach((summary) => {
    const summaryColumnSet = new Set(summary.normalizedColumns);
    const missing = Array.from(baseColumnSet).filter((column) => !summaryColumnSet.has(column));
    const extra = Array.from(summaryColumnSet).filter((column) => !baseColumnSet.has(column));
    const typeMismatches = Array.from(baseColumnSet).filter((column) => {
      if (!summaryColumnSet.has(column)) return false;
      const baseType = baseDtypes[column] ?? '';
      const summaryType = summary.dtypes[column] ?? '';
      return baseType && summaryType && baseType !== summaryType;
    });

    const details: string[] = [];
    if (missing.length) {
      details.push(`Missing columns: ${missing.sort().join(', ')}`);
    }
    if (extra.length) {
      details.push(`Extra columns: ${extra.sort().join(', ')}`);
    }
    if (typeMismatches.length) {
      const mismatchText = typeMismatches
        .sort()
        .map((column) => `${column} (${baseDtypes[column] || 'unknown'} vs ${summary.dtypes[column] || 'unknown'})`)
        .join(', ');
      details.push(`Type mismatches: ${mismatchText}`);
    }

    if (details.length) {
      result.mismatches.push({
        nodeId: summary.nodeId,
        nodeName: summary.displayName || summary.nodeId,
        details,
      });
    }
  });

  if (result.mismatches.length === 0) {
    result.ready = true;
    result.issues = `Ready to stack ${summaries.length} data blocks (${result.baseColumnCount} columns).`;
  } else {
    result.issues = 'Resolve schema mismatches before stacking.';
  }

  return result;
};

export const useConcatSubTab = (props: ConcatSubTabProps): UseConcatSubTabResult => {
  const {
    selectedNodeIds,
    currentWorkspaceId,
    workspaceNodes,
    concatPreview,
    concatNodes,
    isLoading,
    onAlert,
  } = props;

  const [newNodeName, setNewNodeName] = useState('');
  const [isConcatenating, setIsConcatenating] = useState(false);

  const workspaceNodeMap = buildWorkspaceNodeMap(workspaceNodes);

  const uniqueNodeIds = dedupeNodeIds(selectedNodeIds);
  const concatNodeIds = takeMostRecent(uniqueNodeIds, MAX_CONCAT_NODES);
  const concatOriginalCount = uniqueNodeIds.length;

  const concatSelectedNodes: WorkspaceNodeLike[] = (() => {
    return concatNodeIds
      .map((nodeId) => workspaceNodeMap.get(nodeId))
      .filter((node): node is WorkspaceNodeLike => Boolean(node));
  })();

  const concatNodeSummaries = buildConcatNodeSummaries(concatSelectedNodes);

  const concatAnalysis = analyzeSchema(concatNodeSummaries);

  const statusVariant: 'warning' | 'error' | null = (() => {
    if (concatAnalysis.ready || !concatAnalysis.issues) return null;
    return concatAnalysis.mismatches.length > 0 ? 'error' : 'warning';
  })();

  const autoConcatName = (() => {
    if (!concatAnalysis.summaries.length) return '';
    const labels = concatAnalysis.summaries
      .map((summary) => summary.displayName || summary.nodeId)
      .filter(Boolean);
    if (!labels.length) return '';
    if (labels.length <= 3) {
      return `Stack(${labels.join(', ')})`;
    }
    const shortened = `${labels.slice(0, 3).join(', ')}, …`;
    return `Stack(${shortened})`;
  })();

  const concatUsedNodeIds = concatAnalysis.summaries.map((summary) => summary.nodeId);

  const concatPreviewRequest = (() => {
    if (!concatAnalysis.ready) return null;
    return { nodeIds: concatUsedNodeIds } satisfies ConcatPreviewRequestPayload;
  })();

  const concatPreviewSignature = (() => {
    if (!concatPreviewRequest) return 'concat-preview-disabled';
    return concatPreviewRequest.nodeIds.join('|');
  })();

  const concatPreviewFetcher = async ({
    request,
    page,
    pageSize,
  }: {
    request: ConcatPreviewRequestPayload;
    page: number;
    pageSize: number;
  }) => {
    const response = await concatPreview(request.nodeIds, page, pageSize);
    return {
      data: Array.isArray(response?.data) ? (response.data as PreviewRow[]) : [],
      columns: Array.isArray(response?.columns) ? response.columns : [],
      pagination: response?.pagination ?? null,
    };
  };

  const {
    data: concatPreviewData,
    columns: concatPreviewColumns,
    pagination: concatPreviewPagination,
    loading: concatPreviewLoading,
    error: concatPreviewError,
    ready: concatPreviewReady,
    page: concatPreviewPage,
    pageSize: concatPreviewPageSize,
    setPage: setConcatPreviewPage,
    setPageSize: setConcatPreviewPageSize,
  } = usePreprocessingPreview<ConcatPreviewRequestPayload, PreviewRow>({
    request: concatPreviewRequest,
    signature: concatPreviewSignature,
    fetcher: concatPreviewFetcher,
  });

  const concatPreviewColumnsToRender = (() => {
    if (concatPreviewColumns.length > 0) return concatPreviewColumns;
    if (concatPreviewData.length > 0 && typeof concatPreviewData[0] === 'object' && concatPreviewData[0] !== null) {
      return Object.keys(concatPreviewData[0]);
    }
    return [];
  })();

  const handleConcatPreviewPageSizeChange = (size: number) => {
    if (!Number.isNaN(size)) {
      setConcatPreviewPageSize(size);
    }
  };

  const readyMessage = concatAnalysis.summaries.length < 2
    ? 'Select at least two data blocks to generate a stack preview.'
    : concatAnalysis.issues;

  const applyDisabled =
    !concatAnalysis.ready || !currentWorkspaceId || isConcatenating || isLoading.operations;

  const applyDisabledReason: string | undefined = (() => {
    if (isConcatenating || isLoading.operations) return undefined;
    if (!concatAnalysis.ready) return concatAnalysis.issues || 'Select at least two compatible data blocks to stack';
    return undefined;
  })();

  const handleApplyConcat = async () => {
    if (!concatAnalysis.ready) {
      onAlert(concatAnalysis.issues || 'Select at least two compatible data blocks to stack.');
      return;
    }
    const nodeIds = concatAnalysis.summaries.map((summary) => summary.nodeId);
    if (nodeIds.length < 2) {
      onAlert('Pick at least two data blocks to stack.');
      return;
    }

    const requestedName = newNodeName.trim() || autoConcatName || undefined;
    try {
      setIsConcatenating(true);
      await concatNodes(nodeIds, requestedName);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error applying stack';
      onAlert(`Error applying stack: ${message}`);
    } finally {
      setIsConcatenating(false);
    }
  };

  const selectionPanel: ConcatSelectionPanelConfig = {
    selectedNodes: concatSelectedNodes,
    nodeColumnSelections: concatNodeIds.map((nodeId) => ({ nodeId, column: '' })),
    nodeColors: concatNodeIds.reduce<Record<string, string>>((acc, nodeId, index) => {
      acc[nodeId] = DEFAULT_CONCAT_PALETTE[index % DEFAULT_CONCAT_PALETTE.length]!;
      return acc;
    }, {}),
    defaultPalette: DEFAULT_CONCAT_PALETTE,
    disabled: concatSelectedNodes.length < 2,
    originalCount: concatOriginalCount,
    statusMessage: concatAnalysis.ready ? null : concatAnalysis.issues,
    statusVariant,
    maxCompare: MAX_CONCAT_NODES,
    onColumnChange: noop,
    onColorChange: noop,
  };

  const extraSelectionMessage = concatOriginalCount > MAX_CONCAT_NODES
    ? `Using the most recent ${MAX_CONCAT_NODES} of ${concatOriginalCount} selected data blocks. Deselect extras to choose which ones to include.`
    : null;

  return {
    selectionPanel,
    form: {
      value: newNodeName,
      setValue: setNewNodeName,
      placeholder: autoConcatName || 'Concatenated dataset',
    },
    statusMessage: concatAnalysis.issues,
    statusVariant,
    extraSelectionMessage,
    analysis: concatAnalysis,
    preview: {
      columns: concatPreviewColumnsToRender,
      data: concatPreviewData,
      pagination: concatPreviewPagination,
      loading: concatPreviewLoading,
      error: concatPreviewError,
      ready: concatPreviewReady,
      readyMessage,
      page: concatPreviewPage,
      pageSize: concatPreviewPageSize,
      onPageChange: setConcatPreviewPage,
      onPageSizeChange: handleConcatPreviewPageSizeChange,
    },
    apply: {
      run: handleApplyConcat,
      disabled: applyDisabled,
      disabledReason: applyDisabledReason,
      isBusy: isConcatenating,
    },
    mismatches: concatAnalysis.mismatches,
    showActivityTag: isConcatenating || isLoading.operations,
  };
};
