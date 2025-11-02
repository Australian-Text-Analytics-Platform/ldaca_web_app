import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, Lightbulb, Loader2 } from 'lucide-react';

import NodeSelectionPanel, { WorkspaceNodeLike } from '../NodeSelectionPanel';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Separator } from '../ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { cn } from '../../lib/utils';
import type {
  ExpressionApplyResponse,
  ExpressionPreviewResponse,
  ExpressionTransformRequest,
} from '../../api/nodes';
import { ApiError } from '../../api/http';
import { mapColumnsToInfo } from '../../utils/columnTypes';

interface AggregateSubTabProps {
  selectedNodeId: string | null;
  selectedNodes: WorkspaceNodeLike[];
  workspaceNodes: WorkspaceNodeLike[];
  getNodeShape: (nodeId: string) => Promise<{ shape: [number, number]; is_lazy: boolean; calculated: boolean } | null>;
  isLoading: {
    nodeData: boolean;
    graph: boolean;
    operations: boolean;
  };
  onAlert: (message: string) => void;
  computeColumnPreview: (nodeId: string, request: ExpressionTransformRequest) => Promise<ExpressionPreviewResponse>;
  computeColumn: (nodeId: string, request: ExpressionTransformRequest) => Promise<ExpressionApplyResponse>;
  refreshNodeSchema: (nodeId: string) => Promise<unknown>;
}

const DEFAULT_PREVIEW_LIMIT = 25;
const DEFAULT_PALETTE = ['#2563eb'];

const getErrorMessage = (error: unknown): string => {
  if (!error) return 'Unknown error';
  if (error instanceof ApiError) return error.message || 'Request failed';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Request failed';
};

const BASIC_TOKEN_MIME = 'application/x-ldaca-builder-token';

type BasicToken =
  | { id: string; kind: 'column'; column: string }
  | { id: string; kind: 'custom'; value: string };

type DropIndicator = { tokenId: string; position: 'before' | 'after' };

type DragPayload =
  | { source: 'palette'; kind: 'column'; column: string }
  | { source: 'palette'; kind: 'custom' }
  | { source: 'existing'; id: string };

const createTokenId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `token-${Math.random().toString(36).slice(2, 10)}`;
};

export const AggregateSubTab: React.FC<AggregateSubTabProps> = ({
  selectedNodeId,
  selectedNodes,
  workspaceNodes,
  getNodeShape,
  isLoading,
  onAlert,
  computeColumnPreview,
  computeColumn,
  refreshNodeSchema,
}) => {
  const effectiveNodes = useMemo(() => {
    if (selectedNodes?.length) {
      return selectedNodes.slice(0, 1);
    }
    if (selectedNodeId) {
      const fallback = workspaceNodes.find((node, idx) => {
        const identifier =
          node.id ||
          node.node_id ||
          (node.data?.id as string | undefined) ||
          (node.data?.node_id as string | undefined) ||
          `node-${idx}`;
        return identifier === selectedNodeId;
      });
      if (fallback) {
        return [fallback];
      }
    }
    return [] as WorkspaceNodeLike[];
  }, [selectedNodes, selectedNodeId, workspaceNodes]);

  const limitedNodeId = useMemo(() => {
    if (!effectiveNodes.length) return null;
    const first = effectiveNodes[0];
    return (
      first.id ||
      first.node_id ||
      (first.data?.id as string | undefined) ||
      (first.data?.node_id as string | undefined) ||
      null
    );
  }, [effectiveNodes]);

  const [expression, setExpression] = useState('');
  const [columnName, setColumnName] = useState('');
  const [previewData, setPreviewData] = useState<ExpressionPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [applyLoading, setApplyLoading] = useState(false);
  const [lastAppliedExpression, setLastAppliedExpression] = useState<string | null>(null);
  const [expressionFocused, setExpressionFocused] = useState(false);
  const [columnNameFocused, setColumnNameFocused] = useState(false);
  const [previewStale, setPreviewStale] = useState(false);
  const [expressionMode, setExpressionMode] = useState<'basic' | 'advanced'>('basic');
  const [basicTokens, setBasicTokens] = useState<BasicToken[]>([]);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  const [basicDragActive, setBasicDragActive] = useState(false);
  const [editingTokenId, setEditingTokenId] = useState<string | null>(null);
  const [customDraft, setCustomDraft] = useState('');
  const customOriginalRef = useRef<string>('');
  const dropZoneRef = useRef<HTMLDivElement | null>(null);
  const previewTimeoutRef = useRef<number | null>(null);
  const latestExpressionRef = useRef('');
  const latestColumnNameRef = useRef('');

  useEffect(() => {
    setPreviewData(null);
    setPreviewError(null);
    setLastAppliedExpression(null);
    setPreviewStale(false);
    setBasicTokens([]);
    setEditingTokenId(null);
    setDropIndicator(null);
    setBasicDragActive(false);
    setCustomDraft('');
  }, [limitedNodeId, selectedNodeId]);

  useEffect(() => {
    latestExpressionRef.current = expression;
  }, [expression]);

  useEffect(() => {
    latestColumnNameRef.current = columnName;
  }, [columnName]);

  useEffect(() => () => {
    if (previewTimeoutRef.current && typeof window !== 'undefined') {
      window.clearTimeout(previewTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (expressionMode === 'advanced') {
      setEditingTokenId(null);
      setDropIndicator(null);
      setBasicDragActive(false);
    }
  }, [expressionMode]);

  const nodeColumnSelections = useMemo(() => (
    limitedNodeId ? [{ nodeId: limitedNodeId, column: '' }] : []
  ), [limitedNodeId]);

  const nodeColors = useMemo(() => (
    limitedNodeId ? { [limitedNodeId]: DEFAULT_PALETTE[0] } : {}
  ), [limitedNodeId]);

  const activeNodeId = useMemo(() => {
    return limitedNodeId ?? selectedNodeId ?? null;
  }, [limitedNodeId, selectedNodeId]);

  const workspaceNodeMap = useMemo(() => {
    const map = new Map<string, WorkspaceNodeLike>();
    workspaceNodes.forEach((node, idx) => {
      const id = node.id || node.node_id || `node-${idx}`;
      if (id) map.set(id, node);
    });
    return map;
  }, [workspaceNodes]);

  const effectiveSelectedNodes = useMemo(() => {
    if (!limitedNodeId) return [] as WorkspaceNodeLike[];
    const node = workspaceNodeMap.get(limitedNodeId);
    return node ? [node] : [];
  }, [limitedNodeId, workspaceNodeMap]);

  const hasSelection = Boolean(activeNodeId);
  const trimmedExpression = latestExpressionRef.current.trim();
  const canApply = hasSelection && trimmedExpression.length > 0 && !applyLoading && !isLoading.operations;
  const basicDisabled = !hasSelection || isLoading.operations;

  const availableColumns = useMemo(() => {
    if (!effectiveSelectedNodes.length) return [] as string[];
    const [node] = effectiveSelectedNodes;
    return mapColumnsToInfo(node)
      .map((info) => info.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
  }, [effectiveSelectedNodes]);

  const setExpressionAndMarkDirty = useCallback((nextExpression: string) => {
    latestExpressionRef.current = nextExpression;
    setExpression(nextExpression);
    const nextTrimmed = nextExpression.trim();
    if (nextTrimmed.length === 0) {
      setPreviewData(null);
      setPreviewError(null);
      setPreviewStale(false);
    } else {
      setPreviewStale(true);
    }
  }, []);

  const formatColumnName = useCallback((name: string) => {
    if (!name) return '';
    const safe = name.replace(/"/g, '\\"');
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      return name;
    }
    return `"${safe}"`;
  }, []);

  const escapeLiteralValue = useCallback((value: string) => value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"'), []);

  const formatCustomToken = useCallback((rawValue: string) => {
    if (!rawValue.length) {
      return '""';
    }
    const trimmed = rawValue.trim();
    if (!trimmed.length) {
      return '""';
    }
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed;
    }
    return `"${escapeLiteralValue(rawValue)}"`;
  }, [escapeLiteralValue]);

  const tokensToExpression = useCallback((tokens: BasicToken[]) => (
    tokens
      .map((token) => {
        if (token.kind === 'column') {
          return formatColumnName(token.column);
        }
        return formatCustomToken(token.value);
      })
      .join(' + ')
  ), [formatColumnName, formatCustomToken]);

  const applyBasicTokenUpdate = useCallback((updater: (prev: BasicToken[]) => BasicToken[]) => {
    setBasicTokens((prev) => {
      const next = updater(prev);
      if (next === prev) return prev;
      const sameOrder = next.length === prev.length && next.every((token, idx) => token === prev[idx]);
      const nextExpression = tokensToExpression(next);
      if (sameOrder && nextExpression === trimmedExpression) {
        return prev;
      }
      setExpressionAndMarkDirty(nextExpression);
      return sameOrder ? prev : next;
    });
  }, [tokensToExpression, setExpressionAndMarkDirty, trimmedExpression]);

  const basicExpressionPreview = useMemo(() => tokensToExpression(basicTokens), [basicTokens, tokensToExpression]);
  const manualExpressionActive = basicTokens.length === 0 && trimmedExpression.length > 0;

  const buildRequest = useCallback((): ExpressionTransformRequest => {
    const expressionValue = latestExpressionRef.current.trim();
    const columnValue = latestColumnNameRef.current.trim();
    const payload: ExpressionTransformRequest = { expression: expressionValue };
    if (columnValue.length > 0) payload.new_column_name = columnValue;
    return payload;
  }, []);

  const handlePreview = useCallback(async () => {
    const currentExpression = latestExpressionRef.current.trim();
    if (!activeNodeId || currentExpression.length === 0) {
      setPreviewData(null);
      setPreviewError(null);
      setPreviewStale(false);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const payload: ExpressionTransformRequest = {
        ...buildRequest(),
        preview_limit: DEFAULT_PREVIEW_LIMIT,
      };
      const response = await computeColumnPreview(activeNodeId, payload);
      setPreviewData(response);
      setPreviewStale(false);
    } catch (error) {
      setPreviewError(getErrorMessage(error));
      setPreviewData(null);
      setPreviewStale(false);
    } finally {
      setPreviewLoading(false);
    }
  }, [activeNodeId, buildRequest, computeColumnPreview]);

  const requestPreview = useCallback(() => {
    if (!hasSelection) return;
    if (latestExpressionRef.current.trim().length === 0) {
      setPreviewData(null);
      setPreviewError(null);
      setPreviewStale(false);
      return;
    }
    void handlePreview();
  }, [hasSelection, handlePreview]);

  const schedulePreview = useCallback(() => {
    if (!hasSelection) return;
    if (typeof window === 'undefined') return;
    if (previewTimeoutRef.current) {
      window.clearTimeout(previewTimeoutRef.current);
    }
    previewTimeoutRef.current = window.setTimeout(() => {
      previewTimeoutRef.current = null;
      requestPreview();
    }, 250);
  }, [hasSelection, requestPreview]);

  const clampIndex = (value: number, max: number) => {
    if (Number.isNaN(value)) return max;
    if (value < 0) return 0;
    if (value > max) return max;
    return value;
  };

  const addColumnToken = useCallback((column: string, index?: number) => {
    if (basicDisabled || !column) return;
    applyBasicTokenUpdate((prev) => {
      const next = [...prev];
      const insertIndex = clampIndex(index ?? next.length, next.length);
      next.splice(insertIndex, 0, { id: createTokenId(), kind: 'column', column });
      return next;
    });
    schedulePreview();
  }, [basicDisabled, applyBasicTokenUpdate, schedulePreview]);

  const addCustomToken = useCallback((index?: number) => {
    if (basicDisabled) return;
    const tokenId = createTokenId();
    applyBasicTokenUpdate((prev) => {
      const next = [...prev];
      const insertIndex = clampIndex(index ?? next.length, next.length);
      next.splice(insertIndex, 0, { id: tokenId, kind: 'custom', value: '' });
      return next;
    });
    setEditingTokenId(tokenId);
    setCustomDraft('');
    customOriginalRef.current = '';
  }, [basicDisabled, applyBasicTokenUpdate]);

  const removeBasicToken = useCallback((tokenId: string) => {
    if (basicDisabled) return;
    applyBasicTokenUpdate((prev) => {
      const idx = prev.findIndex((token) => token.id === tokenId);
      if (idx === -1) return prev;
      const next = [...prev];
      next.splice(idx, 1);
      return next;
    });
    schedulePreview();
  }, [basicDisabled, applyBasicTokenUpdate, schedulePreview]);

  const moveBasicToken = useCallback((tokenId: string, index: number) => {
    if (basicDisabled) return;
    applyBasicTokenUpdate((prev) => {
      const currentIndex = prev.findIndex((token) => token.id === tokenId);
      if (currentIndex === -1) return prev;
      const next = [...prev];
      const [item] = next.splice(currentIndex, 1);
      let targetIndex = clampIndex(index, next.length + 1);
      if (currentIndex < targetIndex) {
        targetIndex -= 1;
      }
      if (targetIndex === currentIndex) {
        return prev;
      }
      next.splice(targetIndex, 0, item);
      return next;
    });
    schedulePreview();
  }, [basicDisabled, applyBasicTokenUpdate, schedulePreview]);

  const startEditingCustomToken = useCallback((tokenId: string) => {
    if (basicDisabled) return;
    const target = basicTokens.find((token): token is Extract<BasicToken, { kind: 'custom' }> => token.id === tokenId && token.kind === 'custom');
    if (!target) return;
    setEditingTokenId(tokenId);
    setCustomDraft(target.value);
    customOriginalRef.current = target.value;
  }, [basicTokens, basicDisabled]);

  const finishCustomEdit = useCallback((commit: boolean) => {
    if (!editingTokenId) {
      setCustomDraft('');
      return;
    }
    if (commit) {
      const nextValue = customDraft.trim().length ? customDraft : '';
      applyBasicTokenUpdate((prev) => prev.map((token) => {
        if (token.id === editingTokenId && token.kind === 'custom') {
          if (token.value === nextValue) {
            return token;
          }
          return { ...token, value: nextValue };
        }
        return token;
      }));
      schedulePreview();
    } else {
      setCustomDraft(customOriginalRef.current);
    }
    setEditingTokenId(null);
    setCustomDraft('');
  }, [editingTokenId, customDraft, applyBasicTokenUpdate, schedulePreview]);

  const handleCustomDraftChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setCustomDraft(event.target.value);
  }, []);

  const handleCustomInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finishCustomEdit(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finishCustomEdit(false);
    }
  }, [finishCustomEdit]);

  const clearBasicBuilder = useCallback(() => {
    if (basicDisabled) return;
    if (basicTokens.length === 0) {
      setExpressionAndMarkDirty('');
      schedulePreview();
      return;
    }
    applyBasicTokenUpdate(() => []);
    schedulePreview();
  }, [basicDisabled, basicTokens.length, applyBasicTokenUpdate, schedulePreview, setExpressionAndMarkDirty]);

  const parseDragPayload = (event: React.DragEvent): DragPayload | null => {
    try {
      const raw = event.dataTransfer?.getData(BASIC_TOKEN_MIME);
      if (!raw) return null;
      const payload = JSON.parse(raw) as DragPayload;
      if (!payload || typeof payload !== 'object') return null;
      return payload;
    } catch {
      return null;
    }
  };

  const handleColumnDragStart = useCallback((event: React.DragEvent<HTMLButtonElement>, column: string) => {
    if (basicDisabled) {
      event.preventDefault();
      return;
    }
  const dt = event.dataTransfer;
  if (!dt) return;
  dt.setData(BASIC_TOKEN_MIME, JSON.stringify({ source: 'palette', kind: 'column', column } satisfies DragPayload));
  dt.setData('text/plain', column);
  dt.effectAllowed = 'copy';
    setBasicDragActive(true);
  }, [basicDisabled]);

  const handleCustomDragStart = useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    if (basicDisabled) {
      event.preventDefault();
      return;
    }
  const dt = event.dataTransfer;
  if (!dt) return;
  dt.setData(BASIC_TOKEN_MIME, JSON.stringify({ source: 'palette', kind: 'custom' } satisfies DragPayload));
  dt.setData('text/plain', 'Custom token');
  dt.effectAllowed = 'copy';
    setBasicDragActive(true);
  }, [basicDisabled]);

  const handleExistingTokenDragStart = useCallback((event: React.DragEvent<HTMLDivElement>, tokenId: string) => {
    if (basicDisabled) {
      event.preventDefault();
      return;
    }
    if (editingTokenId) {
      finishCustomEdit(true);
    }
  const dt = event.dataTransfer;
  if (!dt) return;
  dt.setData(BASIC_TOKEN_MIME, JSON.stringify({ source: 'existing', id: tokenId } satisfies DragPayload));
  dt.setData('text/plain', 'Column token');
  dt.effectAllowed = 'move';
    setBasicDragActive(true);
  }, [basicDisabled, editingTokenId, finishCustomEdit]);

  const handleExistingTokenDragEnd = useCallback(() => {
    setBasicDragActive(false);
    setDropIndicator(null);
  }, []);

  const handleTokenDragOver = useCallback((tokenId: string, event: React.DragEvent<HTMLDivElement>) => {
    if (basicDisabled) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const isBefore = event.clientX < rect.left + rect.width / 2;
    setDropIndicator({ tokenId, position: isBefore ? 'before' : 'after' });
  }, [basicDisabled]);

  const handleBuilderDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (basicDisabled) return;
    event.preventDefault();
    setBasicDragActive(true);
  }, [basicDisabled]);

  const handleBuilderDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!dropZoneRef.current) return;
    const related = event.relatedTarget as Node | null;
    if (related && dropZoneRef.current.contains(related)) return;
    setBasicDragActive(false);
    setDropIndicator(null);
  }, []);

  const handleBuilderDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (basicDisabled) return;
    event.preventDefault();
    setBasicDragActive(false);
    const payload = parseDragPayload(event);
    const indicator = dropIndicator;
    setDropIndicator(null);
    if (!payload) return;
    let insertIndex = basicTokens.length;
    if (indicator) {
      const targetIdx = basicTokens.findIndex((token) => token.id === indicator.tokenId);
      if (targetIdx !== -1) {
        insertIndex = indicator.position === 'before' ? targetIdx : targetIdx + 1;
      }
    }

    if (payload.source === 'palette') {
      if (payload.kind === 'column') {
        addColumnToken(payload.column, insertIndex);
      } else if (payload.kind === 'custom') {
        addCustomToken(insertIndex);
      }
      return;
    }

    if (payload.source === 'existing') {
      moveBasicToken(payload.id, insertIndex);
    }
  }, [basicDisabled, dropIndicator, basicTokens, addColumnToken, addCustomToken, moveBasicToken]);

  const handleApply = useCallback(async () => {
    const currentExpression = latestExpressionRef.current.trim();
    if (!activeNodeId || currentExpression.length === 0) return;
    setApplyLoading(true);
    setPreviewError(null);
    try {
      const payload = buildRequest();
      const response = await computeColumn(activeNodeId, payload);
      setLastAppliedExpression(response.expression);
      onAlert(response.message || `Added column ${response.column_name}`);
      void refreshNodeSchema(activeNodeId);
      await handlePreview();
    } catch (error) {
      setPreviewError(getErrorMessage(error));
    } finally {
      setApplyLoading(false);
    }
  }, [activeNodeId, buildRequest, computeColumn, onAlert, refreshNodeSchema, handlePreview]);

  const renderPreview = () => {
    if (previewLoading) {
      return (
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Calculating preview…
        </div>
      );
    }

    if (previewError) {
      return (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {previewError}
        </div>
      );
    }

    if (!previewData) {
      return (
        <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 p-4 text-sm text-muted-foreground">
          Configure an expression and exit the field to see the computed column preview inline before applying.
        </div>
      );
    }

    const columns = previewData.columns;
    const rows = previewData.data;

    return (
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                {columns.map((col) => (
                  <TableHead key={col} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {col}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    No rows produced by this expression.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, idx) => (
                  <TableRow key={idx}>
                    {columns.map((col) => (
                      <TableCell key={`${idx}-${col}`} className="px-3 py-2 font-mono text-xs text-foreground">
                        {String(row?.[col] ?? '')}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  };

  const currentExpressionMatchesApplied = lastAppliedExpression && lastAppliedExpression === trimmedExpression;

  const handleExpressionChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    setExpressionAndMarkDirty(next);
    setBasicTokens([]);
    setEditingTokenId(null);
    setDropIndicator(null);
    setBasicDragActive(false);
    setCustomDraft('');
  }, [setExpressionAndMarkDirty]);

  const handleColumnNameChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    latestColumnNameRef.current = next;
    setColumnName(next);
    if (trimmedExpression.length === 0) {
      setPreviewStale(false);
      return;
    }
    setPreviewStale(true);
  }, [trimmedExpression]);

  const handleExpressionBlur = useCallback(() => {
    setExpressionFocused(false);
    requestPreview();
  }, [requestPreview]);

  const handleColumnBlur = useCallback(() => {
    setColumnNameFocused(false);
    requestPreview();
  }, [requestPreview]);

  const handleExpressionFocus = useCallback(() => {
    setExpressionFocused(true);
  }, []);

  const handleColumnFocus = useCallback(() => {
    setColumnNameFocused(true);
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Computed Column Builder
          </CardTitle>
          <CardDescription>
            Combine existing columns with Polars-style expressions. The result is added to the selected node using `with_columns`.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <NodeSelectionPanel
            selectedNodes={effectiveSelectedNodes}
            nodeColumnSelections={nodeColumnSelections}
            onColumnChange={() => undefined}
            nodeColors={nodeColors}
            onColorChange={() => undefined}
            defaultPalette={DEFAULT_PALETTE}
            maxCompare={1}
            className="rounded-lg border border-border/60 bg-muted/40 pt-0"
            showColorPicker={false}
            showColumnPicker={false}
            originalCount={selectedNodes?.length ?? 0}
            getNodeShapeFn={getNodeShape}
            disabled={isLoading.operations}
            showShape
          />

          <Separator />

          <Tabs
            value={expressionMode}
            onValueChange={(value) => setExpressionMode(value as 'basic' | 'advanced')}
            className="space-y-4"
          >
            <TabsList className="flex max-w-md gap-2">
              <TabsTrigger value="basic">Basic</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-4">
              <div className="rounded-md border border-blue-200 bg-blue-50/80 p-4 text-sm text-blue-800 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-100">
                <div className="flex items-start gap-2">
                  <Lightbulb className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium">How it works</p>
                    <ul className="list-disc space-y-1 pl-5">
                      <li>Drag column bubbles into the builder to add them to the equation.</li>
                      <li>Add the Custom Text bubble for operators or literals, then click it to edit.</li>
                      <li>The builder concatenates tokens with <code>+</code> automatically, quoting custom text.</li>
                      <li>Reorder any bubble by dragging it before or after an existing one.</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium text-foreground">Available tokens</span>
                {availableColumns.length > 0 ? (
                  <div className={cn('flex flex-wrap gap-2', basicDisabled && 'pointer-events-none opacity-60')}>
                    {availableColumns.map((column) => (
                      <button
                        key={column}
                        type="button"
                        draggable={!basicDisabled}
                        onDragStart={(event) => handleColumnDragStart(event, column)}
                        onDragEnd={() => setBasicDragActive(false)}
                        onClick={() => addColumnToken(column)}
                        className={cn(
                          'select-none rounded-full border border-border bg-foreground px-3 py-1 text-sm text-background shadow-sm transition',
                          basicDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-grab active:cursor-grabbing'
                        )}
                      >
                        {column}
                      </button>
                    ))}
                    <button
                      type="button"
                      draggable={!basicDisabled}
                      onDragStart={handleCustomDragStart}
                      onDragEnd={() => setBasicDragActive(false)}
                      onClick={() => addCustomToken()}
                      className={cn(
                        'select-none rounded-full border border-border bg-background px-3 py-1 text-sm text-foreground shadow-sm transition',
                        basicDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-grab active:cursor-grabbing'
                      )}
                    >
                      Custom Text
                    </button>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-muted-foreground/50 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                    Column names will appear here once schema metadata loads.
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium text-foreground">Builder</span>
                <div
                  ref={dropZoneRef}
                  onDragEnter={handleBuilderDragOver}
                  onDragOver={handleBuilderDragOver}
                  onDragLeave={handleBuilderDragLeave}
                  onDrop={handleBuilderDrop}
                  className={cn(
                    'min-h-[92px] rounded-md border border-dashed border-muted-foreground/50 bg-muted/30 p-4 transition',
                    basicDragActive && 'border-primary bg-primary/5',
                    basicDisabled && 'pointer-events-none opacity-60'
                  )}
                >
                  {basicTokens.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {manualExpressionActive ? (
                        <>
                          Expression currently defined via Advanced editor:&nbsp;
                          <code className="rounded bg-background px-2 py-1 font-mono text-xs text-foreground">{trimmedExpression}</code>
                        </>
                      ) : (
                        'Drag columns or custom text here to build an expression. Tokens snap into place as you drop them.'
                      )}
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      {basicTokens.map((token) => {
                        const isCustom = token.kind === 'custom';
                        const isEditing = editingTokenId === token.id;
                        const showBefore = dropIndicator?.tokenId === token.id && dropIndicator.position === 'before';
                        const showAfter = dropIndicator?.tokenId === token.id && dropIndicator.position === 'after';
                        return (
                          <div key={token.id} className="flex items-center gap-1">
                            {showBefore && <span className="h-8 w-0.5 rounded bg-primary" aria-hidden="true" />}
                            <div
                              className={cn(
                                'group relative flex items-center',
                                basicDisabled && 'opacity-70'
                              )}
                              draggable={!basicDisabled && !isEditing}
                              onDragStart={(event) => handleExistingTokenDragStart(event, token.id)}
                              onDragEnd={handleExistingTokenDragEnd}
                              onDragOver={(event) => handleTokenDragOver(token.id, event)}
                            >
                              <div
                                className={cn(
                                  'flex min-h-[34px] items-center gap-2 rounded-full border border-border bg-foreground px-3 py-1 text-sm text-background shadow-sm transition',
                                  !basicDisabled && !isEditing && 'cursor-grab active:cursor-grabbing'
                                )}
                              >
                                {isCustom ? (
                                  isEditing ? (
                                    <Input
                                      value={customDraft}
                                      onChange={handleCustomDraftChange}
                                      onBlur={() => finishCustomEdit(true)}
                                      onKeyDown={handleCustomInputKeyDown}
                                      autoFocus
                                      className="h-7 w-32 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground shadow-none focus-visible:ring-0"
                                    />
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => startEditingCustomToken(token.id)}
                                      className="text-sm font-medium tracking-tight text-background transition hover:text-background/80"
                                    >
                                      {token.value || '""'}
                                    </button>
                                  )
                                ) : (
                                  <span className="font-medium">{token.column}</span>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => removeBasicToken(token.id)}
                                className="absolute -top-1.5 -right-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-[10px] font-semibold text-muted-foreground opacity-0 transition hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                                aria-label="Remove token"
                                disabled={basicDisabled}
                                onMouseDown={(event) => event.stopPropagation()}
                              >
                                <span aria-hidden="true">x</span>
                              </button>
                            </div>
                            {showAfter && <span className="h-8 w-0.5 rounded bg-primary" aria-hidden="true" />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium text-foreground">Expression preview</span>
                <div className="rounded-md border border-muted-foreground/50 bg-muted/30 px-3 py-2 font-mono text-sm text-muted-foreground">
                  {basicExpressionPreview.length > 0 ? basicExpressionPreview : '—'}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={clearBasicBuilder}
                  disabled={basicDisabled || (basicTokens.length === 0 && trimmedExpression.length === 0)}
                >
                  Clear Builder
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="advanced" className="space-y-4">
              <div className="rounded-md border border-blue-200 bg-blue-50/80 p-4 text-sm text-blue-800 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-100">
                <div className="flex items-start gap-2">
                  <Lightbulb className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium">Expression tips</p>
                    <ul className="list-disc space-y-1 pl-5">
                      <li>Use column names directly (`A`) or wrap spaced names in quotes (`&quot;Total Count&quot;`).</li>
                      <li>Combine with helpers like `abs()`, `round(value, 2)`, `when(condition, then, otherwise)`, `coalesce(a, b)`.</li>
                      <li>Call `lit(&quot;value&quot;)` to force a literal string when it matches an existing column name.</li>
                    </ul>
                  </div>
                </div>
              </div>

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-foreground">Expression</span>
                <textarea
                  value={expression}
                  onChange={handleExpressionChange}
                  onBlur={handleExpressionBlur}
                  onFocus={handleExpressionFocus}
                  rows={3}
                  placeholder='Examples: A + B, when(A > 0, A, 0), A / lit(100)'
                  className={cn(
                    'w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm shadow-sm',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  )}
                  disabled={!hasSelection || isLoading.operations}
                />
              </label>
            </TabsContent>
          </Tabs>

          <div className="space-y-4">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">New column name (optional)</span>
              <Input
                value={columnName}
                onChange={handleColumnNameChange}
                onBlur={handleColumnBlur}
                onFocus={handleColumnFocus}
                placeholder="Defaults to the expression string"
                disabled={!hasSelection || isLoading.operations}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={handleApply}
              disabled={!canApply}
            >
              {applyLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding…
                </>
              ) : (
                'Add to Node'
              )}
            </Button>
            {(previewLoading || expressionFocused || columnNameFocused || editingTokenId !== null || basicDragActive) && (
              <span className="text-sm text-muted-foreground">Preview updates after you finish editing tokens or exit the fields.</span>
            )}
            {previewStale && !previewLoading && !expressionFocused && !columnNameFocused && editingTokenId === null && !basicDragActive && (
              <span className="text-sm text-muted-foreground">Preview is out of date; it will refresh automatically.</span>
            )}
            {currentExpressionMatchesApplied && !previewLoading && !previewError && (
              <span className="text-sm text-muted-foreground">Latest expression already applied.</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>
            Shows up to {DEFAULT_PREVIEW_LIMIT} rows with the computed column appended. Preview refreshes after each apply.
          </CardDescription>
        </CardHeader>
        <CardContent>{renderPreview()}</CardContent>
      </Card>
    </div>
  );
};
