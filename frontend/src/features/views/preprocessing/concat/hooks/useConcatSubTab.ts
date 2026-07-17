import { useState } from 'react';
import { util, type DataType, type Field, type Type, type TypeMap } from 'apache-arrow';

import type { NodeColumnSelection } from '@/features/views/common/nodeSelectionTypes';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import type { ColumnInfo } from '@/features/workspace/data-view/utils/columnTypes';
import { usePreprocessingPreview } from '../../hooks/usePreprocessingPreview';
import type {
  ConcatNodeSummary,
  ConcatPreviewRequestPayload,
  ConcatSchemaAnalysis,
  PreviewPagination,
  PreviewRow,
} from '../../types';
import { MAX_CONCAT_NODES } from '../../types';
import { dedupeNodeIds } from '@/features/workspace/common/utils/selectionUtils';

type ComparableArrowType = DataType<Type, TypeMap>;

const comparableType = (field: Field): ComparableArrowType => field.type as ComparableArrowType;

const DEFAULT_CONCAT_PALETTE = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#f97316',
  '#d946ef',
  '#0ea5e9',
  '#f59e0b',
  '#14b8a6',
];

export interface ConcatSubTabProps {
  selectedNodeIds: string[];
  currentWorkspaceId: string | null;
  workspaceNodes: WorkspaceNodeMetadata[];
  getColumnInfos: (node: WorkspaceNodeMetadata) => ColumnInfo[];
  concatNodes: (nodeIds: string[], newNodeName?: string, deduplicate?: boolean) => Promise<unknown>;
  concatPreview: (
    request: ConcatPreviewRequestPayload & {
      page: number;
      pageSize: number;
      signal: AbortSignal;
    },
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
  selectedNodes: WorkspaceNodeMetadata[];
  nodeColumnSelections: NodeColumnSelection[];
  nodeColors: Record<string, string>;
  defaultPalette: string[];
  disabled: boolean;
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
  deduplicate: boolean;
  setDeduplicate: (value: boolean) => void;
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
  analysis: ConcatSchemaAnalysis;
  preview: ConcatPreviewConfig;
  apply: ConcatApplyState;
  mismatches: ConcatSchemaAnalysis['mismatches'];
  showActivityTag: boolean;
}

/**
 * Placeholder handler for display-only node input callbacks hidden in concat mode.
 * Passed through display-only callbacks in the concat selection panel.
 */
const noop = () => undefined;

/**
 * Summarizes selected nodes into normalized schema metadata. The concat hook
 * uses these summaries for compatibility analysis, preview payloads, and UI
 * status messages.
 * Called by `useConcatSubTab` before schema compatibility analysis.
 * Steps: derive display labels, collect unique columns, normalize dtype lookup keys, and
 * return the metadata needed by preview/apply paths.
 */
const buildConcatNodeSummaries = (
  nodes: WorkspaceNodeMetadata[],
  getColumnInfos: (node: WorkspaceNodeMetadata) => ColumnInfo[],
): ConcatNodeSummary[] => {
  return nodes.map((node) => {
    const nodeId = node.id;
    const displayName = node.name;

    const columnInfos = getColumnInfos(node);
    const columns = columnInfos.map((column) => column.name);
    const fields = Object.fromEntries(columnInfos.map((column) => [column.name, column.field]));

    const uniqueColumns = Array.from(new Set(columns));
    const normalizedColumns = uniqueColumns.toSorted((a, b) => a.localeCompare(b));
    return {
      nodeId,
      displayName,
      columns: uniqueColumns,
      normalizedColumns,
      fields,
      columnCount: uniqueColumns.length,
    };
  });
};

/**
 * Compares selected node schemas to decide whether stacking is safe. The hook
 * feeds the result to disabled states, mismatch panels, and preview readiness.
 * Called by `useConcatSubTab` to gate preview and apply state.
 * Steps: group node schemas by column name, detect dtype/presence mismatches, and return a
 * summary that drives warnings before concatenation.
 */
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

  // summaries has at least two entries (guarded by the length check above).
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const base = summaries[0]!;
  if (!base.normalizedColumns.length) {
    result.issues = `${base.displayName || base.nodeId} has no columns to align.`;
    return result;
  }

  result.baseColumns = base.normalizedColumns;
  result.baseColumnCount = base.normalizedColumns.length;

  const baseColumnSet = new Set(base.normalizedColumns);
  summaries.slice(1).forEach((summary) => {
    const summaryColumnSet = new Set(summary.normalizedColumns);
    const missing = Array.from(baseColumnSet).filter((column) => !summaryColumnSet.has(column));
    const extra = Array.from(summaryColumnSet).filter((column) => !baseColumnSet.has(column));
    const typeMismatches = Array.from(baseColumnSet).filter((column) => {
      if (!summaryColumnSet.has(column)) return false;
      const baseField = base.fields[column];
      const summaryField = summary.fields[column];
      return (
        !baseField ||
        !summaryField ||
        !util.compareTypes(comparableType(baseField), comparableType(summaryField)) ||
        baseField.metadata.get('ARROW:extension:name') !==
          summaryField.metadata.get('ARROW:extension:name')
      );
    });

    const details: string[] = [];
    if (missing.length) {
      details.push(`Missing columns: ${missing.sort().join(', ')}`);
    }
    if (extra.length) {
      details.push(`Extra columns: ${extra.sort().join(', ')}`);
    }
    if (typeMismatches.length) {
      details.push(`Type mismatches: ${typeMismatches.sort().join(', ')}`);
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
    result.issues = `Ready to stack ${String(summaries.length)} data blocks (${String(result.baseColumnCount)} columns).`;
  } else {
    result.issues = 'Resolve schema mismatches before stacking.';
  }

  return result;
};

/**
 * Owns Concatenate sub-tab state. `ConcatSubTab` consumes this hook for node
 * selection display, schema mismatch reporting, preview data, and the apply
 * action.
 * Used by: ConcatSubTab module.
 * Flow: derive eligible nodes and schema diagnostics, run preview for node ordering/page
 * changes, build concat requests, and apply/refresh the resulting node.
 */
export const useConcatSubTab = (props: ConcatSubTabProps): UseConcatSubTabResult => {
  const {
    selectedNodeIds,
    currentWorkspaceId,
    workspaceNodes,
    getColumnInfos,
    concatPreview,
    concatNodes,
    isLoading,
    onAlert,
  } = props;

  const [newNodeName, setNewNodeName] = useState('');
  const [deduplicate, setDeduplicate] = useState(true);
  const [isConcatenating, setIsConcatenating] = useState(false);

  const workspaceNodeMap = new Map(workspaceNodes.map((node) => [node.id, node]));

  const concatNodeIds = dedupeNodeIds(selectedNodeIds);

  const concatSelectedNodes: WorkspaceNodeMetadata[] = (() => {
    return concatNodeIds
      .map((nodeId) => workspaceNodeMap.get(nodeId))
      .filter((node): node is WorkspaceNodeMetadata => Boolean(node));
  })();

  const concatNodeSummaries = buildConcatNodeSummaries(concatSelectedNodes, getColumnInfos);

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
    if (!currentWorkspaceId || !concatAnalysis.ready) return null;
    return {
      workspaceId: currentWorkspaceId,
      nodeIds: concatUsedNodeIds,
      deduplicate,
    } satisfies ConcatPreviewRequestPayload;
  })();

  const concatPreviewSignature = (() => {
    if (!concatPreviewRequest) return 'concat-preview-disabled';
    return JSON.stringify(concatPreviewRequest);
  })();

  /**
   * Adapts the workspace concat preview callback to the generic preprocessing
   * preview hook result shape.
   * Passed to `usePreprocessingPreviewState` as its request fetcher.
   * Flow: call concat preview with ordered node ids, page and dedupe settings, then normalize rows, columns, and pagination for the shared preview hook.
   */
  const concatPreviewFetcher = async ({
    request,
    page,
    pageSize,
    signal,
  }: {
    request: ConcatPreviewRequestPayload;
    page: number;
    pageSize: number;
    signal: AbortSignal;
  }) => {
    const response = await concatPreview({ ...request, page, pageSize, signal });
    // response comes from the generated API client; guard defensively against a
    // malformed/empty payload that the typed contract does not capture.
    return {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      data: Array.isArray(response?.data) ? response.data : [],
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      columns: Array.isArray(response?.columns) ? response.columns : [],
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
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
  } = usePreprocessingPreview<ConcatPreviewRequestPayload>({
    request: concatPreviewRequest,
    signature: concatPreviewSignature,
    fetcher: concatPreviewFetcher,
  });

  /**
   * Resets preview pagination when the user changes rows per page.
   * Returned as `preview.onPageSizeChange` for `PreviewTable`.
   */
  const handleConcatPreviewPageSizeChange = (size: number) => {
    if (!Number.isNaN(size)) {
      setConcatPreviewPageSize(size);
    }
  };

  const readyMessage =
    concatAnalysis.summaries.length < 2
      ? 'Select at least two data blocks to generate a stack preview.'
      : concatAnalysis.issues;

  const applyDisabled =
    !concatAnalysis.ready || !currentWorkspaceId || isConcatenating || isLoading.operations;

  const applyDisabledReason: string | undefined = (() => {
    if (isConcatenating || isLoading.operations) return undefined;
    if (!concatAnalysis.ready)
      return concatAnalysis.issues || 'Select at least two compatible data blocks to stack';
    return undefined;
  })();

  /**
   * Applies the stack operation using the current compatible node set and
   * optional output name from the form.
   * Returned to `ConcatSubTab` as the Apply button action.
   * Steps: validate schema readiness, choose the output name, call concatNodes, and clear
   * loading state after success or failure.
   */
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
      await concatNodes(nodeIds, requestedName, deduplicate);
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
      // index % length is always a valid index of the non-empty palette.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      acc[nodeId] = DEFAULT_CONCAT_PALETTE[index % DEFAULT_CONCAT_PALETTE.length]!;
      return acc;
    }, {}),
    defaultPalette: DEFAULT_CONCAT_PALETTE,
    disabled: concatSelectedNodes.length < 2,
    statusMessage: concatAnalysis.ready ? null : concatAnalysis.issues,
    statusVariant,
    maxCompare: MAX_CONCAT_NODES,
    onColumnChange: noop,
    onColorChange: noop,
  };

  return {
    selectionPanel,
    form: {
      value: newNodeName,
      setValue: setNewNodeName,
      placeholder: autoConcatName || 'Concatenated dataset',
      deduplicate,
      setDeduplicate,
    },
    statusMessage: concatAnalysis.issues,
    statusVariant,
    analysis: concatAnalysis,
    preview: {
      columns: concatPreviewColumns,
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
