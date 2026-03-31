import { useEffect, useState } from 'react';
import { nodesApi, type SliceRequest as SliceRequestPayload, type FilterPreviewResponse } from '../../../../api/nodes';
import type { NodeColumnSelection, WorkspaceNodeLike } from '../../../../components/NodeSelectionPanel';
import { usePreprocessingPreview } from '../../hooks/usePreprocessingPreview';
import type { PreviewPagination, PreviewRow } from '../../types';
import { buildWorkspaceNodeMap, deriveNodeLabel } from '../../utils/nodeMetadata';

export interface SliceOperationResult {
  success?: boolean;
  message?: string;
  node_id?: string;
  node_name?: string;
  data?: {
    node_name?: string;
    data_type?: string;
  };
}

export type SamplingMode = 'slice' | 'random_sample';

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
  mode: SamplingMode;
  offset?: number;
  length?: number;
  fraction?: number;
  randomSeed?: number;
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
  mode: SamplingMode;
  setMode: (value: SamplingMode) => void;
  offsetInput: string;
  setOffsetInput: (value: string) => void;
  lengthInput: string;
  setLengthInput: (value: string) => void;
  fractionInput: string;
  setFractionInput: (value: string) => void;
  randomSeedInput: string;
  setRandomSeedInput: (value: string) => void;
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

const buildSlicePayload = ({
  mode,
  offset,
  lengthValue,
  fractionValue,
  randomSeedValue,
}: {
  mode: SamplingMode;
  offset: number;
  lengthValue?: number;
  fractionValue?: number;
  randomSeedValue?: number;
}): SliceRequestPayload => {
  const payload: SliceRequestPayload = { mode };
  if (mode === 'random_sample') {
    if (typeof fractionValue === 'number') {
      payload.fraction = fractionValue;
    }
    if (typeof randomSeedValue === 'number') {
      payload.random_seed = randomSeedValue;
    }
    return payload;
  }
  payload.offset = offset;
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

  const [mode, setMode] = useState<SamplingMode>('slice');
  const [offsetInput, setOffsetInput] = useState('0');
  const [lengthInput, setLengthInput] = useState('');
  const [fractionInput, setFractionInput] = useState('');
  const [randomSeedInput, setRandomSeedInput] = useState('');
  const [newNodeName, setNewNodeName] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [isSlicing, setIsSlicing] = useState(false);
  const [lastResult, setLastResult] = useState<SliceHistory | null>(null);

  const workspaceNodeMap = buildWorkspaceNodeMap(workspaceNodes);

  const activeNode = (() => {
    if (selectedNode) return selectedNode;
    if (!selectedNodeId) return null;
    return workspaceNodeMap.get(selectedNodeId) ?? null;
  })() as WorkspaceNodeLike | null;

  const selectedNodeLabel = (() => {
    if (!selectedNodeId) return '';
    return deriveNodeLabel(activeNode) || selectedNodeId;
  })();

  useEffect(() => {
    setInlineError(null);
  }, [mode, offsetInput, lengthInput, fractionInput, randomSeedInput, selectedNodeId]);

  useEffect(() => {
    if (!selectedNodeId) {
      setMode('slice');
      setOffsetInput('0');
      setLengthInput('');
      setFractionInput('');
      setRandomSeedInput('');
      setNewNodeName('');
      setLastResult(null);
      return;
    }
    const baseName = selectedNodeLabel || selectedNodeId;
    setMode('slice');
    setOffsetInput('0');
    setLengthInput('');
    setFractionInput('');
    setRandomSeedInput('');
    setNewNodeName(`${baseName}_sliced`);
    setLastResult(null);
    setInlineError(null);
  }, [selectedNodeId, selectedNodeLabel]);

  useEffect(() => {
    if (!selectedNodeId) {
      return;
    }
    const baseName = selectedNodeLabel || selectedNodeId;
    setNewNodeName(mode === 'slice' ? `${baseName}_sliced` : `${baseName}_sampled`);
    setLastResult(null);
    setInlineError(null);
  }, [mode, selectedNodeId, selectedNodeLabel]);

  const sliceSelectedNodesForPanel = activeNode ? [activeNode] : [];

  const sliceNodeSelections: NodeColumnSelection[] = selectedNodeId ? [{ nodeId: selectedNodeId, column: '' }] : [];

  const sliceNodeColors = selectedNodeId ? { [selectedNodeId]: DEFAULT_PALETTE[0] } : {};

  const hasSelection = Boolean(selectedNodeId);

  const trimmedOffset = offsetInput.trim();
  const offsetNumber = Number(trimmedOffset);
  const offsetValid = trimmedOffset.length > 0 && Number.isInteger(offsetNumber) && offsetNumber >= 0;

  const trimmedLength = lengthInput.trim();
  const lengthNumber = trimmedLength.length > 0 ? Number(trimmedLength) : null;
  const lengthValid =
    lengthNumber !== null && Number.isInteger(lengthNumber) && lengthNumber >= 0;
  const lengthValue = lengthNumber === null ? undefined : lengthNumber;

  const trimmedFraction = fractionInput.trim();
  const fractionNumber = trimmedFraction.length > 0 ? Number(trimmedFraction) : null;
  const fractionValid =
    fractionNumber !== null && Number.isFinite(fractionNumber) && fractionNumber > 0 && fractionNumber <= 1;
  const fractionValue = fractionValid ? fractionNumber ?? undefined : undefined;

  const trimmedRandomSeed = randomSeedInput.trim();
  const randomSeedNumber = trimmedRandomSeed.length > 0 ? Number(trimmedRandomSeed) : null;
  const randomSeedValid =
    trimmedRandomSeed.length === 0 ||
    (randomSeedNumber !== null && Number.isInteger(randomSeedNumber) && randomSeedNumber >= 0);
  const randomSeedValue = trimmedRandomSeed.length === 0 ? undefined : randomSeedValid ? randomSeedNumber ?? undefined : undefined;

  const hasOperation = mode === 'slice' ? offsetValid && lengthValid : fractionValid && randomSeedValid;

  const rangeSummary = (() => {
    if (!hasSelection) {
      return 'Select a data block to configure sampling.';
    }
    if (mode === 'slice') {
      if (!offsetValid) {
        return 'Offset must be a non-negative integer (zero-based row index).';
      }
      if (!lengthValid) {
        return 'Length is required – enter the number of rows to include in the slice.';
      }
      if (lengthValue === 0) {
        return `Slice starting at row ${offsetNumber} returning zero rows (length = 0).`;
      }
      const endRow = offsetNumber + (lengthValue ?? 0) - 1;
      return `Rows ${offsetNumber}–${endRow} inclusive (${lengthValue} total).`;
    }

    if (!fractionValid) {
      return 'Fraction is required – enter a value greater than 0 and at most 1.';
    }
    if (!randomSeedValid) {
      return 'Random seed must be a non-negative integer.';
    }
    if (randomSeedValue === undefined) {
      return `Random sample using fraction ${fractionValue}.`;
    }
    return `Random sample using fraction ${fractionValue} with seed ${randomSeedValue}.`;
  })();

  const lastResultSummary = (() => {
    if (!lastResult) {
      return 'Adjust parameters and add to workspace to create a sampled data block.';
    }
    if (lastResult.mode === 'random_sample') {
      if (lastResult.randomSeed === undefined) {
        return `Last random sample “${lastResult.nodeName}” (fraction ${lastResult.fraction}).`;
      }
      return `Last random sample “${lastResult.nodeName}” (fraction ${lastResult.fraction}, seed ${lastResult.randomSeed}).`;
    }
    const lastOffset = lastResult.offset ?? 0;
    if (lastResult.length === undefined) {
      return `Last slice “${lastResult.nodeName}” (offset ${lastOffset} → end).`;
    }
    if (lastResult.length === 0) {
      return `Last slice “${lastResult.nodeName}” (offset ${lastOffset}, zero rows).`;
    }
    const endRow = lastOffset + lastResult.length - 1;
    return `Last slice “${lastResult.nodeName}” (rows ${lastOffset}–${endRow}).`;
  })();

  const previewReady = hasSelection && (mode === 'slice' ? offsetValid : true);

  interface SlicePreviewRequest {
    nodeId: string;
    payload: SliceRequestPayload | null;
  }

  const slicePreviewRequest: SlicePreviewRequest | null = (() => {
    if (!previewReady || !selectedNodeId) {
      return null;
    }
    if (!hasOperation) {
      return { nodeId: selectedNodeId, payload: null };
    }
    const payload = buildSlicePayload({
      mode,
      offset: offsetNumber,
      lengthValue,
      fractionValue,
      randomSeedValue,
    });
    return {
      nodeId: selectedNodeId,
      payload,
    };
  })();

  const previewSignature = (() => {
    if (!slicePreviewRequest) return 'slice-preview-disabled';
    if (!slicePreviewRequest.payload) return `${slicePreviewRequest.nodeId}::raw`;
    return `${slicePreviewRequest.nodeId}::${JSON.stringify(slicePreviewRequest.payload)}`;
  })();

  const previewFetcher = async ({
    request,
    page,
    pageSize,
  }: {
    request: SlicePreviewRequest;
    page: number;
    pageSize: number;
  }) => {
    if (request.payload) {
      const response = await slicePreview(request.nodeId, request.payload, page, pageSize);
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
    request: slicePreviewRequest,
    signature: previewSignature,
    debounceMs: PREVIEW_DEBOUNCE_MS,
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

  const previewReadyMessage = !hasSelection
    ? 'Select a data block to preview output rows.'
    : mode === 'slice'
      ? 'Showing original data. Enter offset and length to preview sliced rows.'
      : 'Showing original data. Enter fraction and optional seed to preview sampled rows.';

  const applyDisabled =
    !hasSelection || !hasOperation || isSlicing || isLoading.operations;

  const applySlice = async () => {
    if (!selectedNodeId) {
      setInlineError('Select a data block to sample.');
      return;
    }
    if (mode === 'slice') {
      if (!offsetValid) {
        setInlineError('Offset must be a non-negative integer.');
        return;
      }
      if (!lengthValid) {
        setInlineError('Length is required – enter a non-negative integer.');
        return;
      }
    } else {
      if (!fractionValid) {
        setInlineError('Fraction is required – enter a value greater than 0 and at most 1.');
        return;
      }
      if (!randomSeedValid) {
        setInlineError('Random seed must be a non-negative integer.');
        return;
      }
    }

    const payload = buildSlicePayload({
      mode,
      offset: offsetNumber,
      lengthValue,
      fractionValue,
      randomSeedValue,
    });
    const trimmedName = newNodeName.trim();
    if (trimmedName.length > 0) {
      payload.new_node_name = trimmedName;
    }

    setInlineError(null);
    setIsSlicing(true);
    try {
      const response = await sliceNode(selectedNodeId, payload);
      const operationLabel = mode === 'slice' ? 'Slice' : 'Random sample';
      if (response?.success === false) {
        const message = response.message || `${operationLabel} operation failed`;
        setInlineError(message);
        onAlert(`${operationLabel} failed: ${message}`);
        return;
      }
      const responseName =
        response?.node_name?.trim?.() ||
        response?.data?.node_name?.trim?.() ||
        payload.new_node_name ||
        `${selectedNodeLabel || selectedNodeId}_${mode === 'slice' ? 'sliced' : 'sampled'}`;
      const resultNodeId = response?.node_id;
      setLastResult({
        nodeId: resultNodeId ?? undefined,
        nodeName: responseName,
        mode,
        offset: mode === 'slice' ? offsetNumber : undefined,
        length: mode === 'slice' ? lengthValue : undefined,
        fraction: mode === 'random_sample' ? fractionValue : undefined,
        randomSeed: mode === 'random_sample' ? randomSeedValue : undefined,
      });
      onAlert(`${operationLabel} created: ${responseName}${resultNodeId ? ` (${resultNodeId})` : ''}.`);
    } catch (error) {
      const operationLabel = mode === 'slice' ? 'Slice' : 'Random sample';
      const message = error instanceof Error ? error.message : `${operationLabel} operation failed`;
      setInlineError(message);
      onAlert(`${operationLabel} failed: ${message}`);
    } finally {
      setIsSlicing(false);
    }
  };

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
      mode,
      setMode,
      offsetInput,
      setOffsetInput,
      lengthInput,
      setLengthInput,
      fractionInput,
      setFractionInput,
      randomSeedInput,
      setRandomSeedInput,
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
