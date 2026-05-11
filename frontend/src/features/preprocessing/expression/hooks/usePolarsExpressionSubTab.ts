import { useState, useCallback } from 'react';

import type { WorkspaceNodeLike } from '@/features/analysis/common/components/NodeSelectionPanel';
import { type FilterPreviewResponse, type PolarsExpressionRequest, type PolarsExpressionApplyResponse, type PolarsExpressionContext } from '@/api/nodes';
import { usePreprocessingPreview } from '../../hooks/usePreprocessingPreview';
import { takeMostRecent } from '@/utils/selectionUtils';
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

const newId = () =>
  (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const blankExpression = (): ExpressionItem => ({ id: newId(), code: '' });
export const blankSortExpression = (): SortExpressionItem => ({ id: newId(), code: '', descending: false });

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

export function usePolarsExpressionSubTab(props: PolarsExpressionSubTabProps) {
  const { selectedNodes, onAlert, polarsExpressionPreview, polarsExpressionApply, refreshNodeSchema } = props;

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
  const [selectExpressions, setSelectExpressions] = useState<ExpressionItem[]>(() => [blankExpression()]);
  const [sortItems, setSortItems] = useState<SortExpressionItem[]>(() => [blankSortExpression()]);
  const [groupByState, setGroupByState] = useState<GroupByAggState>(() => ({ keyCode: '', aggExpressions: [blankExpression()] }));

  // Serialized expressions (after eval)
  const [serializedRequest, setSerializedRequest] = useState<PolarsExpressionRequest | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);

  const nodeColors = { [effectiveNode?.id ?? '']: DEFAULT_PALETTE[0]! };

  const evalExpressions = useCallback(async () => {
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
  }, [activeContext, filterCode, groupByState, selectExpressions, sortItems, withColumns]);

  // Preview
  const preview = usePreprocessingPreview({
    request: nodeId && serializedRequest ? { nodeId, req: serializedRequest } : null,
    enabled: !!nodeId && !!serializedRequest,
    fetcher: async ({ request, page, pageSize, signal: _signal }) => {
      const res = await polarsExpressionPreview(request.nodeId, request.req, page, pageSize);
      return { data: res.data, columns: res.columns, pagination: res.pagination };
    },
  });

  const applyExpression = useCallback(async () => {
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
  }, [nodeId, serializedRequest, newNodeName, newNodeNamePlaceholder, polarsExpressionApply, refreshNodeSchema, onAlert]);

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
