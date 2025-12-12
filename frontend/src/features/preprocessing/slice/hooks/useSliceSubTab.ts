import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SliceRequest as SliceRequestPayload, FilterPreviewResponse } from '../../../../api/nodes';
import type { NodeColumnSelection, WorkspaceNodeLike } from '../../../../components/NodeSelectionPanel';
import { usePreprocessingPreview } from '../../hooks/usePreprocessingPreview';
import type { PreviewPagination, PreviewRow } from '../../types';
import { buildWorkspaceNodeMap, deriveNodeLabel } from '../../utils/nodeMetadata';

export interface SliceOperationResult {
  success?: boolean;
  message?: string;
  node_id?: string;
  data?: {
    node_name?: string;
    data_type?: string;
  };
}

export interface SliceSubTabProps {
  selectedNodeId: string | null;
  selectedNode: WorkspaceNodeLike | null;
  selectedNodes: WorkspaceNodeLike[];
  workspaceNodes: WorkspaceNodeLike[];
  sliceNode: (nodeId: string, request: SliceRequestPayload) => Promise<SliceOperationResult>;
  slicePreview: (
    nodeId: string,
    request: SliceRequestPayload,
    page: number,
    pageSize: number
  ) => Promise<FilterPreviewResponse>;
  isLoading: {
    operations: boolean;
  };
  onAlert: (message: string) => void;
}

interface SliceHistory {
  nodeId?: string;
  nodeName: string;
  offset: number;
  length?: number;
}

interface SliceSelectionPanelConfig {
  selectedNodes: WorkspaceNodeLike[];
  nodeColumnSelections: NodeColumnSelection[];
  nodeColors: Record<string, string>;
  defaultPalette: string[];
  disabled: boolean;
  originalCount: number;
  onColumnChange: () => void;
  onColorChange: () => void;
}

interface SliceFormControllers {
  offsetInput: string;
  setOffsetInput: (value: string) => void;
  lengthInput: string;
  setLengthInput: (value: string) => void;
  newNodeName: string;
  setNewNodeName: (value: string) => void;
}

interface SlicePreviewConfig {
  columns: string[];
  data: PreviewRow[];
  pagination: PreviewPagination | null;
  loading: boolean;
  error: string | null;
  ready: boolean;
  readyMessage: string;
  page: number;
  pageSize: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onPageSizeChange: (size: number) => void;
}

export interface UseSliceSubTabResult {
  selectionPanel: SliceSelectionPanelConfig;
  form: SliceFormControllers;
  summaries: {
    range: string;
    lastResult: string;
  };
  inlineError: string | null;
  hasSelection: boolean;
  isBusy: boolean;
  applyDisabled: boolean;
  applySlice: () => Promise<void>;
  preview: SlicePreviewConfig;
  showActivityTag: boolean;
}

const DEFAULT_PALETTE = ['#2563eb'];
const PREVIEW_DEBOUNCE_MS = 400;

const buildSlicePayload = (offset: number, lengthValue?: number): SliceRequestPayload => {
  const payload: SliceRequestPayload = { offset };
  if (typeof lengthValue === 'number') {
    payload.length = lengthValue;
  }
  return payload;
};

export const useSliceSubTab = (props: SliceSubTabProps): UseSliceSubTabResult => {
  const {
    selectedNodeId,
    selectedNode,
    selectedNodes,
    workspaceNodes,
    sliceNode,
    slicePreview,
    isLoading,
    onAlert,
  } = props;

  const [offsetInput, setOffsetInput] = useState('0');
  const [lengthInput, setLengthInput] = useState('');
  const [newNodeName, setNewNodeName] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [isSlicing, setIsSlicing] = useState(false);
  const [lastResult, setLastResult] = useState<SliceHistory | null>(null);

  const workspaceNodeMap = useMemo(() => buildWorkspaceNodeMap(workspaceNodes), [workspaceNodes]);

  const activeNode = useMemo<WorkspaceNodeLike | null>(() => {
    if (selectedNode) return selectedNode;
    if (!selectedNodeId) return null;
    return workspaceNodeMap.get(selectedNodeId) ?? null;
  }, [selectedNode, selectedNodeId, workspaceNodeMap]);

  const selectedNodeLabel = useMemo(() => {
    if (!selectedNodeId) return '';
    return deriveNodeLabel(activeNode) || selectedNodeId;
  }, [activeNode, selectedNodeId]);

  useEffect(() => {
    setInlineError(null);
  }, [offsetInput, lengthInput, selectedNodeId]);

  useEffect(() => {
    if (!selectedNodeId) {
      setOffsetInput('0');
      setLengthInput('');
      setNewNodeName('');
      setLastResult(null);
      return;
    }
    const baseName = selectedNodeLabel || selectedNodeId;
    setOffsetInput('0');
    setLengthInput('');
    setNewNodeName(`${baseName}_sliced`);
    setLastResult(null);
    setInlineError(null);
  }, [selectedNodeId, selectedNodeLabel]);

  const sliceSelectedNodesForPanel = useMemo<WorkspaceNodeLike[]>(() => (activeNode ? [activeNode] : []), [activeNode]);

  const sliceNodeSelections = useMemo<NodeColumnSelection[]>(() => (
    selectedNodeId ? [{ nodeId: selectedNodeId, column: '' }] : []
  ), [selectedNodeId]);

  const sliceNodeColors = useMemo(() => (
    selectedNodeId ? { [selectedNodeId]: DEFAULT_PALETTE[0] } : {}
  ), [selectedNodeId]);

  const hasSelection = Boolean(selectedNodeId);

  const trimmedOffset = offsetInput.trim();
  const offsetNumber = Number(trimmedOffset);
  const offsetValid = trimmedOffset.length > 0 && Number.isInteger(offsetNumber) && offsetNumber >= 0;

  const trimmedLength = lengthInput.trim();
  const lengthNumber = trimmedLength.length > 0 ? Number(trimmedLength) : null;
  const lengthValid =
    lengthNumber === null || (Number.isInteger(lengthNumber) && lengthNumber >= 0);
  const lengthValue = lengthNumber === null ? undefined : lengthNumber;

  const rangeSummary = useMemo(() => {
    if (!hasSelection) {
      return 'Select a node to configure slicing.';
    }
    if (!offsetValid) {
      return 'Offset must be a non-negative integer (zero-based row index).';
    }
    if (!lengthValid) {
      return 'Length must be a non-negative integer when provided.';
    }
    if (lengthValue === undefined) {
      return `Rows ${offsetNumber} → end of dataset.`;
    }
    if (lengthValue === 0) {
      return `Slice starting at row ${offsetNumber} returning zero rows (length = 0).`;
    }
    const endRow = offsetNumber + lengthValue - 1;
    return `Rows ${offsetNumber}–${endRow} inclusive (${lengthValue} total).`;
  }, [hasSelection, offsetNumber, offsetValid, lengthValid, lengthValue]);

  const lastResultSummary = useMemo(() => {
    if (!lastResult) {
      return 'Adjust parameters and add to workspace to create a sliced node.';
    }
    if (lastResult.length === undefined) {
      return `Last slice “${lastResult.nodeName}” (offset ${lastResult.offset} → end).`;
    }
    if (lastResult.length === 0) {
      return `Last slice “${lastResult.nodeName}” (offset ${lastResult.offset}, zero rows).`;
    }
    const endRow = lastResult.offset + lastResult.length - 1;
    return `Last slice “${lastResult.nodeName}” (rows ${lastResult.offset}–${endRow}).`;
  }, [lastResult]);

  const previewReady = hasSelection && offsetValid && lengthValid;

  interface SlicePreviewRequest {
    nodeId: string;
    payload: SliceRequestPayload;
  }

  const slicePreviewRequest = useMemo<SlicePreviewRequest | null>(() => {
    if (!previewReady || !selectedNodeId) {
      return null;
    }
    const payload = buildSlicePayload(offsetNumber, lengthValue);
    return {
      nodeId: selectedNodeId,
      payload,
    };
  }, [previewReady, selectedNodeId, offsetNumber, lengthValue]);

  const previewSignature = useMemo(() => {
    if (!slicePreviewRequest) return 'slice-preview-disabled';
    return `${slicePreviewRequest.nodeId}::${JSON.stringify(slicePreviewRequest.payload)}`;
  }, [slicePreviewRequest]);

  const previewFetcher = useCallback(async ({
    request,
    page,
    pageSize,
  }: {
    request: SlicePreviewRequest;
    page: number;
    pageSize: number;
  }) => {
    const response = await slicePreview(request.nodeId, request.payload, page, pageSize);
    return {
      data: Array.isArray(response?.data) ? (response.data as PreviewRow[]) : [],
      columns: Array.isArray(response?.columns) ? response.columns : [],
      pagination: (response?.pagination as PreviewPagination) ?? null,
    };
  }, [slicePreview]);

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
    request: slicePreviewRequest,
    signature: previewSignature,
    debounceMs: PREVIEW_DEBOUNCE_MS,
    fetcher: previewFetcher,
  });

  const currentPreviewPage = previewPagination?.page ?? previewPage;

  const handlePreviewPrev = useCallback(() => {
    if (previewPagination?.has_prev && !previewLoading) {
      setPreviewPage(Math.max(1, currentPreviewPage - 1));
    }
  }, [previewPagination, previewLoading, currentPreviewPage, setPreviewPage]);

  const handlePreviewNext = useCallback(() => {
    if (previewPagination?.has_next && !previewLoading) {
      setPreviewPage(currentPreviewPage + 1);
    }
  }, [previewPagination, previewLoading, currentPreviewPage, setPreviewPage]);

  const previewReadyMessage = !hasSelection
    ? 'Select a node to preview sliced rows.'
    : 'Enter a valid offset (and optional length) to see a preview.';

  const applyDisabled =
    !hasSelection || !offsetValid || !lengthValid || isSlicing || isLoading.operations;

  const applySlice = useCallback(async () => {
    if (!selectedNodeId) {
      setInlineError('Select a node to slice.');
      return;
    }
    if (!offsetValid) {
      setInlineError('Offset must be a non-negative integer.');
      return;
    }
    if (!lengthValid) {
      setInlineError('Length must be a non-negative integer when provided.');
      return;
    }

    const payload = buildSlicePayload(offsetNumber, lengthValue);
    const trimmedName = newNodeName.trim();
    if (trimmedName.length > 0) {
      payload.new_node_name = trimmedName;
    }

    setInlineError(null);
    setIsSlicing(true);
    try {
      const response = await sliceNode(selectedNodeId, payload);
      if (response?.success === false) {
        const message = response.message || 'Slice operation failed';
        setInlineError(message);
        onAlert(`Slice failed: ${message}`);
        return;
      }
      const responseName =
        response?.data?.node_name?.trim?.() ||
        payload.new_node_name ||
        `${selectedNodeLabel || selectedNodeId}_sliced`;
      const resultNodeId = response?.node_id;
      setLastResult({
        nodeId: resultNodeId ?? undefined,
        nodeName: responseName,
        offset: offsetNumber,
        length: lengthValue,
      });
      onAlert(`Slice created: ${responseName}${resultNodeId ? ` (${resultNodeId})` : ''}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Slice operation failed';
      setInlineError(message);
      onAlert(`Slice failed: ${message}`);
    } finally {
      setIsSlicing(false);
    }
  }, [lengthValid, lengthValue, newNodeName, offsetNumber, offsetValid, onAlert, selectedNodeId, selectedNodeLabel, sliceNode]);

  return {
    selectionPanel: {
      selectedNodes: sliceSelectedNodesForPanel,
      nodeColumnSelections: sliceNodeSelections,
      nodeColors: sliceNodeColors,
      defaultPalette: DEFAULT_PALETTE,
      disabled: sliceSelectedNodesForPanel.length === 0,
      originalCount: selectedNodes.length,
      onColumnChange: () => undefined,
      onColorChange: () => undefined,
    },
    form: {
      offsetInput,
      setOffsetInput,
      lengthInput,
      setLengthInput,
      newNodeName,
      setNewNodeName,
    },
    summaries: {
      range: rangeSummary,
      lastResult: lastResultSummary,
    },
    inlineError,
    hasSelection,
    isBusy: isSlicing,
    applyDisabled,
    applySlice,
    preview: {
      columns: previewColumns,
      data: previewData,
      pagination: previewPagination,
      loading: previewLoading,
      error: previewError,
      ready: previewReady,
      readyMessage: previewReadyMessage,
      page: currentPreviewPage,
      pageSize: previewPageSize,
      onPreviousPage: handlePreviewPrev,
      onNextPage: handlePreviewNext,
      onPageSizeChange: setPreviewPageSize,
    },
    showActivityTag: isSlicing || isLoading.operations,
  };
};
