import { useState, useCallback } from 'react';

import type { WorkspaceNodeLike } from '../../../../components/NodeSelectionPanel';
import { type FilterPreviewResponse, type PolarsExpressionRequest, type PolarsExpressionApplyResponse, type PolarsExpressionContext, type PolarsExpressionItem } from '../../../../api/nodes';
import { usePyodideExpression } from '../../../../lib/pyodide/usePyodideExpression';
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

function buildFilterCode(exprCode: string): string {
  return `result = ${exprCode}`;
}

function buildListCode(codes: string[]): string {
  const items = codes.map((c) => c.trim()).filter(Boolean);
  if (items.length === 1) return `result = ${items[0]}`;
  return `result = [\n  ${items.join(',\n  ')}\n]`;
}

function buildSortCode(items: SortExpressionItem[]): string {
  const parts = items.map((it) => it.code.trim()).filter(Boolean);
  if (parts.length === 1) return `result = ${parts[0]}`;
  return `result = [\n  ${parts.join(',\n  ')}\n]`;
}

export function usePolarsExpressionSubTab(props: PolarsExpressionSubTabProps) {
  const { selectedNodes, onAlert, polarsExpressionPreview, polarsExpressionApply, refreshNodeSchema } = props;
  const pyodide = usePyodideExpression();

  const effectiveNode = takeMostRecent(selectedNodes, 1)[0] ?? null;
  const nodeId = effectiveNode?.id ?? null;

  const [activeContext, setActiveContext] = useState<ExpressionContextTab>('filter');
  const [newNodeName, setNewNodeName] = useState('');
  const [isApplying, setIsApplying] = useState(false);

  // Per-context state
  const [filterCode, setFilterCode] = useState('pl.col("column_name") > 0');
  const [withColumnsCodes, setWithColumnsCodes] = useState(['pl.col("a").alias("b")']);
  const [selectCodes, setSelectCodes] = useState(['pl.col("a"), pl.col("b")']);
  const [sortItems, setSortItems] = useState<SortExpressionItem[]>([{ code: 'pl.col("a")', descending: false }]);
  const [groupByState, setGroupByState] = useState<GroupByAggState>({ keyCode: 'pl.col("group_col")', aggCodes: ['pl.col("value").sum().alias("total")'] });

  // Serialized expressions (after eval)
  const [serializedRequest, setSerializedRequest] = useState<PolarsExpressionRequest | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);

  const nodeColors = { [effectiveNode?.id ?? '']: DEFAULT_PALETTE[0]! };

  // Build the Python code for the current context
  const buildCode = useCallback((): string => {
    switch (activeContext) {
      case 'filter':
        return buildFilterCode(filterCode);
      case 'with_columns':
        return buildListCode(withColumnsCodes);
      case 'select':
        return buildListCode(selectCodes);
      case 'sort':
        return buildSortCode(sortItems);
      case 'group_by_agg': {
        const all = [groupByState.keyCode, ...groupByState.aggCodes];
        return buildListCode(all);
      }
    }
  }, [activeContext, filterCode, withColumnsCodes, selectCodes, sortItems, groupByState]);

  const evalExpressions = useCallback(async () => {
    setEvalError(null);
    setSerializedRequest(null);

    const code = buildCode();
    try {
      const exprs = await pyodide.serialize(code);

      let request: PolarsExpressionRequest;

      if (activeContext === 'group_by_agg') {
        // First expr is the key, rest are aggs
        const [keyExpr, ...aggExprs] = exprs;
        request = {
          context: 'group_by_agg',
          expressions: aggExprs.map((e) => ({ expr: e as object })),
          group_by_keys: [{ expr: keyExpr as object }],
        };
      } else if (activeContext === 'sort') {
        const items: PolarsExpressionItem[] = exprs.map((e, i) => ({
          expr: e as object,
          descending: sortItems[i]?.descending ?? false,
        }));
        request = { context: 'sort', expressions: items };
      } else {
        request = {
          context: activeContext,
          expressions: exprs.map((e) => ({ expr: e as object })),
        };
      }

      setSerializedRequest(request);
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : String(err));
    }
  }, [activeContext, buildCode, pyodide, sortItems]);

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
    pyodide,
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
