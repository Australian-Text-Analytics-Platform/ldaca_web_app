import { useEffect, useReducer, useRef, useState } from 'react';
import {
  aggregateBuilderUiReducer,
  createAggregateBuilderUiState,
  type AggregateDropIndicator,
} from './aggregateBuilderUiState';
import {
  type AggregateBuilderToken,
  buildAggregateExpressionRequest,
  normalizeSmartCharacters,
  tokensToPolarsExpression,
} from './aggregateExpressionModel';
import { insertItemAt, moveItemTo, removeItemAt } from './tokenIndexMath';
import { useAggregateBuilderDragHandlers } from './useAggregateBuilderDrag';

import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import { takeMostRecent } from '@/features/workspace/common/utils/selectionUtils';
import { type PolarsExpressionRequest, type PolarsExpressionApplyResponse } from '@/api';
import {
  mapColumnsToInfo,
  type ColumnInfo,
} from '@/features/workspace/data-view/utils/columnTypes';
import {
  useNodePreviewWithRawFallback,
  type OperationPreviewFetcher,
} from '../../hooks/useNodePreviewWithRawFallback';
import type { PreviewPagination, PreviewRow } from '../../types';

export interface AggregateSubTabProps {
  currentWorkspaceId: string | null;
  selectedNodes: WorkspaceNodeMetadata[];
  isLoading: {
    operations: boolean;
  };
  onAlert: (message: string) => void;
  polarsExpressionPreview: OperationPreviewFetcher<PolarsExpressionRequest>;
  polarsExpressionApply: (
    nodeId: string,
    request: PolarsExpressionRequest,
  ) => Promise<PolarsExpressionApplyResponse>;
  refreshNodeSchema: (nodeId: string) => Promise<unknown>;
}

interface ExpressionConfig {
  expression: string;
  columnName: string;
  onColumnNameBlur: () => void;
  onChange: {
    columnName: (event: React.ChangeEvent<HTMLInputElement>) => void;
  };
}

interface BasicBuilderConfig {
  tokens: AggregateBuilderToken[];
  disabled: boolean;
  dragActive: boolean;
  dropIndicator: AggregateDropIndicator | null;
  editingTokenId: string | null;
  customDraft: string;
  expressionPreview: string;
  availableColumns: ColumnInfo[];
  addColumnToken: (column: string, dtype: string, index?: number) => void;
  addCustomToken: (index?: number) => void;
  removeToken: (tokenId: string) => void;
  moveToken: (tokenId: string, index: number) => void;
  addOperation: (tokenId: string, operation: string) => void;
  removeOperation: (tokenId: string, index: number) => void;
  startEditingCustom: (tokenId: string) => void;
  finishCustomEdit: (commit: boolean) => void;
  clearBuilder: () => void;
  handlers: {
    customDraftChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    customInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    columnDragStart: (
      event: React.DragEvent<HTMLButtonElement>,
      column: string,
      dtype: string,
    ) => void;
    customDragStart: (event: React.DragEvent<HTMLButtonElement>) => void;
    existingTokenDragStart: (event: React.DragEvent<HTMLDivElement>, tokenId: string) => void;
    existingTokenDragEnd: () => void;
    paletteDragEnd: () => void;
    tokenDragOver: (tokenId: string, event: React.DragEvent<HTMLDivElement>) => void;
    builderDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
    builderDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
    builderDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  };
}

interface PreviewConfig {
  data: PreviewRow[];
  columns: string[];
  pagination: PreviewPagination | null;
  loading: boolean;
  error: string | null;
  ready: boolean;
  readyMessage: string;
  page: number;
  pageSize: number;
  setPageSize: (size: number) => void;
  onPageChange: (page: number) => void;
}

interface ApplyConfig {
  loading: boolean;
  canApply: boolean;
  disabledReason: string | undefined;
  lastAppliedExpression: string | null;
  currentMatchesApplied: boolean;
  handleApply: () => Promise<void>;
}

export interface UseAggregateSubTabResult {
  activeNodeId: string | null;
  activeNode: WorkspaceNodeMetadata | null;
  hasSelection: boolean;
  expression: ExpressionConfig;
  basicBuilder: BasicBuilderConfig;
  preview: PreviewConfig;
  apply: ApplyConfig;
  dropZoneRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Creates stable token ids for the visual expression builder. Token lists use
 * these ids for React keys and drag/drop targeting.
 * Used by: local callers in preprocessing/useAggregateSubTab module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
const createTokenId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `token-${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * Owns computed-column state for the Aggregate sub-tab. The component consumes
 * this hook for node selection, token-builder behavior, preview data, and apply
 * controls.
 * Used by: AggregateSubTab module because the rendered sub-tab needs one
 * boundary that coordinates selection, expression, preview, and apply state.
 * Flow: derive the active node and available columns, synchronize builder tokens with
 * expression text, delegate builder drag/drop behavior, run preview/apply
 * requests, and return grouped configs for the tab component.
 */
export const useAggregateSubTab = (props: AggregateSubTabProps): UseAggregateSubTabResult => {
  const {
    currentWorkspaceId,
    selectedNodes,
    isLoading,
    onAlert,
    polarsExpressionPreview,
    polarsExpressionApply,
    refreshNodeSchema,
  } = props;

  const effectiveNodes = takeMostRecent(selectedNodes, 1);
  const activeNode = effectiveNodes[0] ?? null;

  const limitedNodeId = activeNode?.id ?? null;

  const [expression, setExpression] = useState('');
  const [columnName, setColumnName] = useState('new_column');
  const [applyLoading, setApplyLoading] = useState(false);
  const [lastAppliedExpression, setLastAppliedExpression] = useState<string | null>(null);
  const [basicTokens, setBasicTokens] = useState<AggregateBuilderToken[]>([]);
  const [builderUiState, dispatchBuilderUi] = useReducer(
    aggregateBuilderUiReducer,
    createAggregateBuilderUiState(),
  );
  const [committedExpression, setCommittedExpression] = useState('');
  const [committedColumnName, setCommittedColumnName] = useState('');
  const {
    dragActive: basicDragActive,
    dropIndicator,
    editingTokenId,
    customDraft,
  } = builderUiState;

  const dropZoneRef = useRef<HTMLDivElement | null>(null);
  const latestExpressionRef = useRef('');
  const latestColumnNameRef = useRef('new_column');

  const activeNodeId = limitedNodeId;

  const hasSelection = Boolean(activeNodeId);
  const trimmedExpression = expression.trim();
  const basicDisabled = !hasSelection || isLoading.operations;

  const availableColumns: ColumnInfo[] = (() => {
    if (!activeNode) return [];
    return mapColumnsToInfo(activeNode).filter(
      (info) => typeof info.name === 'string' && info.name.length > 0,
    );
  })();

  /**
   * Updates the text expression and its latest ref together so debounced commit
   * and apply logic read the same normalized value.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const setExpressionAndMarkDirty = (nextExpression: string) => {
    const normalizedExpression = normalizeSmartCharacters(nextExpression);
    latestExpressionRef.current = normalizedExpression;
    setExpression(normalizedExpression);
  };

  /**
   * Applies token-list edits and mirrors them into the generated expression.
   * All token add/remove/move/operation handlers route through this helper.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: run the token updater, rebuild the expression preview, preserve no-op token
   * references, and mark expression state dirty when needed.
   */
  const applyBasicTokenUpdate = (
    updater: (prev: AggregateBuilderToken[]) => AggregateBuilderToken[],
  ) => {
    setBasicTokens((prev) => {
      const next = updater(prev);
      if (next === prev) return prev;
      const sameOrder =
        next.length === prev.length && next.every((token, idx) => token === prev[idx]);
      const nextExpression = tokensToPolarsExpression(next);
      if (sameOrder && nextExpression === trimmedExpression) {
        return prev;
      }
      setExpressionAndMarkDirty(nextExpression);
      return sameOrder ? prev : next;
    });
  };

  /**
   * Builds the backend request from the latest expression/column refs. Preview
   * and apply paths use the same alias-wrapping behavior.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const buildRequest = (): PolarsExpressionRequest =>
    buildAggregateExpressionRequest(latestExpressionRef.current, latestColumnNameRef.current);

  /**
   * Commits the current expression/name into the debounced preview payload.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const commitExpression = () => {
    setCommittedExpression(latestExpressionRef.current.trim());
    setCommittedColumnName(latestColumnNameRef.current.trim());
  };

  const commitTimeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (commitTimeoutRef.current && typeof window !== 'undefined') {
        window.clearTimeout(commitTimeoutRef.current);
      }
    },
    [],
  );

  /**
   * Debounces expression commits so typing/dragging does not fire preview calls
   * for every intermediate token state.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const scheduleCommit = () => {
    if (!hasSelection) return;
    if (typeof window === 'undefined') return;
    if (commitTimeoutRef.current) {
      window.clearTimeout(commitTimeoutRef.current);
    }
    commitTimeoutRef.current = window.setTimeout(() => {
      commitTimeoutRef.current = null;
      commitExpression();
    }, 250);
  };

  const operationPayload: PolarsExpressionRequest | null = (() => {
    if (committedExpression.length === 0) return null;
    return buildAggregateExpressionRequest(committedExpression, committedColumnName);
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
    refresh: refreshPreview,
  } = useNodePreviewWithRawFallback<PolarsExpressionRequest>({
    workspaceId: currentWorkspaceId,
    nodeId: activeNodeId,
    operationPayload,
    operationFetch: polarsExpressionPreview,
    signaturePrefix: 'aggregate',
    enabled: hasSelection,
    debounceMs: 100,
  });

  const canApply =
    hasSelection &&
    trimmedExpression.length > 0 &&
    !applyLoading &&
    !isLoading.operations &&
    !previewError;

  /**
   * Adds a selected source column to the builder, optionally at a drag/drop
   * insertion index.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const addColumnToken = (column: string, dtype: string, index?: number) => {
    if (basicDisabled || !column) return;
    applyBasicTokenUpdate((prev) =>
      insertItemAt(prev, index, {
        id: createTokenId(),
        kind: 'column',
        column,
        dtype,
        operations: [],
      }),
    );
    scheduleCommit();
  };

  /**
   * Adds an editable literal token and puts it into edit mode for immediate
   * typing.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const addCustomToken = (index?: number) => {
    if (basicDisabled) return;
    const tokenId = createTokenId();
    applyBasicTokenUpdate((prev) =>
      insertItemAt(prev, index, { id: tokenId, kind: 'custom', value: '' }),
    );
    dispatchBuilderUi({ type: 'startCustomEdit', tokenId, draft: '' });
  };

  /**
   * Removes a builder token by id. Token chip delete buttons call this handler.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const removeBasicToken = (tokenId: string) => {
    if (basicDisabled) return;
    applyBasicTokenUpdate((prev) => {
      const idx = prev.findIndex((token) => token.id === tokenId);
      if (idx === -1) return prev;
      return removeItemAt(prev, idx);
    });
    scheduleCommit();
  };

  /**
   * Reorders an existing token after drag/drop. The visual builder calls this
   * with the calculated insertion index.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: resolve the token index, move it through shared index math, suppress no-op
   * reference churn, and schedule a preview commit.
   */
  const moveBasicToken = (tokenId: string, index: number) => {
    if (basicDisabled) return;
    applyBasicTokenUpdate((prev) => {
      const currentIndex = prev.findIndex((token) => token.id === tokenId);
      if (currentIndex === -1) return prev;
      const moved = moveItemTo(prev, currentIndex, index);
      // moveItemTo returns a fresh array even on no-op moves; preserve the
      // hook's prev-reference contract so consumers don't see a spurious
      // re-render.
      const isNoOp = moved.length === prev.length && moved.every((token, i) => token === prev[i]);
      return isNoOp ? prev : moved;
    });
    scheduleCommit();
  };

  /**
   * Appends a backend-advertised operation to a column token.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const addOperation = (tokenId: string, operation: string) => {
    if (basicDisabled) return;
    applyBasicTokenUpdate((prev) =>
      prev.map((token) => {
        if (token.id === tokenId && token.kind === 'column') {
          return { ...token, operations: [...token.operations, operation] };
        }
        return token;
      }),
    );
    scheduleCommit();
  };

  /**
   * Removes one operation from a column token. Operation chips use this to undo
   * method additions.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const removeOperation = (tokenId: string, index: number) => {
    if (basicDisabled) return;
    applyBasicTokenUpdate((prev) =>
      prev.map((token) => {
        if (token.id === tokenId && token.kind === 'column') {
          const next = [...token.operations];
          next.splice(index, 1);
          return { ...token, operations: next };
        }
        return token;
      }),
    );
    scheduleCommit();
  };

  /**
   * Opens a custom token for editing with a normalized draft. Escape/cancel
   * only discards the draft, leaving the token's stored value unchanged.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const startEditingCustomToken = (tokenId: string) => {
    if (basicDisabled) return;
    const target = basicTokens.find(
      (token): token is Extract<AggregateBuilderToken, { kind: 'custom' }> =>
        token.id === tokenId && token.kind === 'custom',
    );
    if (!target) return;
    const normalizedValue = normalizeSmartCharacters(target.value);
    dispatchBuilderUi({ type: 'startCustomEdit', tokenId, draft: normalizedValue });
  };

  /**
   * Commits or cancels the custom-token draft. Keyboard and blur handlers use
   * this shared path.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: apply committed text when requested, discard the draft on cancel,
   * schedule preview updates, and clear edit state.
   */
  const finishCustomEdit = (commit: boolean) => {
    if (!editingTokenId) {
      dispatchBuilderUi({ type: 'clearCustomEdit' });
      return;
    }
    if (commit) {
      const nextValue = customDraft;
      applyBasicTokenUpdate((prev) =>
        prev.map((token) => {
          if (token.id === editingTokenId && token.kind === 'custom') {
            if (token.value === nextValue) {
              return token;
            }
            return { ...token, value: nextValue };
          }
          return token;
        }),
      );
      scheduleCommit();
    }
    dispatchBuilderUi({ type: 'clearCustomEdit' });
  };

  /**
   * Clears all builder tokens and the generated expression for the Clear button.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const clearBasicBuilder = () => {
    if (basicDisabled) return;
    if (basicTokens.length === 0) {
      setExpressionAndMarkDirty('');
      scheduleCommit();
      return;
    }
    applyBasicTokenUpdate(() => []);
    scheduleCommit();
  };

  const builderDragHandlers = useAggregateBuilderDragHandlers({
    disabled: basicDisabled,
    tokens: basicTokens,
    dropIndicator,
    dropZoneRef,
    editingTokenId,
    finishCustomEdit,
    addColumnToken,
    addCustomToken,
    moveToken: moveBasicToken,
    dispatchBuilderUi,
  });

  /**
   * Applies the current expression to the active node, refreshes schema, and
   * refreshes preview so the sub-tab reflects the created column.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Flow: guard missing node or expression, build the request, apply it, announce the created node, refresh schema/preview, and clear loading.
   */
  const handleApply = async () => {
    const currentExpression = latestExpressionRef.current.trim();
    if (!activeNodeId || currentExpression.length === 0) return;
    setApplyLoading(true);
    try {
      const payload = buildRequest();
      const response = await polarsExpressionApply(activeNodeId, payload);
      setLastAppliedExpression(currentExpression);
      onAlert(`Applied expression to ${response.node_name}`);
      void refreshNodeSchema(activeNodeId);
      commitExpression();
      refreshPreview();
    } catch {
      // Error shown via preview
    } finally {
      setApplyLoading(false);
    }
  };

  /**
   * Updates the output column name while keeping the latest ref in sync for
   * delayed preview commits.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleColumnNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = normalizeSmartCharacters(event.target.value);
    latestColumnNameRef.current = next;
    setColumnName(next);
  };

  /**
   * Forces the preview payload to commit when the column-name field blurs.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleColumnBlur = () => {
    commitExpression();
  };

  /**
   * Normalizes smart characters while editing a custom literal token.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleCustomDraftChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    dispatchBuilderUi({
      type: 'setCustomDraft',
      draft: normalizeSmartCharacters(event.target.value),
    });
  };

  /**
   * Handles Enter/Escape for custom-token editing so keyboard interactions
   * share the same commit/cancel path as pointer interactions.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleCustomInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finishCustomEdit(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finishCustomEdit(false);
    }
  };

  const basicExpressionPreview = tokensToPolarsExpression(basicTokens);
  const currentExpressionMatchesApplied =
    lastAppliedExpression && lastAppliedExpression === trimmedExpression;

  return {
    activeNodeId,
    activeNode,
    hasSelection,
    expression: {
      expression,
      columnName,
      onColumnNameBlur: handleColumnBlur,
      onChange: {
        columnName: handleColumnNameChange,
      },
    },
    basicBuilder: {
      tokens: basicTokens,
      disabled: basicDisabled,
      dragActive: basicDragActive,
      dropIndicator,
      editingTokenId,
      customDraft,
      expressionPreview: basicExpressionPreview,
      availableColumns,
      addColumnToken,
      addCustomToken,
      removeToken: removeBasicToken,
      moveToken: moveBasicToken,
      addOperation,
      removeOperation,
      startEditingCustom: startEditingCustomToken,
      finishCustomEdit,
      clearBuilder: clearBasicBuilder,
      handlers: {
        customDraftChange: handleCustomDraftChange,
        customInputKeyDown: handleCustomInputKeyDown,
        ...builderDragHandlers,
      },
    },
    preview: {
      data: previewData,
      columns: previewColumns,
      pagination: previewPagination,
      loading: previewLoading,
      error: previewError,
      ready: hasSelection,
      readyMessage: !hasSelection
        ? 'Select a data block to configure an expression.'
        : 'Showing original data. Configure an expression and exit the field to preview results.',
      page: previewPage,
      pageSize: previewPageSize,
      setPageSize: setPreviewPageSize,
      onPageChange: setPreviewPage,
    },
    apply: {
      loading: applyLoading,
      canApply,
      disabledReason: (() => {
        if (applyLoading || isLoading.operations) return undefined;
        if (!hasSelection) return 'Select a data block first';
        if (!trimmedExpression.length) return 'Build an expression first';
        if (previewError)
          return 'Fix the expression error shown in Preview before adding to the data block';
        return undefined;
      })(),
      lastAppliedExpression,
      currentMatchesApplied: !!currentExpressionMatchesApplied,
      handleApply,
    },
    dropZoneRef,
  };
};
