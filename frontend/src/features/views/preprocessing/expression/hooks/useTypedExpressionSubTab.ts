import { useReducer, useState } from 'react';

import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import type { PolarsExpressionRequest, PolarsExpressionApplyResponse } from '@/api';
import {
  useNodePreviewWithRawFallback,
  type OperationPreviewFetcher,
} from '../../hooks/useNodePreviewWithRawFallback';
import { takeMostRecent } from '@/features/workspace/common/utils/selectionUtils';
import { buildExpressionAutoNodeName } from '../../utils/autoNodeNames';
import {
  buildTypedExpressionRequest,
  createTypedExpressionDraftState,
  typedExpressionDraftReducer,
  type ExpressionContextTab,
  type ExpressionListTarget,
} from './typedExpressionDraftState';
import type { PreprocessingApplyMode } from '../../preprocessingApplyMode';

export {
  buildTypedExpressionRequest,
  type ExpressionContextTab,
  type ExpressionDraftItem,
  type SortExpressionDraftItem,
} from './typedExpressionDraftState';

export interface TypedExpressionSubTabProps {
  currentWorkspaceId: string | null;
  applyMode: PreprocessingApplyMode;
  selectedNodes: WorkspaceNodeMetadata[];
  isLoading: { operations: boolean };
  onAlert: (message: string) => void;
  polarsExpressionPreview: OperationPreviewFetcher<PolarsExpressionRequest>;
  polarsExpressionApply: (
    nodeId: string,
    req: PolarsExpressionRequest,
    mode: PreprocessingApplyMode,
  ) => Promise<PolarsExpressionApplyResponse>;
  refreshNodeSchema: (nodeId: string) => Promise<unknown>;
}

const DEFAULT_PALETTE = ['#2563eb'];

/**
 * Owns request-building and preview/apply state for the typed expression tab.
 * The component consumes this hook to keep each context's editor state and
 * serialized backend request in one place.
 * Used by `TypedExpressionSubTab` to own expression draft, preview, and apply state.
 * Flow: manage expression item state per context, build request payloads, run preview/apply
 * APIs, and expose tab/editor actions to the component.
 */
export function useTypedExpressionSubTab(props: TypedExpressionSubTabProps) {
  const {
    currentWorkspaceId,
    applyMode,
    selectedNodes,
    onAlert,
    polarsExpressionPreview,
    polarsExpressionApply,
    refreshNodeSchema,
  } = props;

  const effectiveNode = takeMostRecent(selectedNodes, 1)[0] ?? null;
  const nodeId = effectiveNode?.id ?? null;

  const [draftState, dispatchDraft] = useReducer(
    typedExpressionDraftReducer,
    undefined,
    createTypedExpressionDraftState,
  );
  const [newNodeName, setNewNodeName] = useState('');
  const [isApplying, setIsApplying] = useState(false);
  const { activeContext, filterSource, withColumns, selectExpressions, sortItems, groupByState } =
    draftState;

  const newNodeNamePlaceholder = buildExpressionAutoNodeName({
    baseName: effectiveNode?.name ?? '',
    context: activeContext,
  });

  // Serialized expressions (after eval)
  const [serializedRequest, setSerializedRequest] = useState<PolarsExpressionRequest | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);

  // DEFAULT_PALETTE is a non-empty module constant, so index 0 exists.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const nodeColors = { [nodeId ?? '']: DEFAULT_PALETTE[0]! };

  /**
   * Switches which expression context is visible. The reducer owns this with
   * the draft lists so request serialization always reads a single state shape.
   * Called by: TypedExpressionSubTab tab triggers.
   */
  const setActiveContext = (context: ExpressionContextTab) => {
    dispatchDraft({ type: 'setActiveContext', context });
  };

  /**
   * Updates the single filter expression draft.
   * Called by: TypedExpressionSubTab filter editor.
   */
  const setFilterSource = (source: string) => {
    dispatchDraft({ type: 'setFilterSource', source });
  };

  /**
   * Updates one row in a list-backed expression context.
   * Called by: TypedExpressionSubTab list editors for With Columns, Select,
   * and Group By aggregation rows.
   */
  const updateExpressionSource = (target: ExpressionListTarget, id: string, source: string) => {
    dispatchDraft({ type: 'updateExpressionSource', target, id, source });
  };

  /**
   * Adds one empty row to a list-backed expression context.
   * Called by: TypedExpressionSubTab list-editor Add buttons.
   */
  const addExpression = (target: ExpressionListTarget) => {
    dispatchDraft({ type: 'addExpression', target });
  };

  /**
   * Removes one expression row by id.
   * Called by: TypedExpressionSubTab list-editor delete buttons.
   */
  const removeExpression = (target: ExpressionListTarget, id: string) => {
    dispatchDraft({ type: 'removeExpression', target, id });
  };

  /**
   * Updates the group-by key expression.
   * Called by: TypedExpressionSubTab group-by key editor.
   */
  const setGroupByKeySource = (source: string) => {
    dispatchDraft({ type: 'setGroupByKeySource', source });
  };

  /**
   * Updates one sort expression row.
   * Called by: TypedExpressionSubTab sort editor rows.
   */
  const updateSortSource = (id: string, source: string) => {
    dispatchDraft({ type: 'updateSortSource', id, source });
  };

  /**
   * Updates one sort direction checkbox.
   * Called by: TypedExpressionSubTab sort descending controls.
   */
  const updateSortDescending = (id: string, descending: boolean) => {
    dispatchDraft({ type: 'updateSortDescending', id, descending });
  };

  /**
   * Adds an empty sort expression row.
   * Called by: TypedExpressionSubTab sort Add button.
   */
  const addSortExpression = () => {
    dispatchDraft({ type: 'addSortExpression' });
  };

  /**
   * Removes one sort expression row.
   * Called by: TypedExpressionSubTab sort row delete buttons.
   */
  const removeSortExpression = (id: string) => {
    dispatchDraft({ type: 'removeSortExpression', id });
  };

  /**
   * Serializes the currently active context into a PolarsExpressionRequest for
   * preview and apply calls.
   * Returned to `TypedExpressionSubTab` for its Preview action.
   * Steps: build the request payload from committed expressions, call preview for the current
   * node/page, and adapt backend rows into preview state.
   */
  const evalExpressions = () => {
    setEvalError(null);
    setSerializedRequest(null);

    try {
      setSerializedRequest(buildTypedExpressionRequest(draftState));
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : String(err));
    }
  };

  // Preview
  const preview = useNodePreviewWithRawFallback({
    workspaceId: currentWorkspaceId,
    nodeId,
    operationPayload: serializedRequest,
    operationFetch: polarsExpressionPreview,
    operation: 'expression',
    enabled: Boolean(nodeId && serializedRequest),
  });

  /**
   * Applies the serialized expression to the selected node and refreshes schema
   * so downstream selectors can see new/changed columns.
   * Returned to `TypedExpressionSubTab` for its Apply action.
   */
  const applyExpression = async () => {
    if (!nodeId || !serializedRequest) return;
    setIsApplying(true);
    try {
      const req: PolarsExpressionRequest =
        applyMode === 'create'
          ? {
              ...serializedRequest,
              name: newNodeName.trim() || newNodeNamePlaceholder,
            }
          : serializedRequest;
      await polarsExpressionApply(nodeId, req, applyMode);
      if (applyMode === 'update') {
        await refreshNodeSchema(nodeId);
      }
    } catch (err) {
      onAlert(err instanceof Error ? err.message : 'Failed to apply expression');
    } finally {
      setIsApplying(false);
    }
  };

  return {
    effectiveNode,
    nodeId,
    nodeColors,
    activeContext,
    setActiveContext,
    newNodeName,
    newNodeNamePlaceholder,
    setNewNodeName,
    isApplying,
    evalError,
    serializedRequest,

    filterSource,
    setFilterSource,
    withColumns,
    selectExpressions,
    sortItems,
    groupByState,
    updateExpressionSource,
    addExpression,
    removeExpression,
    setGroupByKeySource,
    updateSortSource,
    updateSortDescending,
    addSortExpression,
    removeSortExpression,

    evalExpressions,
    applyExpression,
    preview,
  };
}
