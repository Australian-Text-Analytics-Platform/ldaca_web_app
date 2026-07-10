import { useState } from 'react';
import type { SliceRequest as SliceRequestPayload } from '@/api';
import type {
  NodeColumnSelection,
  WorkspaceNodeLike,
} from '@/features/views/common/nodeSelectionTypes';
import type { PreviewPagination, PreviewRow } from '../../types';
import {
  useNodePreviewWithRawFallback,
  type OperationPreviewFetcher,
} from '../../hooks/useNodePreviewWithRawFallback';
import {
  buildSingleNodeSelectionPanelModel,
  deriveNodeLabel,
} from '../../utils/nodeMetadata';
import { buildSlicePayload, deriveSliceFormModel, type SamplingMode } from './sliceFormModel';

interface SliceOperationResult {
  success?: boolean;
  message?: string;
  node_id?: string;
  node_name?: string;
  data?: {
    node_name?: string;
    data_type?: string;
  };
}

export interface SliceSubTabProps {
  currentWorkspaceId: string | null;
  selectedNodeId: string | null;
  selectedNode: WorkspaceNodeLike | null;
  selectedNodes: WorkspaceNodeLike[];
  sliceNode: (nodeId: string, request: SliceRequestPayload) => Promise<SliceOperationResult>;
  slicePreview: OperationPreviewFetcher<SliceRequestPayload>;
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
 * Owns Sample Rows tab state. `SliceSubTabContent` consumes this hook for form
 * controllers, preview fallback, validation messages, and apply behavior.
 * Used by: SliceSubTab module, useNodePreviewWithRawFallback hook (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 * Flow: derive active node and schema, manage slice/sample inputs, request preview fallback
 * data, build request payloads, and apply the generated node.
 */
export const useSliceSubTab = (props: SliceSubTabProps): UseSliceSubTabResult => {
  const {
    currentWorkspaceId,
    selectedNodeId,
    selectedNode,
    selectedNodes,
    sliceNode,
    slicePreview,
    isLoading,
    onAlert,
  } = props;

  const [formValues, setFormValues] = useState<SliceFormValues>(() => ({
    ...DEFAULT_SLICE_FORM_VALUES,
  }));
  const {
    mode,
    offsetInput,
    lengthInput,
    sampleSizeInput,
    randomSeedInput,
    noRandomSeed,
    newNodeName,
  } = formValues;
  const [inlineErrorState, setInlineErrorState] = useState<ScopedInlineError | null>(null);
  const [isSlicing, setIsSlicing] = useState(false);
  const [lastResultState, setLastResultState] = useState<ScopedSliceHistory | null>(null);

  /**
   * Updates the local Sample Rows form without pulling in a form library for
   * simple string/boolean fields.
   * Called by: useSliceSubTab field controllers and blur handlers because the
   * hook owns the form state consumed by preview and apply payloads.
   */
  const setFormField = <Field extends keyof SliceFormValues>(
    field: Field,
    value: SliceFormValues[Field],
  ) => {
    setFormValues((current) =>
      Object.is(current[field], value) ? current : { ...current, [field]: value },
    );
  };

  /**
   * Adapts the segmented mode control to the local form state used by slice consumers.
   * Called by: useSliceSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const setMode = (value: SamplingMode) => {
    setFormField('mode', value);
  };
  /**
   * Updates the zero-based offset input for preview and apply payload construction.
   * Called by: useSliceSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const setOffsetInput = (value: string) => {
    setFormField('offsetInput', value);
  };
  /**
   * Updates the row-count input consumed by range validation and preview payloads.
   * Called by: useSliceSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const setLengthInput = (value: string) => {
    setFormField('lengthInput', value);
  };
  /**
   * Updates the sample-size input used by random sampling validation.
   * Called by: useSliceSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const setSampleSizeInput = (value: string) => {
    setFormField('sampleSizeInput', value);
  };
  /**
   * Updates the optional random seed field passed to sampling requests.
   * Called by: useSliceSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const setRandomSeedInput = (value: string) => {
    setFormField('randomSeedInput', value);
  };
  /**
   * Toggles seed omission so random samples can remain intentionally unseeded.
   * Called by: useSliceSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const setNoRandomSeed = (value: boolean) => {
    setFormField('noRandomSeed', value);
  };
  /**
   * Updates the optional node name consumed when adding the sampled node.
   * Called by: useSliceSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const setNewNodeName = (value: string) => {
    setFormField('newNodeName', value);
  };

  const activeNode = selectedNode;

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

  const selectionPanelModel = buildSingleNodeSelectionPanelModel({
    nodeId: selectedNodeId,
    selectedNode: activeNode,
  });

  const sliceModel = deriveSliceFormModel({
    selectedNodeId,
    selectedNodeLabel,
    nodeRowCount,
    mode,
    offsetInput,
    lengthInput,
    sampleSizeInput,
    randomSeedInput,
    noRandomSeed,
    isSlicing,
    isOperationsLoading: isLoading.operations,
  });
  const {
    offsetNumber,
    offsetValid,
    lengthNumber,
    lengthValid,
    lengthValue,
    sampleSizeNumber,
    sampleSizeValid,
    sampleSizeValue,
    sampleSizeHint,
    randomSeedValid,
    randomSeedValue,
    hasSelection,
    isFullShuffle,
    formSignature,
    resultSignature,
    autoNodeName,
    rangeSummary,
    previewReady,
    previewReadyMessage,
    operationPayload,
    applyDisabled,
    applyDisabledReason,
  } = sliceModel;
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
    workspaceId: currentWorkspaceId,
    nodeId: selectedNodeId,
    operationPayload,
    operationFetch: slicePreview,
    signaturePrefix: 'slice',
    enabled: previewReady,
    debounceMs: PREVIEW_DEBOUNCE_MS,
  });

  const currentPreviewPage = previewPagination?.page ?? previewPage;

  /**
   * Clamps slice length after editing so preview/apply receives a valid range.
   * Called by: useSliceSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleLengthBlur = () => {
    if (lengthInput.trim().length === 0) return;
    if (lengthNumber === null || !Number.isInteger(lengthNumber)) return;
    if (lengthNumber < 1) {
      setFormField('lengthInput', '1');
    } else if (nodeRowCount !== null && lengthNumber > nodeRowCount) {
      setFormField('lengthInput', String(nodeRowCount));
    }
  };

  /**
   * Clamps absolute sample size to row count when the source shape is known.
   * Called by: useSliceSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleSampleSizeBlur = () => {
    if (sampleSizeInput.trim().length === 0 || !sampleSizeValid) return;
    if (
      nodeRowCount !== null &&
      sampleSizeNumber !== null &&
      Number.isInteger(sampleSizeNumber) &&
      sampleSizeNumber >= nodeRowCount
    ) {
      setFormField('sampleSizeInput', String(nodeRowCount));
    }
  };

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
      selectedNodes: selectionPanelModel.selectedNodes,
      nodeColumnSelections: selectionPanelModel.nodeColumnSelections,
      nodeColors: selectionPanelModel.nodeColors,
      defaultPalette: selectionPanelModel.defaultPalette,
      disabled: selectionPanelModel.disabled,
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
