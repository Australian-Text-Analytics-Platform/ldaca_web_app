import { useState, useCallback } from 'react';

import type { WorkspaceNodeLike } from '../../../../components/NodeSelectionPanel';
import { type FilterPreviewResponse, type PolarsExpressionRequest, type PolarsExpressionApplyResponse, type PolarsExpressionContext } from '../../../../api/nodes';
import { usePreprocessingPreview } from '../../hooks/usePreprocessingPreview';
import { takeMostRecent } from '../../../../utils/selectionUtils';

export type ExpressionContextTab = PolarsExpressionContext;

export interface SortExpressionItem {
  code: string;
  descending: boolean;
}

export interface GroupByAggState {
  keyCode: string;
  aggCodes: string[];
}

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

  // Per-context state
  const [filterCode, setFilterCode] = useState('');
  const [withColumnsCodes, setWithColumnsCodes] = useState(['']);
  const [selectCodes, setSelectCodes] = useState(['']);
  const [sortItems, setSortItems] = useState<SortExpressionItem[]>([{ code: '', descending: false }]);
  const [groupByState, setGroupByState] = useState<GroupByAggState>({ keyCode: '', aggCodes: [''] });

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
          expressions: groupByState.aggCodes.filter(Boolean).map((c) => ({ code: c.trim() })),
          group_by_keys: [{ code: groupByState.keyCode.trim() }],
        };
      } else if (activeContext === 'sort') {
        request = {
          context: 'sort',
          expressions: sortItems.filter((it) => it.code.trim()).map((it) => ({ code: it.code.trim(), descending: it.descending })),
        };
      } else if (activeContext === 'filter') {
        request = { context: 'filter', expressions: [{ code: filterCode.trim() }] };
      } else if (activeContext === 'with_columns') {
        request = { context: 'with_columns', expressions: withColumnsCodes.filter(Boolean).map((c) => ({ code: c.trim() })) };
      } else {
        request = { context: 'select', expressions: selectCodes.filter(Boolean).map((c) => ({ code: c.trim() })) };
      }

      setSerializedRequest(request);
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : String(err));
    }
  }, [activeContext, filterCode, groupByState, selectCodes, sortItems, withColumnsCodes]);

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
        new_node_name: newNodeName.trim() || undefined,
      };
      await polarsExpressionApply(nodeId, req);
      await refreshNodeSchema(nodeId);
    } catch (err) {
      onAlert(err instanceof Error ? err.message : 'Failed to apply expression');
    } finally {
      setIsApplying(false);
    }
  }, [nodeId, serializedRequest, newNodeName, polarsExpressionApply, refreshNodeSchema, onAlert]);

  return {
    effectiveNode,
    nodeId,
    nodeColors,
    activeContext,
    setActiveContext,
    newNodeName,
    setNewNodeName,
    isApplying,
    evalError,
    serializedRequest,

    filterCode,
    setFilterCode,
    withColumnsCodes,
    setWithColumnsCodes,
    selectCodes,
    setSelectCodes,
    sortItems,
    setSortItems,
    groupByState,
    setGroupByState,

    evalExpressions,
    applyExpression,
    preview,
  };
}
