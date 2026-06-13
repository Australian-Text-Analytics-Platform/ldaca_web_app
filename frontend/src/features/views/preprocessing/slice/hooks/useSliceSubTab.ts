import { useState } from 'react';
import { useForm, useStore } from '@tanstack/react-form';
import type {
  SliceRequest as SliceRequestPayload,
  FilterPreviewResponse,
} from '@/api/generated/types.gen';
import type {
  NodeColumnSelection,
  WorkspaceNodeLike,
} from '@/features/views/common/nodeSelectionTypes';
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
    pageSize: number,
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

interface ScopedInlineError {
  signature: string;
  message: string;
}

interface ScopedSliceHistory {
  signature: string;
  result: SliceHistory;
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

interface SliceFormValues {
  mode: SamplingMode;
  offsetInput: string;
  lengthInput: string;
  sampleSizeInput: string;
  randomSeedInput: string;
  noRandomSeed: boolean;
  newNodeName: string;
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
const DEFAULT_SLICE_FORM_VALUES: SliceFormValues = {
  mode: 'slice',
  offsetInput: '0',
  lengthInput: '',
  sampleSizeInput: '',
  randomSeedInput: DEFAULT_RANDOM_SEED,
  noRandomSeed: false,
  newNodeName: '',
};

/**
 * Serializes slice/random-sample form values into the backend request shape.
 * Preview and apply paths both use this helper to stay in sync.
 * Used by: local callers in preprocessing/useSliceSubTab module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 * Steps: branch between deterministic slice and random-sample modes, coerce numeric inputs, and
 * include seed/fraction only when relevant.
 */
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

/**
 * Owns Sample Rows tab state. `SliceSubTabContent` consumes this hook for form
 * controllers, preview fallback, validation messages, and apply behavior.
 * Used by: SliceSubTab module, useNodePreviewWithRawFallback hook (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 * Flow: derive active node and schema, manage slice/sample inputs, request preview fallback
 * data, build request payloads, and apply the generated node.
 */
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

  const sliceForm = useForm({ defaultValues: DEFAULT_SLICE_FORM_VALUES });
  const {
    mode,
    offsetInput,
    lengthInput,
    sampleSizeInput,
    randomSeedInput,
    noRandomSeed,
    newNodeName,
    // useSelector is not exported by the installed @tanstack/react-form version.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
  } = useStore(sliceForm.store, (state) => state.values);
  const [inlineErrorState, setInlineErrorState] = useState<ScopedInlineError | null>(null);
  const [isSlicing, setIsSlicing] = useState(false);
  const [lastResultState, setLastResultState] = useState<ScopedSliceHistory | null>(null);

  /**
   * Adapts the segmented mode control to the form store used by slice consumers.
   * Called by: useSliceSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const setMode = (value: SamplingMode) => { sliceForm.setFieldValue('mode', value); };
  /**
   * Updates the zero-based offset input for preview and apply payload construction.
   * Called by: useSliceSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const setOffsetInput = (value: string) => { sliceForm.setFieldValue('offsetInput', value); };
  /**
   * Updates the row-count input consumed by range validation and preview payloads.
   * Called by: useSliceSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const setLengthInput = (value: string) => { sliceForm.setFieldValue('lengthInput', value); };
  /**
   * Updates the sample-size input used by random sampling validation.
   * Called by: useSliceSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const setSampleSizeInput = (value: string) => { sliceForm.setFieldValue('sampleSizeInput', value); };
  /**
   * Updates the optional random seed field passed to sampling requests.
   * Called by: useSliceSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const setRandomSeedInput = (value: string) => { sliceForm.setFieldValue('randomSeedInput', value); };
  /**
   * Toggles seed omission so random samples can remain intentionally unseeded.
   * Called by: useSliceSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const setNoRandomSeed = (value: boolean) => { sliceForm.setFieldValue('noRandomSeed', value); };
  /**
   * Updates the optional node name consumed when adding the sampled node.
   * Called by: useSliceSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const setNewNodeName = (value: string) => { sliceForm.setFieldValue('newNodeName', value); };

  const workspaceNodeMap = buildWorkspaceNodeMap(workspaceNodes);

  const activeNode = (() => {
    if (selectedNode) return selectedNode;
    if (!selectedNodeId) return null;
    return workspaceNodeMap.get(selectedNodeId) ?? null;
  })();

  const selectedNodeLabel = (() => {
    if (!selectedNodeId) return '';
    return deriveNodeLabel(activeNode) || selectedNodeId;
  })();

  const nodeRowCount: number | null = (() => {
    const shape = activeNode?.shape;
    if (!Array.isArray(shape)) return null;
    const rows = shape[0];
    return typeof rows === 'number' && Number.isFinite(rows) && rows >= 0 ? Math.round(rows) : null;
  })();

  const sliceSelectedNodesForPanel = activeNode ? [activeNode] : [];

  const sliceNodeSelections: NodeColumnSelection[] = selectedNodeId
    ? [{ nodeId: selectedNodeId, column: '' }]
    : [];

  // SINGLE_NODE_PALETTE is a non-empty module constant, so index 0 exists.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const sliceNodeColors = selectedNodeId ? { [selectedNodeId]: SINGLE_NODE_PALETTE[0]! } : {};

  const hasSelection = Boolean(selectedNodeId);

  const trimmedOffset = offsetInput.trim();
  const offsetNumber = Number(trimmedOffset);
  const offsetValid =
    trimmedOffset.length > 0 && Number.isInteger(offsetNumber) && offsetNumber >= 0;

  const trimmedLength = lengthInput.trim();
  const lengthNumber = trimmedLength.length > 0 ? Number(trimmedLength) : null;
  const lengthValid = lengthNumber !== null && Number.isInteger(lengthNumber) && lengthNumber >= 1;
  const lengthValue = lengthNumber ?? undefined;

  const trimmedSampleSize = sampleSizeInput.trim();
  const sampleSizeNumber = trimmedSampleSize.length > 0 ? Number(trimmedSampleSize) : null;
  const sampleSizeValid =
    sampleSizeNumber !== null &&
    Number.isFinite(sampleSizeNumber) &&
    sampleSizeNumber > 0 &&
    (sampleSizeNumber < 1 || Number.isInteger(sampleSizeNumber));
  const sampleSizeValue = sampleSizeValid ? sampleSizeNumber : undefined;

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
      randomSeedNumber !== null &&
      Number.isInteger(randomSeedNumber) &&
      randomSeedNumber >= 0;
  const randomSeedValue = noRandomSeed
    ? undefined
    : randomSeedValid
      ? (randomSeedNumber ?? undefined)
      : undefined;

  const hasOperation =
    mode === 'slice' ? offsetValid && lengthValid : sampleSizeValid && randomSeedValid;

  const isFullShuffle =
    mode === 'random_sample' &&
    nodeRowCount !== null &&
    sampleSizeValid &&
    Number.isInteger(sampleSizeNumber) &&
    sampleSizeNumber >= nodeRowCount;

  const formSignature = [
    selectedNodeId ?? '',
    mode,
    offsetInput,
    lengthInput,
    sampleSizeInput,
    randomSeedInput,
    noRandomSeed ? 'no-random-seed' : 'seeded',
  ].join('\0');
  const resultSignature = [selectedNodeId ?? '', selectedNodeLabel, mode].join('\0');
  const inlineError =
    inlineErrorState?.signature === formSignature ? inlineErrorState.message : null;
  const lastResult = lastResultState?.signature === resultSignature ? lastResultState.result : null;
  /**
   * Scopes inline errors to the current form values so stale errors disappear.
   * Called by: useSliceSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const setCurrentInlineError = (message: string | null) => {
    setInlineErrorState(message ? { signature: formSignature, message } : null);
  };

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
        return `Slice starting at row ${String(offsetNumber)} returning zero rows (length = 0).`;
      }
      const endRow = offsetNumber + (lengthValue ?? 0) - 1;
      return `Rows ${String(offsetNumber)}–${String(endRow)} inclusive (${String(lengthValue)} total).`;
    }

    if (!sampleSizeValid) {
      return 'Enter a fraction (0–1) or an integer row count (≥ 1).';
    }
    if (!randomSeedValid) {
      return 'Random seed must be a non-negative integer.';
    }
    if (sampleSizeValue !== undefined && sampleSizeValue < 1) {
      if (randomSeedValue === undefined) {
        return `Random sample using fraction ${String(sampleSizeValue)}.`;
      }
      return `Random sample using fraction ${String(sampleSizeValue)} with seed ${String(randomSeedValue)}.`;
    }
    if (randomSeedValue === undefined) {
      return `Random sample of ${String(sampleSizeValue)} rows.`;
    }
    return `Random sample of ${String(sampleSizeValue)} rows with seed ${String(randomSeedValue)}.`;
  })();

  const lastResultSummary = (() => {
    if (!lastResult) {
      return 'Adjust parameters and add to workspace to create a sampled data block.';
    }
    if (lastResult.mode === 'random_sample') {
      const sizeLabel =
        lastResult.sampleSize !== undefined && lastResult.sampleSize < 1
          ? `fraction ${String(lastResult.sampleSize)}`
          : `n=${String(lastResult.sampleSize)}`;
      if (lastResult.randomSeed === undefined) {
        return `Last random sample "${lastResult.nodeName}" (${sizeLabel}).`;
      }
      return `Last random sample "${lastResult.nodeName}" (${sizeLabel}, seed ${String(lastResult.randomSeed)}).`;
    }
    const lastOffset = lastResult.offset ?? 0;
    if (lastResult.length === undefined) {
      return `Last slice “${lastResult.nodeName}” (offset ${String(lastOffset)} → end).`;
    }
    if (lastResult.length === 0) {
      return `Last slice “${lastResult.nodeName}” (offset ${String(lastOffset)}, zero rows).`;
    }
    const endRow = lastOffset + lastResult.length - 1;
    return `Last slice “${lastResult.nodeName}” (rows ${String(lastOffset)}–${String(endRow)}).`;
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

  /**
   * Clamps slice length after editing so preview/apply receives a valid range.
   * Called by: useSliceSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleLengthBlur = () => {
    if (trimmedLength.length === 0) return;
    if (lengthNumber === null || !Number.isInteger(lengthNumber)) return;
    if (lengthNumber < 1) {
      sliceForm.setFieldValue('lengthInput', '1');
    } else if (nodeRowCount !== null && lengthNumber > nodeRowCount) {
      sliceForm.setFieldValue('lengthInput', String(nodeRowCount));
    }
  };

  /**
   * Clamps absolute sample size to row count when the source shape is known.
   * Called by: useSliceSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleSampleSizeBlur = () => {
    if (trimmedSampleSize.length === 0 || !sampleSizeValid) return;
    if (
      nodeRowCount !== null &&
      Number.isInteger(sampleSizeNumber) &&
      sampleSizeNumber >= nodeRowCount
    ) {
      sliceForm.setFieldValue('sampleSizeInput', String(nodeRowCount));
    }
  };

  const applyDisabled = !hasSelection || !hasOperation || isSlicing || isLoading.operations;

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

  /**
   * Validates and applies the current slice/sample as a new workspace node.
   * Called by: useSliceSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: build the payload, call the slice operation, refresh schema, update applied
   * snapshot state, and surface success/failure through alerts.
   */
  const applySlice = async () => {
    if (!selectedNodeId) {
      setCurrentInlineError('Select a data block to sample.');
      return;
    }
    if (mode === 'slice') {
      if (!offsetValid) {
        setCurrentInlineError('Offset must be a non-negative integer.');
        return;
      }
      if (!lengthValid) {
        setCurrentInlineError('Length is required – enter a non-negative integer.');
        return;
      }
    } else {
      if (!sampleSizeValid) {
        setCurrentInlineError('Enter a fraction (0–1) or an integer row count (≥ 1).');
        return;
      }
      if (!randomSeedValid) {
        setCurrentInlineError('Random seed must be a non-negative integer.');
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

    setCurrentInlineError(null);
    setIsSlicing(true);
    try {
      const response = await sliceNode(selectedNodeId, payload);
      const operationLabel =
        mode === 'slice' ? 'Slice' : isFullShuffle ? 'Shuffle' : 'Random sample';
      if (response.success === false) {
        // Empty API messages should fall back to a default label, so keep `||`.
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        const message = response.message || `${operationLabel} operation failed`;
        setCurrentInlineError(message);
        onAlert(`${operationLabel} failed: ${message}`);
        return;
      }
      // Empty API name values should fall through to the next candidate, so keep `||`.
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
      const responseName =
        response.node_name?.trim() ||
        response.data?.node_name?.trim() ||
        requestedName ||
        `${selectedNodeLabel || selectedNodeId}_${mode === 'slice' ? 'sliced' : isFullShuffle ? 'shuffled' : 'sampled'}`;
      /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
      const resultNodeId = response.node_id;
      setLastResultState({
        signature: resultSignature,
        result: {
          nodeId: resultNodeId ?? undefined,
          nodeName: responseName,
          mode,
          offset: mode === 'slice' ? offsetNumber : undefined,
          length: mode === 'slice' ? lengthValue : undefined,
          sampleSize: mode === 'random_sample' ? sampleSizeValue : undefined,
          randomSeed: mode === 'random_sample' ? randomSeedValue : undefined,
        },
      });
      onAlert(
        `${operationLabel} created: ${responseName}${resultNodeId ? ` (${resultNodeId})` : ''}.`,
      );
    } catch (error) {
      const operationLabel = mode === 'slice' ? 'Slice' : 'Random sample';
      const message = error instanceof Error ? error.message : `${operationLabel} operation failed`;
      setCurrentInlineError(message);
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
      /**
       * Satisfies the shared panel API; slice mode never edits source columns.
       * Consumed by: useSliceSubTab return object for feature components because consumers need this returned value or action without owning the hook internals.
       */
      onColumnChange: () => undefined,
      /**
       * Satisfies the shared panel API; slice mode uses a fixed single-node color.
       * Consumed by: useSliceSubTab return object for feature components because consumers need this returned value or action without owning the hook internals.
       */
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
