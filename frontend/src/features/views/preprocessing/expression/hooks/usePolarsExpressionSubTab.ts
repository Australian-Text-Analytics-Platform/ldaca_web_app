import { useState } from 'react';

import type { WorkspaceNodeLike } from '@/features/views/common/nodeSelectionTypes';
import type {
  FilterPreviewResponse,
  PolarsExpressionRequest,
  PolarsExpressionApplyResponse,
  PolarsExpressionContext,
} from '@/api';
import { usePreprocessingPreview } from '../../hooks/usePreprocessingPreview';
import { takeMostRecent } from '@/features/workspace/common/utils/selectionUtils';
import { buildExpressionAutoNodeName } from '../../utils/autoNodeNames';
import { deriveNodeLabel } from '../../utils/nodeMetadata';

export type ExpressionContextTab = PolarsExpressionContext;

/**
 * Each user-mutable expression entry carries its own opaque `id` so React
 * can use it for the list `key`. Using array index keys here was the B8
 * bug — adding/removing an item mid-list re-attributed the CodeEditor
 * focus to the wrong row.
 */
export interface ExpressionItem {
  id: string;
  code: string;
}

export interface SortExpressionItem extends ExpressionItem {
  descending: boolean;
}

export interface GroupByAggState {
  keyCode: string;
  aggExpressions: ExpressionItem[];
}

/**
 * Generates stable expression row ids for React list keys and focus tracking.
 * Used by: local callers in preprocessing/usePolarsExpressionSubTab module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
const newId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${String(Date.now())}-${Math.random().toString(36).slice(2)}`;

/**
 * Creates an empty expression row with a stable id for React list keys.
 * Used by: PolarsExpressionSubTab module (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 */
export const blankExpression = (): ExpressionItem => ({ id: newId(), code: '' });
/**
 * Creates an empty sort expression row with a stable id and default direction.
 * Used by: PolarsExpressionSubTab module (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 */
export const blankSortExpression = (): SortExpressionItem => ({
  id: newId(),
  code: '',
  descending: false,
});

export interface PolarsExpressionSubTabProps {
  selectedNodeId: string | null;
  selectedNodes: WorkspaceNodeLike[];
  workspaceNodes: WorkspaceNodeLike[];
  isLoading: { nodeData: boolean; graph: boolean; operations: boolean };
  onAlert: (message: string) => void;
  polarsExpressionPreview: (
    nodeId: string,
    req: PolarsExpressionRequest,
    page?: number,
    pageSize?: number,
  ) => Promise<FilterPreviewResponse>;
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
 * Used by: CodeEditor module, PolarsExpressionSubTab module (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 * Flow: manage expression item state per context, build request payloads, run preview/apply
 * APIs, and expose tab/editor actions to the component.
 */
export function usePolarsExpressionSubTab(props: PolarsExpressionSubTabProps) {
  const {
    selectedNodes,
    onAlert,
    polarsExpressionPreview,
    polarsExpressionApply,
    refreshNodeSchema,
  } = props;

  const effectiveNode = takeMostRecent(selectedNodes, 1)[0] ?? null;
  const nodeId = effectiveNode?.id ?? null;

  const [activeContext, setActiveContext] = useState<ExpressionContextTab>('filter');
  const [newNodeName, setNewNodeName] = useState('');
  const [isApplying, setIsApplying] = useState(false);

  const newNodeNamePlaceholder = buildExpressionAutoNodeName({
    baseName: deriveNodeLabel(effectiveNode),
    context: activeContext,
  });

  // Per-context state. Lists carry stable `id`s so React keys survive
  // add/remove/reorder without losing CodeEditor focus on the wrong row.
  const [filterCode, setFilterCode] = useState('');
  const [withColumns, setWithColumns] = useState<ExpressionItem[]>(() => [blankExpression()]);
  const [selectExpressions, setSelectExpressions] = useState<ExpressionItem[]>(() => [
    blankExpression(),
  ]);
  const [sortItems, setSortItems] = useState<SortExpressionItem[]>(() => [blankSortExpression()]);
  const [groupByState, setGroupByState] = useState<GroupByAggState>(() => ({
    keyCode: '',
    aggExpressions: [blankExpression()],
  }));

  // Serialized expressions (after eval)
  const [serializedRequest, setSerializedRequest] = useState<PolarsExpressionRequest | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);

  // DEFAULT_PALETTE is a non-empty module constant, so index 0 exists.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const nodeColors = { [effectiveNode?.id ?? '']: DEFAULT_PALETTE[0]! };

  /**
   * Serializes the currently active context into a PolarsExpressionRequest for
   * preview and apply calls.
   * Called by: usePolarsExpressionSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: build the request payload from committed expressions, call preview for the current
   * node/page, and adapt backend rows into preview state.
   */
  const evalExpressions = () => {
    setEvalError(null);
    setSerializedRequest(null);

    try {
      // Build the request from raw code strings — backend validates via AST
      let request: PolarsExpressionRequest;
      if (activeContext === 'group_by_agg') {
        request = {
          context: 'group_by_agg',
          expressions: groupByState.aggExpressions
            .filter((it) => it.code.trim())
            .map((it) => ({ code: it.code.trim() })),
          group_by_keys: [{ code: groupByState.keyCode.trim() }],
        };
      } else if (activeContext === 'sort') {
        request = {
          context: 'sort',
          expressions: sortItems
            .filter((it) => it.code.trim())
            .map((it) => ({ code: it.code.trim(), descending: it.descending })),
        };
      } else if (activeContext === 'filter') {
        request = { context: 'filter', expressions: [{ code: filterCode.trim() }] };
      } else if (activeContext === 'with_columns') {
        request = {
          context: 'with_columns',
          expressions: withColumns
            .filter((it) => it.code.trim())
            .map((it) => ({ code: it.code.trim() })),
        };
      } else {
        request = {
          context: 'select',
          expressions: selectExpressions
            .filter((it) => it.code.trim())
            .map((it) => ({ code: it.code.trim() })),
        };
      }

      setSerializedRequest(request);
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : String(err));
    }
  };

  // Preview
  const preview = usePreprocessingPreview({
    request: nodeId && serializedRequest ? { nodeId, req: serializedRequest } : null,
    enabled: !!nodeId && !!serializedRequest,
    // Adapts the generated preview API to the shared preprocessing preview hook.
    // Called by: usePreprocessingPreview option object inside usePolarsExpressionSubTab because consumers need this callback at the object boundary instead of recreating it inline.
    fetcher: async ({ request, page, pageSize, signal: _signal }) => {
      const res = await polarsExpressionPreview(request.nodeId, request.req, page, pageSize);
      return { data: res.data, columns: res.columns, pagination: res.pagination };
    },
  });

  /**
   * Applies the serialized expression to the selected node and refreshes schema
   * so downstream selectors can see new/changed columns.
   * Called by: usePolarsExpressionSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
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
    setWithColumns,
    selectExpressions,
    setSelectExpressions,
    sortItems,
    setSortItems,
    groupByState,
    setGroupByState,

    evalExpressions,
    applyExpression,
    preview,
  };
}
