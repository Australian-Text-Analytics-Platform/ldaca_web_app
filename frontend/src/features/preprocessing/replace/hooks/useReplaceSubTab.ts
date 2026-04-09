import { useEffect, useState } from 'react';

import type { WorkspaceNodeLike } from '../../../../components/NodeSelectionPanel';
import { takeMostRecent } from '../../../../utils/selectionUtils';
import {
  nodesApi,
  type FilterPreviewResponse,
  type ReplaceApplyResponse,
  type ReplaceRequest,
} from '../../../../api/nodes';
import { mapColumnsToInfo } from '../../../../utils/columnTypes';
import { usePreprocessingPreview } from '../../hooks/usePreprocessingPreview';
import type { PreviewPagination, PreviewRow } from '../../types';

const DEFAULT_PALETTE = ['#2563eb'];

const getNodeId = (node: WorkspaceNodeLike, fallbackIndex: number): string =>
  node.id || node.node_id || `node-${fallbackIndex}`;

type NodeColumnSelection = { nodeId: string; column: string };

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

interface ReplacePreviewRequest {
  nodeId: string;
  payload: ReplaceRequest | null;
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
  const stringColumnKey = stringColumns.join('\u0000');
  const firstStringColumn = stringColumns[0] ?? '';

  const [selectedColumn, setSelectedColumn] = useState('');
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

  useEffect(() => {
    const availableColumns = stringColumnKey.length > 0 ? stringColumnKey.split('\u0000') : [];
    if (!activeNodeId || stringColumnKey.length === 0) {
      setSelectedColumn('');
      return;
    }
    if (selectedColumn && availableColumns.includes(selectedColumn)) return;
    setSelectedColumn(firstStringColumn);
  }, [activeNodeId, firstStringColumn, selectedColumn, stringColumnKey]);

  const hasSelection = Boolean(activeNodeId);
  const hasOperation = Boolean(selectedColumn && pattern.length > 0);

  const replacePreviewRequest: ReplacePreviewRequest | null = (() => {
    if (!hasSelection || !activeNodeId) return null;
    if (!hasOperation) return { nodeId: activeNodeId, payload: null };
    return {
      nodeId: activeNodeId,
      payload: {
        source_column: selectedColumn,
        pattern,
        replacement,
        output_column_name: previewColumnName,
        mode,
        count,
        n: count === 'first' ? (n ?? 1) : undefined,
        connector: mode === 'extract' ? connectorValue : undefined,
      },
    };
  })();

  const previewSignature = (() => {
    if (!replacePreviewRequest) return 'replace-preview-disabled';
    if (!replacePreviewRequest.payload) return `${replacePreviewRequest.nodeId}::raw`;
    return `${replacePreviewRequest.nodeId}::${JSON.stringify(replacePreviewRequest.payload)}`;
  })();

  const previewFetcher = async ({
    request,
    page,
    pageSize,
  }: {
    request: ReplacePreviewRequest;
    page: number;
    pageSize: number;
    signal: AbortSignal;
  }) => {
    if (request.payload) {
      const response = await replaceTextPreview(request.nodeId, request.payload, page, pageSize);
      return {
        data: Array.isArray(response?.data) ? (response.data as PreviewRow[]) : [],
        columns: Array.isArray(response?.columns) ? response.columns : [],
        pagination: (response?.pagination as PreviewPagination) ?? null,
      };
    }
    const response = await nodesApi.data(request.nodeId, page, pageSize);
    return {
      data: Array.isArray(response?.data) ? (response.data as PreviewRow[]) : [],
      columns: Array.isArray(response?.columns) ? response.columns : [],
      pagination: (response?.pagination as PreviewPagination) ?? null,
    };
  };

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
  } = usePreprocessingPreview({
    request: replacePreviewRequest,
    signature: previewSignature,
    fetcher: previewFetcher,
  });

  const currentPreviewPage = previewPagination?.page ?? previewPage;

  const handlePreviewPrev = () => {
    if (previewPagination?.has_prev && !previewLoading) {
      setPreviewPage(Math.max(1, currentPreviewPage - 1));
    }
  };

  const handlePreviewNext = () => {
    if (previewPagination?.has_next && !previewLoading) {
      setPreviewPage(currentPreviewPage + 1);
    }
  };

  const controlsDisabled = !hasSelection || isLoading.nodeData || isLoading.operations || applyLoading;
  const canApply = Boolean(activeNodeId && selectedColumn && pattern.length > 0 && !applyLoading);
  const resolvedOutputColumnName = previewColumnName;

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
  const nodeColors = activeNodeId ? { [activeNodeId]: DEFAULT_PALETTE[0] } : {};

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
    applyLoading,
    handleApply,
    nodeColumnSelections,
    nodeColors,
    defaultPalette: DEFAULT_PALETTE,
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
      onPreviousPage: handlePreviewPrev,
      onNextPage: handlePreviewNext,
    },
  };
};
