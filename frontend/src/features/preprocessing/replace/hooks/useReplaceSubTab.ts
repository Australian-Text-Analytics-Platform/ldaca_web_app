import { useState } from 'react';

import type { WorkspaceNodeLike } from '@/features/analysis/common/components/NodeSelectionPanel';
import { takeMostRecent } from '@/utils/selectionUtils';
import {
  type FilterPreviewResponse,
  type ReplaceApplyResponse,
  type ReplaceRequest,
} from '@/lib/backend/nodes';
import type { NodeColumnSelection } from '@/hooks/useAutoNodeColumns';
import { mapColumnsToInfo } from '@/utils/columnTypes';
import { useNodePreviewWithRawFallback } from '../../hooks/useNodePreviewWithRawFallback';

const SINGLE_NODE_PALETTE = ['#2563eb'];

const getNodeId = (node: WorkspaceNodeLike, fallbackIndex: number): string =>
  node.id || node.node_id || `node-${fallbackIndex}`;

export interface ReplaceSubTabProps {
  selectedNodeId: string | null;
  selectedNodes: WorkspaceNodeLike[];
  workspaceNodes: WorkspaceNodeLike[];
  isLoading: {
    nodeData: boolean;
    graph: boolean;
    operations: boolean;
  };
  onAlert: (message: string) => void;
  replaceTextPreview: (nodeId: string, request: ReplaceRequest, page?: number, pageSize?: number) => Promise<FilterPreviewResponse>;
  replaceText: (nodeId: string, request: ReplaceRequest) => Promise<ReplaceApplyResponse>;
  refreshNodeSchema: (nodeId: string) => Promise<unknown>;
}

export const useReplaceSubTab = (props: ReplaceSubTabProps) => {
  const {
    selectedNodeId,
    selectedNodes,
    workspaceNodes,
    isLoading,
    onAlert,
    replaceTextPreview,
    replaceText,
    refreshNodeSchema,
  } = props;
  const effectiveNodes = (() => {
    if (selectedNodes.length > 0) return takeMostRecent(selectedNodes, 1);
    if (!selectedNodeId) return [];
    const fallback = workspaceNodes.find((node, index) => getNodeId(node, index) === selectedNodeId);
    return fallback ? [fallback] : [];
  })();

  const activeNode = effectiveNodes[0] ?? null;
  const activeNodeId = activeNode ? getNodeId(activeNode, 0) : null;
  const stringColumns = activeNode
    ? mapColumnsToInfo(activeNode)
        .filter((column) => column.dataType === 'string')
        .map((column) => column.name)
    : [];
  const firstStringColumn = stringColumns[0] ?? '';

  const [selectedColumnDraft, setSelectedColumn] = useState('');
  const selectedColumn = activeNodeId && stringColumns.includes(selectedColumnDraft)
    ? selectedColumnDraft
    : firstStringColumn;
  const [mode, setMode] = useState<'replace' | 'extract'>('replace');
  const [n, setN] = useState<number | null>(null);
  const count = n !== null ? 'first' : 'all';
  const [pattern, setPattern] = useState('');
  const [replacement, setReplacement] = useState('');
  const [connector, setConnector] = useState('');
  const [outputColumnName, setOutputColumnName] = useState('');
  const [applyLoading, setApplyLoading] = useState(false);

  const connectorValue = connector === '' ? undefined : connector;

  const previewColumnName = outputColumnName.trim() || selectedColumn;

  const hasSelection = Boolean(activeNodeId);
  const hasOperation = Boolean(selectedColumn && pattern.length > 0);

  const operationPayload: ReplaceRequest | null = hasOperation
    ? {
        source_column: selectedColumn,
        pattern,
        replacement,
        output_column_name: previewColumnName,
        mode,
        count,
        n: count === 'first' ? (n ?? 1) : undefined,
        connector: mode === 'extract' ? connectorValue : undefined,
      }
    : null;

  const {
    data: previewData,
    columns: previewColumns,
    pagination: previewPagination,
    loading: previewLoading,
    error: previewError,
    page: previewPage,
    pageSize: previewPageSize,
    setPage: setPreviewPage,
    setPageSize: setPreviewPageSize,
  } = useNodePreviewWithRawFallback<ReplaceRequest>({
    nodeId: activeNodeId,
    operationPayload,
    operationFetch: replaceTextPreview,
    signaturePrefix: 'replace',
    enabled: hasSelection,
  });

  const controlsDisabled = !hasSelection || isLoading.nodeData || isLoading.operations || applyLoading;
  const canApply = Boolean(activeNodeId && selectedColumn && pattern.length > 0 && !applyLoading && !previewError);
  const resolvedOutputColumnName = previewColumnName;

  const applyDisabledReason: string | undefined = (() => {
    if (applyLoading || isLoading.operations) return undefined;
    if (!hasSelection) return 'Select a data block first';
    if (!selectedColumn) return 'No string column available in this data block';
    if (!pattern) return 'Enter a regex pattern first';
    if (previewError) return 'Fix the regex error shown in Preview results before applying';
    return undefined;
  })();

  const handleApply = async () => {
    if (!activeNodeId || !selectedColumn || pattern.length === 0) return;
    setApplyLoading(true);
    try {
      const request: ReplaceRequest = {
        source_column: selectedColumn,
        pattern,
        replacement,
        output_column_name: previewColumnName,
        mode,
        count,
        n: count === 'first' ? (n ?? 1) : undefined,
        connector: mode === 'extract' ? connectorValue : undefined,
      };
      const response = await replaceText(activeNodeId, request);
      onAlert(response.message || `Updated column ${response.column_name}`);
      await refreshNodeSchema(activeNodeId);
    } catch {
      // Error is shown via preview refresh
    } finally {
      setApplyLoading(false);
    }
  };

  const nodeColumnSelections: NodeColumnSelection[] = activeNodeId
    ? [{ nodeId: activeNodeId, column: selectedColumn }]
    : [];
  const nodeColors = activeNodeId ? { [activeNodeId]: SINGLE_NODE_PALETTE[0]! } : {};

  const previewReadyMessage = !hasSelection
    ? 'Select a data block to configure a find operation.'
    : 'Showing original data. Configure a pattern to preview find results.';

  return {
    activeNodeId,
    hasSelection,
    effectiveNodes,
    stringColumns,
    selectedColumn,
    setSelectedColumn,
    mode,
    setMode,
    count,
    n,
    setN,
    pattern,
    setPattern,
    replacement,
    setReplacement,
    connector,
    setConnector,
    outputColumnName,
    setOutputColumnName,
    previewColumnName,
    resolvedOutputColumnName,
    controlsDisabled,
    canApply,
    applyDisabledReason,
    applyLoading,
    handleApply,
    nodeColumnSelections,
    nodeColors,
    defaultPalette: SINGLE_NODE_PALETTE,
    selectedNodes,
    preview: {
      data: previewData,
      columns: previewColumns,
      pagination: previewPagination,
      loading: previewLoading,
      error: previewError,
      ready: hasSelection,
      readyMessage: previewReadyMessage,
      page: previewPage,
      pageSize: previewPageSize,
      setPageSize: setPreviewPageSize,
      onPageChange: setPreviewPage,
    },
  };
};
