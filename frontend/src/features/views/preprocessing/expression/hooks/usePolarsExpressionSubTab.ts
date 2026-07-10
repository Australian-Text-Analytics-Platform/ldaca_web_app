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
  buildPolarsExpressionRequest,
  createPolarsExpressionDraftState,
  polarsExpressionDraftReducer,
  type ExpressionContextTab,
  type ExpressionListTarget,
} from './polarsExpressionDraftState';

export {
  buildPolarsExpressionRequest,
  type ExpressionContextTab,
  type ExpressionItem,
  type SortExpressionItem,
} from './polarsExpressionDraftState';

export interface PolarsExpressionSubTabProps {
  currentWorkspaceId: string | null;
  selectedNodes: WorkspaceNodeMetadata[];
  isLoading: { operations: boolean };
  onAlert: (message: string) => void;
  polarsExpressionPreview: OperationPreviewFetcher<PolarsExpressionRequest>;
  polarsExpressionApply: (
    nodeId: string,
    req: PolarsExpressionRequest,
  ) => Promise<PolarsExpressionApplyResponse>;
  refreshNodeSchema: (nodeId: string) => Promise<unknown>;
}

const DEFAULT_PALETTE = ['#2563eb'];

/**
 * Owns request-building and preview/apply state for the Polars expression tab.
 * The component consumes this hook to keep each context's editor state and
 * serialized backend request in one place.
 * Used by `PolarsExpressionSubTab` to own expression draft, preview, and apply state.
 * Flow: manage expression item state per context, build request payloads, run preview/apply
 * APIs, and expose tab/editor actions to the component.
 */
export function usePolarsExpressionSubTab(props: PolarsExpressionSubTabProps) {
  const {
    currentWorkspaceId,
    selectedNodes,
    onAlert,
    polarsExpressionPreview,
    polarsExpressionApply,
    refreshNodeSchema,
  } = props;

  const effectiveNode = takeMostRecent(selectedNodes, 1)[0] ?? null;
  const nodeId = effectiveNode?.id ?? null;

  const [draftState, dispatchDraft] = useReducer(
    polarsExpressionDraftReducer,
    undefined,
    createPolarsExpressionDraftState,
  );
  const [newNodeName, setNewNodeName] = useState('');
  const [isApplying, setIsApplying] = useState(false);
  const { activeContext, filterCode, withColumns, selectExpressions, sortItems, groupByState } =
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
   * Called by: PolarsExpressionSubTab tab triggers.
   */
  const setActiveContext = (context: ExpressionContextTab) => {
    dispatchDraft({ type: 'setActiveContext', context });
  };

  /**
   * Updates the single filter expression draft.
   * Called by: PolarsExpressionSubTab filter editor.
   */
  const setFilterCode = (code: string) => {
    dispatchDraft({ type: 'setFilterCode', code });
  };

  /**
   * Updates one row in a list-backed expression context.
   * Called by: PolarsExpressionSubTab list editors for With Columns, Select,
   * and Group By aggregation rows.
   */
  const updateExpressionCode = (target: ExpressionListTarget, id: string, code: string) => {
    dispatchDraft({ type: 'updateExpressionCode', target, id, code });
  };

  /**
   * Adds one empty row to a list-backed expression context.
   * Called by: PolarsExpressionSubTab list-editor Add buttons.
   */
  const addExpression = (target: ExpressionListTarget) => {
    dispatchDraft({ type: 'addExpression', target });
  };

  /**
   * Removes one expression row by id.
   * Called by: PolarsExpressionSubTab list-editor delete buttons.
   */
  const removeExpression = (target: ExpressionListTarget, id: string) => {
    dispatchDraft({ type: 'removeExpression', target, id });
  };

  /**
   * Updates the group-by key expression.
   * Called by: PolarsExpressionSubTab group-by key editor.
   */
  const setGroupByKeyCode = (code: string) => {
    dispatchDraft({ type: 'setGroupByKeyCode', code });
  };

  /**
   * Updates one sort expression row.
   * Called by: PolarsExpressionSubTab sort CodeEditor rows.
   */
  const updateSortCode = (id: string, code: string) => {
    dispatchDraft({ type: 'updateSortCode', id, code });
  };

  /**
   * Updates one sort direction checkbox.
   * Called by: PolarsExpressionSubTab sort descending controls.
   */
  const updateSortDescending = (id: string, descending: boolean) => {
    dispatchDraft({ type: 'updateSortDescending', id, descending });
  };

  /**
   * Adds an empty sort expression row.
   * Called by: PolarsExpressionSubTab sort Add button.
   */
  const addSortExpression = () => {
    dispatchDraft({ type: 'addSortExpression' });
  };

  /**
   * Removes one sort expression row.
   * Called by: PolarsExpressionSubTab sort row delete buttons.
   */
  const removeSortExpression = (id: string) => {
    dispatchDraft({ type: 'removeSortExpression', id });
  };

  /**
   * Serializes the currently active context into a PolarsExpressionRequest for
   * preview and apply calls.
   * Returned to `PolarsExpressionSubTab` for its Preview action.
   * Steps: build the request payload from committed expressions, call preview for the current
   * node/page, and adapt backend rows into preview state.
   */
  const evalExpressions = () => {
    setEvalError(null);
    setSerializedRequest(null);

    try {
      setSerializedRequest(buildPolarsExpressionRequest(draftState));
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
    signaturePrefix: 'expression',
    enabled: Boolean(nodeId && serializedRequest),
  });

  /**
   * Applies the serialized expression to the selected node and refreshes schema
   * so downstream selectors can see new/changed columns.
   * Returned to `PolarsExpressionSubTab` for its Apply action.
   */
  const applyExpression = async () => {
    if (!nodeId || !serializedRequest) return;
    setIsApplying(true);
    try {
      const req: PolarsExpressionRequest = {
        ...serializedRequest,
        new_node_name: newNodeName.trim() || newNodeNamePlaceholder,
      };
      await polarsExpressionApply(nodeId, req);
      await refreshNodeSchema(nodeId);
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

    filterCode,
    setFilterCode,
    withColumns,
    selectExpressions,
    sortItems,
    groupByState,
    updateExpressionCode,
    addExpression,
    removeExpression,
    setGroupByKeyCode,
    updateSortCode,
    updateSortDescending,
    addSortExpression,
    removeSortExpression,

    evalExpressions,
    applyExpression,
    preview,
  };
}
