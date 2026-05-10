import { useEffect, useState } from 'react';
import { type SliceRequest as SliceRequestPayload, type FilterPreviewResponse } from '@/api/nodes';
import type { NodeColumnSelection, WorkspaceNodeLike } from '@/features/analysis/common/components/NodeSelectionPanel';
import type { PreviewPagination, PreviewRow } from '../../types';
import { useNodePreviewWithRawFallback } from '../../hooks/useNodePreviewWithRawFallback';
import { buildSamplingAutoNodeName } from '../../utils/autoNodeNames';
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
  sampleSize?: number;
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
  onLengthBlur: () => void;
  sampleSizeInput: string;
  setSampleSizeInput: (value: string) => void;
  onSampleSizeBlur: () => void;
  sampleSizeHint: string | null;
  randomSeedInput: string;
  setRandomSeedInput: (value: string) => void;
  noRandomSeed: boolean;
  setNoRandomSeed: (value: boolean) => void;
  newNodeName: string;
  setNewNodeName: (value: string) => void;
  newNodeNamePlaceholder: string;
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
  onPageChange: (page: number) => void;
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
  applyDisabledReason: string | undefined;
  applySlice: () => Promise<void>;
  preview: SlicePreviewConfig;
  showActivityTag: boolean;
}

const SINGLE_NODE_PALETTE = ['#2563eb'];
const PREVIEW_DEBOUNCE_MS = 400;
const DEFAULT_RANDOM_SEED = '42';

const buildSlicePayload = ({
  mode,
  offset,
  lengthValue,
  sampleSizeValue,
  randomSeedValue,
  isFullShuffle,
}: {
  mode: SamplingMode;
  offset: number;
  lengthValue?: number;
  sampleSizeValue?: number;
  randomSeedValue?: number;
  isFullShuffle?: boolean;
}): SliceRequestPayload => {
  if (mode === 'random_sample') {
    if (isFullShuffle) {
      const payload: SliceRequestPayload = { mode: 'shuffle' };
      if (typeof randomSeedValue === 'number') {
        payload.random_seed = randomSeedValue;
      }
      return payload;
    }
    const payload: SliceRequestPayload = { mode };
    if (typeof sampleSizeValue === 'number') {
      payload.sample_size = sampleSizeValue;
    }
    if (typeof randomSeedValue === 'number') {
      payload.random_seed = randomSeedValue;
    }
    return payload;
  }
  const payload: SliceRequestPayload = { mode };
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
  const [sampleSizeInput, setSampleSizeInput] = useState('');
  const [randomSeedInput, setRandomSeedInput] = useState(DEFAULT_RANDOM_SEED);
  const [noRandomSeed, setNoRandomSeed] = useState(false);
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

  const nodeRowCount: number | null = (() => {
    const shape = activeNode?.shape as [number | null, number | null] | number[] | undefined;
    if (!Array.isArray(shape)) return null;
    const rows = shape[0];
    return typeof rows === 'number' && Number.isFinite(rows) && rows >= 0 ? Math.round(rows) : null;
  })();

  useEffect(() => {
    setInlineError(null);
  }, [mode, offsetInput, lengthInput, sampleSizeInput, randomSeedInput, noRandomSeed, selectedNodeId]);

  useEffect(() => {
    setMode('slice');
    setOffsetInput('0');
    setLengthInput('');
    setSampleSizeInput('');
    setRandomSeedInput(DEFAULT_RANDOM_SEED);
    setNoRandomSeed(false);
    setNewNodeName('');
    setLastResult(null);
    setInlineError(null);
  }, [selectedNodeId, selectedNodeLabel]);

  useEffect(() => {
    if (!selectedNodeId) {
      return;
    }
    setLastResult(null);
    setInlineError(null);
  }, [mode, selectedNodeId, selectedNodeLabel]);

  const sliceSelectedNodesForPanel = activeNode ? [activeNode] : [];

  const sliceNodeSelections: NodeColumnSelection[] = selectedNodeId ? [{ nodeId: selectedNodeId, column: '' }] : [];

  const sliceNodeColors = selectedNodeId ? { [selectedNodeId]: SINGLE_NODE_PALETTE[0]! } : {};

  const hasSelection = Boolean(selectedNodeId);

  const trimmedOffset = offsetInput.trim();
  const offsetNumber = Number(trimmedOffset);
  const offsetValid = trimmedOffset.length > 0 && Number.isInteger(offsetNumber) && offsetNumber >= 0;

  const trimmedLength = lengthInput.trim();
  const lengthNumber = trimmedLength.length > 0 ? Number(trimmedLength) : null;
  const lengthValid =
    lengthNumber !== null && Number.isInteger(lengthNumber) && lengthNumber >= 1;
  const lengthValue = lengthNumber === null ? undefined : lengthNumber;

  const trimmedSampleSize = sampleSizeInput.trim();
  const sampleSizeNumber = trimmedSampleSize.length > 0 ? Number(trimmedSampleSize) : null;
  const sampleSizeValid =
    sampleSizeNumber !== null &&
    Number.isFinite(sampleSizeNumber) &&
    sampleSizeNumber > 0 &&
    (sampleSizeNumber < 1 || Number.isInteger(sampleSizeNumber));
  const sampleSizeValue = sampleSizeValid ? sampleSizeNumber ?? undefined : undefined;

  const sampleSizeHint: string | null = (() => {
    if (trimmedSampleSize.length === 0 || sampleSizeValid) return null;
    if (sampleSizeNumber !== null && sampleSizeNumber >= 1 && !Number.isInteger(sampleSizeNumber)) {
      return 'Values ≥ 1 must be whole numbers (e.g. 25, not 25.5).';
    }
    return 'Enter a fraction (0–1) or an integer row count (≥ 1).';
  })();

  const trimmedRandomSeed = randomSeedInput.trim();
  const randomSeedNumber = trimmedRandomSeed.length > 0 ? Number(trimmedRandomSeed) : null;
  const randomSeedValid = noRandomSeed
    ? true
    : trimmedRandomSeed.length > 0 &&
      randomSeedNumber !== null && Number.isInteger(randomSeedNumber) && randomSeedNumber >= 0;
  const randomSeedValue = noRandomSeed ? undefined : (randomSeedValid ? randomSeedNumber ?? undefined : undefined);

  const hasOperation = mode === 'slice' ? offsetValid && lengthValid : sampleSizeValid && randomSeedValid;

  const isFullShuffle =
    mode === 'random_sample' &&
    nodeRowCount !== null &&
    sampleSizeValid &&
    sampleSizeNumber !== null &&
    Number.isInteger(sampleSizeNumber) &&
    sampleSizeNumber >= nodeRowCount;

  const autoNodeName = buildSamplingAutoNodeName({
    baseName: selectedNodeLabel || selectedNodeId,
    mode,
    offset: offsetValid ? offsetNumber : undefined,
    length: lengthValid ? lengthValue : undefined,
    sampleSize: sampleSizeValid ? sampleSizeValue : undefined,
    randomSeed: randomSeedValid ? randomSeedValue : undefined,
    noRandomSeed,
    isFullShuffle,
  });

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

    if (!sampleSizeValid) {
      return 'Enter a fraction (0–1) or an integer row count (≥ 1).';
    }
    if (!randomSeedValid) {
      return 'Random seed must be a non-negative integer.';
    }
    if (sampleSizeValue !== undefined && sampleSizeValue < 1) {
      if (randomSeedValue === undefined) {
        return `Random sample using fraction ${sampleSizeValue}.`;
      }
      return `Random sample using fraction ${sampleSizeValue} with seed ${randomSeedValue}.`;
    }
    if (randomSeedValue === undefined) {
      return `Random sample of ${sampleSizeValue} rows.`;
    }
    return `Random sample of ${sampleSizeValue} rows with seed ${randomSeedValue}.`;
  })();

  const lastResultSummary = (() => {
    if (!lastResult) {
      return 'Adjust parameters and add to workspace to create a sampled data block.';
    }
    if (lastResult.mode === 'random_sample') {
      const sizeLabel = lastResult.sampleSize !== undefined && lastResult.sampleSize < 1
        ? `fraction ${lastResult.sampleSize}`
        : `n=${lastResult.sampleSize}`;
      if (lastResult.randomSeed === undefined) {
        return `Last random sample "${lastResult.nodeName}" (${sizeLabel}).`;
      }
      return `Last random sample "${lastResult.nodeName}" (${sizeLabel}, seed ${lastResult.randomSeed}).`;
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

  const operationPayload: SliceRequestPayload | null = hasOperation
    ? buildSlicePayload({
        mode,
        offset: offsetNumber,
        lengthValue,
        sampleSizeValue,
        randomSeedValue,
        isFullShuffle,
      })
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
  } = useNodePreviewWithRawFallback<SliceRequestPayload>({
    nodeId: selectedNodeId,
    operationPayload,
    operationFetch: slicePreview,
    signaturePrefix: 'slice',
    enabled: previewReady,
    debounceMs: PREVIEW_DEBOUNCE_MS,
  });

  const currentPreviewPage = previewPagination?.page ?? previewPage;

  const previewReadyMessage = !hasSelection
    ? 'Select a data block to preview output rows.'
    : mode === 'slice'
      ? 'Showing original data. Enter offset and length to preview sliced rows.'
      : 'Showing original data. Enter a fraction or row count and optional seed to preview sampled rows.';

  const handleLengthBlur = () => {
    if (trimmedLength.length === 0) return;
    if (lengthNumber === null || !Number.isInteger(lengthNumber)) return;
    if (lengthNumber < 1) {
      setLengthInput('1');
    } else if (nodeRowCount !== null && lengthNumber > nodeRowCount) {
      setLengthInput(String(nodeRowCount));
    }
  };

  const handleSampleSizeBlur = () => {
    if (trimmedSampleSize.length === 0 || !sampleSizeValid) return;
    if (
      nodeRowCount !== null &&
      sampleSizeNumber !== null &&
      Number.isInteger(sampleSizeNumber) &&
      sampleSizeNumber >= nodeRowCount
    ) {
      setSampleSizeInput(String(nodeRowCount));
    }
  };

  const applyDisabled =
    !hasSelection || !hasOperation || isSlicing || isLoading.operations;

  const applyDisabledReason: string | undefined = (() => {
    if (isSlicing || isLoading.operations) return undefined;
    if (!hasSelection) return 'Select a data block first';
    if (mode === 'slice') {
      if (!lengthValid) {
        return trimmedLength.length === 0
          ? 'Enter a length (number of rows to include)'
          : 'Length must be a whole number ≥ 1';
      }
    } else {
      if (!sampleSizeValid) {
        return trimmedSampleSize.length === 0
          ? 'Enter a sample size'
          : 'Enter a valid sample size — a fraction (0–1) or a whole number ≥ 1';
      }
      if (!randomSeedValid) return 'Enter a valid random seed (non-negative integer)';
    }
    return undefined;
  })();

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
      if (!sampleSizeValid) {
        setInlineError('Enter a fraction (0–1) or an integer row count (≥ 1).');
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
      sampleSizeValue,
      randomSeedValue,
      isFullShuffle,
    });
    const requestedName = newNodeName.trim() || autoNodeName;
    if (requestedName) {
      payload.new_node_name = requestedName;
    }

    setInlineError(null);
    setIsSlicing(true);
    try {
      const response = await sliceNode(selectedNodeId, payload);
      const operationLabel = mode === 'slice' ? 'Slice' : isFullShuffle ? 'Shuffle' : 'Random sample';
      if (response?.success === false) {
        const message = response.message || `${operationLabel} operation failed`;
        setInlineError(message);
        onAlert(`${operationLabel} failed: ${message}`);
        return;
      }
      const responseName =
        response?.node_name?.trim?.() ||
        response?.data?.node_name?.trim?.() ||
        requestedName ||
        `${selectedNodeLabel || selectedNodeId}_${mode === 'slice' ? 'sliced' : isFullShuffle ? 'shuffled' : 'sampled'}`;
      const resultNodeId = response?.node_id;
      setLastResult({
        nodeId: resultNodeId ?? undefined,
        nodeName: responseName,
        mode,
        offset: mode === 'slice' ? offsetNumber : undefined,
        length: mode === 'slice' ? lengthValue : undefined,
        sampleSize: mode === 'random_sample' ? sampleSizeValue : undefined,
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
      defaultPalette: SINGLE_NODE_PALETTE,
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
      onLengthBlur: handleLengthBlur,
      sampleSizeInput,
      setSampleSizeInput,
      onSampleSizeBlur: handleSampleSizeBlur,
      sampleSizeHint,
      randomSeedInput,
      setRandomSeedInput,
      noRandomSeed,
      setNoRandomSeed,
      newNodeName,
      setNewNodeName,
      newNodeNamePlaceholder: autoNodeName,
    },
    summaries: {
      range: rangeSummary,
      lastResult: lastResultSummary,
    },
    inlineError,
    hasSelection,
    isBusy: isSlicing,
    applyDisabled,
    applyDisabledReason,
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
      onPageChange: setPreviewPage,
      onPageSizeChange: setPreviewPageSize,
    },
    showActivityTag: isSlicing || isLoading.operations,
  };
};
