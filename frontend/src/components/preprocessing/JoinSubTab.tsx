import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { nodesApi } from '../../api/nodes';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import NodeSelectionPanel, { NodeColumnSelection, WorkspaceNodeLike } from '../NodeSelectionPanel';
import { PreviewTable } from './PreviewTable';
import type { JoinType, JoinPreviewRequestSignature, PreviewPagination, PreviewRow } from './types';
import { JOIN_TYPE_OPTIONS } from './types';

interface JoinSubTabProps {
  selectedNodeIds: string[];
  currentWorkspaceId: string | null;
  workspaceNodes: WorkspaceNodeLike[];
  getNodeShape: (nodeId: string) => Promise<{ shape: [number, number]; is_lazy: boolean; calculated: boolean } | null>;
  joinNodes: (
    leftNodeId: string,
    rightNodeId: string,
    joinType: JoinType,
    leftColumns: string[],
    rightColumns: string[],
    newNodeName?: string
  ) => Promise<void>;
  isLoading: {
    operations: boolean;
  };
  onAlert: (message: string) => void;
}

export const JoinSubTab: React.FC<JoinSubTabProps> = ({
  selectedNodeIds,
  currentWorkspaceId,
  workspaceNodes,
  getNodeShape,
  joinNodes,
  isLoading,
  onAlert,
}) => {
  const [joinLeftNodeId, setJoinLeftNodeId] = useState('');
  const [joinRightNodeId, setJoinRightNodeId] = useState('');
  const [joinLeftColumn, setJoinLeftColumn] = useState('');
  const [joinRightColumn, setJoinRightColumn] = useState('');
  const [joinType, setJoinType] = useState<JoinType>('inner');
  const [joinNewNodeName, setJoinNewNodeName] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [joinPreviewPage, setJoinPreviewPage] = useState(1);
  const [joinPreviewPageSize, setJoinPreviewPageSize] = useState(10);
  const [joinPreviewData, setJoinPreviewData] = useState<PreviewRow[]>([]);
  const [joinPreviewColumns, setJoinPreviewColumns] = useState<string[]>([]);
  const [joinPreviewPagination, setJoinPreviewPagination] = useState<PreviewPagination | null>(null);
  const [joinPreviewLoading, setJoinPreviewLoading] = useState(false);
  const [joinPreviewError, setJoinPreviewError] = useState<string | null>(null);
  const [joinDebouncedRequest, setJoinDebouncedRequest] = useState<JoinPreviewRequestSignature | null>(null);
  const joinNameAutofillRef = useRef<string>('');

  const deriveNodeLabel = useCallback((node: WorkspaceNodeLike | null | undefined): string => {
    if (!node) return '';
    const data = (node?.data ?? {}) as Record<string, unknown>;
    return (
      (node as Record<string, unknown>).name as string | undefined ??
      (data.nodeName as string | undefined) ??
      (data.label as string | undefined) ??
      ((node as Record<string, unknown>).label as string | undefined) ??
      (node.id as string | undefined) ??
      ((node as Record<string, unknown>).node_id as string | undefined) ??
      ''
    );
  }, []);

  const workspaceNodeMap = useMemo(() => {
    const map = new Map<string, WorkspaceNodeLike>();
    workspaceNodes.forEach((node: WorkspaceNodeLike) => {
      const key = (node.id as string | undefined) ?? ((node as Record<string, unknown>).node_id as string | undefined);
      if (key) {
        map.set(key, node);
      }
    });
    return map;
  }, [workspaceNodes]);

  const joinLeftNode = joinLeftNodeId ? workspaceNodeMap.get(joinLeftNodeId) : undefined;
  const joinRightNode = joinRightNodeId ? workspaceNodeMap.get(joinRightNodeId) : undefined;

  const joinNeedsColumns = joinType !== 'cross';

  const getNodeColumnsForJoin = useCallback((nodeId: string): string[] => {
    const node = workspaceNodeMap.get(nodeId);
    if (!node) return [];
    const data = (node.data ?? {}) as Record<string, unknown>;
    if (Array.isArray(data.columns)) {
      return (data.columns as unknown[]).map((entry) => String(entry));
    }
    if (data.dtypes && typeof data.dtypes === 'object') {
      return Object.keys(data.dtypes as Record<string, unknown>);
    }
    if (data.schema && typeof data.schema === 'object') {
      return Object.keys(data.schema as Record<string, unknown>);
    }
    return [];
  }, [workspaceNodeMap]);

  const joinDefaultPalette = useMemo(
    () => ['#2563eb', '#dc2626', '#16a34a', '#f97316', '#d946ef', '#0ea5e9'],
    [],
  );

  const joinNodeSelections = useMemo<NodeColumnSelection[]>(() => {
    const selections: NodeColumnSelection[] = [];
    if (joinLeftNodeId) {
      selections.push({ nodeId: joinLeftNodeId, column: joinLeftColumn });
    }
    if (joinRightNodeId && joinRightNodeId !== joinLeftNodeId) {
      selections.push({ nodeId: joinRightNodeId, column: joinRightColumn });
    }
    return selections;
  }, [joinLeftNodeId, joinLeftColumn, joinRightNodeId, joinRightColumn]);

  const joinNodeColors = useMemo(() => {
    const colors: Record<string, string> = {};
    if (joinLeftNodeId) colors[joinLeftNodeId] = '#2563eb';
    if (joinRightNodeId) colors[joinRightNodeId] = '#dc2626';
    return colors;
  }, [joinLeftNodeId, joinRightNodeId]);

  const getNodeKeyFromNode = useCallback((node: WorkspaceNodeLike): string => {
    return (
      (node.id as string | undefined) ??
      (node.node_id as string | undefined) ??
      ((node.data as Record<string, unknown> | undefined)?.id as string | undefined) ??
      ((node.data as Record<string, unknown> | undefined)?.node_id as string | undefined) ??
      ''
    );
  }, []);

  const joinSelectedNodesForPanel = useMemo<WorkspaceNodeLike[]>(() => {
    const nodes: WorkspaceNodeLike[] = [];
    selectedNodeIds.slice(0, 2).forEach((nodeId) => {
      const node = workspaceNodeMap.get(nodeId);
      if (node) {
        nodes.push(node);
      }
    });
    return nodes;
  }, [selectedNodeIds, workspaceNodeMap]);

  const joinConfigReady = Boolean(
    joinLeftNode &&
    joinRightNode &&
    joinLeftNodeId &&
    joinRightNodeId &&
    joinLeftNodeId !== joinRightNodeId &&
    (!joinNeedsColumns || (joinLeftColumn && joinRightColumn))
  );

  const joinPreviewReady = joinConfigReady;

  const joinPreviewColumnsToRender = useMemo(() => {
    if (joinPreviewColumns.length > 0) return joinPreviewColumns;
    if (joinPreviewData.length > 0 && typeof joinPreviewData[0] === 'object' && joinPreviewData[0] !== null) {
      return Object.keys(joinPreviewData[0]);
    }
    return [];
  }, [joinPreviewColumns, joinPreviewData]);

  const joinPreviewCurrentPage = joinPreviewPagination?.page ?? joinPreviewPage;

  const joinSharedColumns = useMemo(() => {
    if (!joinLeftNodeId || !joinRightNodeId) return [] as string[];
    const leftColumns = getNodeColumnsForJoin(joinLeftNodeId);
    const rightColumns = getNodeColumnsForJoin(joinRightNodeId);
    return leftColumns.filter((column) => rightColumns.includes(column));
  }, [joinLeftNodeId, joinRightNodeId, getNodeColumnsForJoin]);

  const joinConfigIssues = useMemo(() => {
    if (!joinLeftNodeId || !joinRightNodeId) {
      return 'Pick two nodes to configure a join.';
    }
    if (joinLeftNodeId === joinRightNodeId) {
      return 'Select two different nodes to join—joining a node to itself is not supported yet.';
    }
    if (joinNeedsColumns && (!joinLeftColumn || !joinRightColumn)) {
      return 'Choose the columns that should match between the two nodes.';
    }
    if (joinNeedsColumns && joinSharedColumns.length === 0) {
      return 'No matching column names detected. Select compatible columns manually or rename them to match.';
    }
    return '';
  }, [joinLeftNodeId, joinRightNodeId, joinNeedsColumns, joinLeftColumn, joinRightColumn, joinSharedColumns]);

  const joinStatusMessage = useMemo(() => {
    if (joinConfigReady) {
      if (joinNeedsColumns) {
        return `Ready to join ${deriveNodeLabel(joinLeftNode)} and ${deriveNodeLabel(joinRightNode)} on ${joinLeftColumn} = ${joinRightColumn}.`;
      }
      return `Ready to run a ${joinType} join between ${deriveNodeLabel(joinLeftNode)} and ${deriveNodeLabel(joinRightNode)}.`;
    }
    return joinConfigIssues || 'Configure the join to preview results.';
  }, [joinConfigReady, joinNeedsColumns, joinLeftNode, joinRightNode, joinLeftColumn, joinRightColumn, joinType, deriveNodeLabel, joinConfigIssues]);

  const currentJoinTypeInfo = useMemo(() => JOIN_TYPE_OPTIONS.find((option) => option.value === joinType), [joinType]);

  const handleJoinColorChange = useCallback(() => undefined, []);

  const handleJoinColumnChange = useCallback((nodeId: string, column: string) => {
    if (nodeId === joinLeftNodeId) {
      setJoinLeftColumn(column);
    } else if (nodeId === joinRightNodeId) {
      setJoinRightColumn(column);
    }
  }, [joinLeftNodeId, joinRightNodeId]);

  const handleJoinPreviewPrev = useCallback(() => {
    if (joinPreviewPagination?.has_prev && !joinPreviewLoading) {
      setJoinPreviewPage((prev) => Math.max(1, prev - 1));
    }
  }, [joinPreviewPagination, joinPreviewLoading]);

  const handleJoinPreviewNext = useCallback(() => {
    if (joinPreviewPagination?.has_next && !joinPreviewLoading) {
      setJoinPreviewPage((prev) => prev + 1);
    }
  }, [joinPreviewPagination, joinPreviewLoading]);

  const handleJoinPreviewPageSizeChange = useCallback((size: number) => {
    if (!Number.isNaN(size)) {
      setJoinPreviewPageSize(size);
      setJoinPreviewPage(1);
    }
  }, []);

  const autoJoinName = useMemo(() => {
    if (!joinLeftNodeId || !joinRightNodeId || joinLeftNodeId === joinRightNodeId) return '';
    const leftName = deriveNodeLabel(joinLeftNode);
    const rightName = deriveNodeLabel(joinRightNode);
    if (!leftName || !rightName) return '';
    return `${leftName}_${joinType}_join_${rightName}`.replace(/\s+/g, '_');
  }, [joinLeftNodeId, joinRightNodeId, joinLeftNode, joinRightNode, joinType, deriveNodeLabel]);

  useEffect(() => {
    joinNameAutofillRef.current = autoJoinName || '';
  }, [autoJoinName]);

  useEffect(() => {
    const nextLeft = selectedNodeIds[0] ?? '';
    const nextRight = selectedNodeIds[1] ?? '';

    setJoinLeftNodeId((prev) => (prev === nextLeft ? prev : nextLeft));
    setJoinRightNodeId((prev) => (prev === nextRight ? prev : nextRight));
  }, [selectedNodeIds]);

  useEffect(() => {
    if (joinType === 'cross') {
      setJoinLeftColumn('');
      setJoinRightColumn('');
      return;
    }
    const leftColumns = joinLeftNodeId ? getNodeColumnsForJoin(joinLeftNodeId) : [];
    const rightColumns = joinRightNodeId ? getNodeColumnsForJoin(joinRightNodeId) : [];
    if (!leftColumns.length || !rightColumns.length) {
      setJoinLeftColumn('');
      setJoinRightColumn('');
      return;
    }
    const common = leftColumns.filter((column) => rightColumns.includes(column));
    setJoinLeftColumn((prev) => (prev && leftColumns.includes(prev) ? prev : common[0] ?? leftColumns[0] ?? ''));
    setJoinRightColumn((prev) => (prev && rightColumns.includes(prev) ? prev : common[0] ?? rightColumns[0] ?? ''));
  }, [joinLeftNodeId, joinRightNodeId, joinType, getNodeColumnsForJoin]);

  useEffect(() => {
    setJoinPreviewPage(1);
  }, [joinLeftNodeId, joinRightNodeId, joinLeftColumn, joinRightColumn, joinType]);

  const joinPreviewParams = useMemo<JoinPreviewRequestSignature | null>(() => {
    if (!joinPreviewReady) return null;
    return {
      leftNodeId: joinLeftNodeId,
      rightNodeId: joinRightNodeId,
      leftOn: joinNeedsColumns ? joinLeftColumn : undefined,
      rightOn: joinNeedsColumns ? joinRightColumn : undefined,
      joinType,
      page: joinPreviewPage,
      pageSize: joinPreviewPageSize,
    };
  }, [joinPreviewReady, joinLeftNodeId, joinRightNodeId, joinNeedsColumns, joinLeftColumn, joinRightColumn, joinType, joinPreviewPage, joinPreviewPageSize]);

  useEffect(() => {
    if (!joinPreviewParams) {
      setJoinDebouncedRequest(null);
      setJoinPreviewData([]);
      setJoinPreviewColumns([]);
      setJoinPreviewPagination(null);
      setJoinPreviewError(null);
      setJoinPreviewLoading(false);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setJoinDebouncedRequest(joinPreviewParams);
    }, 600);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [joinPreviewParams]);

  useEffect(() => {
    if (!joinDebouncedRequest || !currentWorkspaceId) return;

    let cancelled = false;
    setJoinPreviewLoading(true);
    setJoinPreviewError(null);

    nodesApi.joinPreview(
      currentWorkspaceId,
      {
        left_node_id: joinDebouncedRequest.leftNodeId,
        right_node_id: joinDebouncedRequest.rightNodeId,
        left_on: joinDebouncedRequest.leftOn,
        right_on: joinDebouncedRequest.rightOn,
        how: joinDebouncedRequest.joinType,
      },
      joinDebouncedRequest.page,
      joinDebouncedRequest.pageSize,
    )
      .then((resp) => {
        if (cancelled) return;
        const rows: PreviewRow[] = Array.isArray(resp?.data) ? (resp.data as PreviewRow[]) : [];
        const cols = Array.isArray(resp?.columns) ? resp.columns : [];
        setJoinPreviewData(rows);
        setJoinPreviewColumns(cols);
        if (resp?.pagination) {
          setJoinPreviewPagination(resp.pagination);
          if (resp.pagination.page && resp.pagination.page !== joinPreviewPage) {
            setJoinPreviewPage(resp.pagination.page);
          }
        } else {
          setJoinPreviewPagination(null);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Failed to load join preview data';
        setJoinPreviewError(message);
        setJoinPreviewData([]);
        setJoinPreviewColumns([]);
        setJoinPreviewPagination(null);
      })
      .finally(() => {
        if (!cancelled) {
          setJoinPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [joinDebouncedRequest, currentWorkspaceId, joinPreviewPage]);

  const handleApplyJoin = useCallback(async () => {
    if (!joinConfigReady) {
      onAlert('Please select two different nodes and matching columns to join.');
      return;
    }
    const leftColumns = joinNeedsColumns ? [joinLeftColumn] : [];
    const rightColumns = joinNeedsColumns ? [joinRightColumn] : [];
    const requestedName = joinNewNodeName.trim() || joinNameAutofillRef.current || undefined;
    try {
      setIsJoining(true);
      await joinNodes(joinLeftNodeId, joinRightNodeId, joinType, leftColumns, rightColumns, requestedName);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error applying join';
      onAlert(`Error applying join: ${message}`);
    } finally {
      setIsJoining(false);
    }
  }, [joinConfigReady, joinNeedsColumns, joinLeftColumn, joinRightColumn, joinNewNodeName, joinLeftNodeId, joinRightNodeId, joinType, joinNodes, onAlert]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>Join datasets</CardTitle>
              <CardDescription>
                Combine two workspace nodes using relational joins and preview the result before committing it to the graph.
              </CardDescription>
            </div>
            {(isJoining || isLoading.operations) && (
              <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Joining…
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-0">
          <p className="text-sm text-muted-foreground">
            Select up to two nodes in the workspace (Shift/⌘-click) to configure a join. Column pickers will appear below for the current selection.
          </p>

          {joinConfigIssues && !joinConfigReady && (
            <div className="rounded-md border border-amber-500/50 bg-amber-100/60 p-3 text-sm text-amber-900">
              {joinConfigIssues}
            </div>
          )}

          <NodeSelectionPanel
            selectedNodes={joinSelectedNodesForPanel}
            nodeColumnSelections={joinNodeSelections}
            onColumnChange={handleJoinColumnChange}
            nodeColors={joinNodeColors}
            onColorChange={handleJoinColorChange}
            getNodeColumns={(node) => {
              const key = getNodeKeyFromNode(node);
              return key ? getNodeColumnsForJoin(key) : [];
            }}
            defaultPalette={joinDefaultPalette}
            maxCompare={2}
            className="rounded-lg border border-border/60 bg-muted/40"
            showColorPicker={false}
            showHeaderLabel
            showShape
            getNodeShapeFn={getNodeShape}
            disabled={joinSelectedNodesForPanel.length < 2}
            originalCount={selectedNodeIds.length > 2 ? selectedNodeIds.length : undefined}
            columnLabelFn={(node) => {
              const nodeId = getNodeKeyFromNode(node);
              if (nodeId === joinLeftNodeId) return 'Left column:';
              if (nodeId === joinRightNodeId) return 'Right column:';
              return 'Join column:';
            }}
          />

          {joinNeedsColumns && joinLeftNodeId && joinRightNodeId && joinLeftNodeId !== joinRightNodeId && (
            <div className="text-xs text-muted-foreground">
              {joinSharedColumns.length > 0
                ? `Found ${joinSharedColumns.length} shared column${joinSharedColumns.length === 1 ? '' : 's'} (${joinSharedColumns.slice(0, 4).join(', ')}${joinSharedColumns.length > 4 ? ', …' : ''}).`
                : 'No matching column names detected. Select compatible columns manually.'}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="join-type">Join type</Label>
              <Select value={joinType} onValueChange={(value) => setJoinType(value as JoinType)}>
                <SelectTrigger id="join-type">
                  <SelectValue placeholder="Select join type" />
                </SelectTrigger>
                <SelectContent>
                  {JOIN_TYPE_OPTIONS.map((option: { value: JoinType; description: string }) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {currentJoinTypeInfo && (
                <p className="text-xs text-muted-foreground">{currentJoinTypeInfo.description}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="join-new-node-name">New node name</Label>
              <Input
                id="join-new-node-name"
                value={joinNewNodeName}
                placeholder={autoJoinName || 'Joined dataset'}
                onChange={(event) => setJoinNewNodeName(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">Leave blank to use the suggested name shown in gray.</p>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3 border-t pt-4 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-muted-foreground">{joinStatusMessage}</div>
          <Button
            type="button"
            onClick={handleApplyJoin}
            disabled={!joinConfigReady || !currentWorkspaceId || isJoining || isLoading.operations}
          >
            {isJoining ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Joining…
              </>
            ) : (
              'Add to Workspace'
            )}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>Preview join output</CardTitle>
              <CardDescription>Inspect a sample of the joined rows before creating the node.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          {joinType === 'cross' && joinPreviewReady && (
            <div className="rounded-md border border-amber-500/50 bg-amber-100/60 p-3 text-xs text-amber-900">
              Cross joins can create very large outputs. The preview only displays {joinPreviewPageSize} rows at a time.
            </div>
          )}

          <PreviewTable
            title=""
            description=""
            columns={joinPreviewColumnsToRender}
            data={joinPreviewData}
            pagination={joinPreviewPagination}
            loading={joinPreviewLoading}
            error={joinPreviewError}
            ready={joinPreviewReady}
            readyMessage={joinConfigIssues || 'Select two nodes and configure the join to view a preview.'}
            page={joinPreviewCurrentPage}
            pageSize={joinPreviewPageSize}
            onPageSizeChange={handleJoinPreviewPageSizeChange}
            onPreviousPage={handleJoinPreviewPrev}
            onNextPage={handleJoinPreviewNext}
            loadingBadge={joinPreviewLoading ? (
              <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading preview…
              </span>
            ) : null}
          />
        </CardContent>
      </Card>
    </div>
  );
};
