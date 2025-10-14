import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import NodeSelectionPanel, { NodeColumnSelection, WorkspaceNodeLike } from '../NodeSelectionPanel';
import { PreviewTable } from './PreviewTable';
import type { ConcatNodeSummary, ConcatSchemaAnalysis, ConcatPreviewRequestSignature, PreviewPagination, PreviewRow } from './types';
import { MAX_CONCAT_NODES } from './types';

interface ConcatSubTabProps {
  selectedNodeIds: string[];
  currentWorkspaceId: string | null;
  workspaceNodes: WorkspaceNodeLike[];
  getNodeShape: (nodeId: string) => Promise<{ shape: [number, number]; is_lazy: boolean; calculated: boolean } | null>;
  concatNodes: (nodeIds: string[], newNodeName?: string) => Promise<void>;
  concatPreview: (nodeIds: string[], page: number, pageSize: number) => Promise<{
    data: PreviewRow[];
    columns: string[];
    pagination: PreviewPagination | null;
  }>;
  isLoading: {
    operations: boolean;
  };
  onAlert: (message: string) => void;
}

export const ConcatSubTab: React.FC<ConcatSubTabProps> = ({
  selectedNodeIds,
  currentWorkspaceId,
  workspaceNodes,
  getNodeShape,
  concatNodes,
  concatPreview,
  isLoading,
  onAlert,
}) => {
  const [concatNewNodeName, setConcatNewNodeName] = useState('');
  const [isConcatenating, setIsConcatenating] = useState(false);
  const [concatPreviewPage, setConcatPreviewPage] = useState(1);
  const [concatPreviewPageSize, setConcatPreviewPageSize] = useState(10);
  const [concatPreviewData, setConcatPreviewData] = useState<PreviewRow[]>([]);
  const [concatPreviewColumns, setConcatPreviewColumns] = useState<string[]>([]);
  const [concatPreviewPagination, setConcatPreviewPagination] = useState<PreviewPagination | null>(null);
  const [concatPreviewLoading, setConcatPreviewLoading] = useState(false);
  const [concatPreviewError, setConcatPreviewError] = useState<string | null>(null);
  const [concatDebouncedRequest, setConcatDebouncedRequest] = useState<ConcatPreviewRequestSignature | null>(null);
  const concatNameAutofillRef = useRef<string>('');

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

  const getNodeKeyFromNode = useCallback((node: WorkspaceNodeLike): string => {
    return (
      (node.id as string | undefined) ??
      (node.node_id as string | undefined) ??
      ((node.data as Record<string, unknown> | undefined)?.id as string | undefined) ??
      ((node.data as Record<string, unknown> | undefined)?.node_id as string | undefined) ??
      ''
    );
  }, []);

  const uniqueConcatNodeIds = useMemo(() => {
    const seen = new Set<string>();
    return selectedNodeIds.filter((nodeId) => {
      if (!nodeId || seen.has(nodeId)) return false;
      seen.add(nodeId);
      return true;
    });
  }, [selectedNodeIds]);

  const concatNodeIds = useMemo(() => uniqueConcatNodeIds.slice(0, MAX_CONCAT_NODES), [uniqueConcatNodeIds]);
  const concatOriginalCount = uniqueConcatNodeIds.length;

  const concatSelectedNodes = useMemo<WorkspaceNodeLike[]>(() => {
    return concatNodeIds
      .map((nodeId) => workspaceNodeMap.get(nodeId))
      .filter((node): node is WorkspaceNodeLike => Boolean(node));
  }, [concatNodeIds, workspaceNodeMap]);

  const concatNodeSummaries = useMemo<ConcatNodeSummary[]>(() => {
    return concatSelectedNodes.map((node) => {
      const nodeId = getNodeKeyFromNode(node);
      const displayName = deriveNodeLabel(node) || nodeId;
      const data = (node.data ?? {}) as Record<string, unknown>;

      let columns: string[] = [];
      if (Array.isArray(data.columns)) {
        columns = (data.columns as unknown[]).map((entry) => String(entry));
      }

      let rawDtypes: Record<string, string> = {};
      if (data.dtypes && typeof data.dtypes === 'object') {
        rawDtypes = Object.entries(data.dtypes as Record<string, unknown>).reduce<Record<string, string>>((acc, [col, dtype]) => {
          acc[col] = String(dtype);
          return acc;
        }, {});
      } else if (data.schema && typeof data.schema === 'object') {
        rawDtypes = Object.entries(data.schema as Record<string, unknown>).reduce<Record<string, string>>((acc, [col, dtype]) => {
          acc[col] = String(dtype);
          return acc;
        }, {});
      }

      if (!columns.length) {
        columns = Object.keys(rawDtypes);
      }

      const uniqueColumns = Array.from(new Set(columns.map((name) => String(name))));
      const normalizedColumns = [...uniqueColumns].sort((a, b) => a.localeCompare(b));
      const normalizedDtypes = normalizedColumns.reduce<Record<string, string>>((acc, column) => {
        const dtype = rawDtypes[column];
        acc[column] = dtype ? dtype.toString().toLowerCase() : '';
        return acc;
      }, {});

      return {
        nodeId,
        displayName,
        columns: uniqueColumns,
        normalizedColumns,
        dtypes: normalizedDtypes,
        rawDtypes,
        columnCount: uniqueColumns.length,
      };
    });
  }, [concatSelectedNodes, deriveNodeLabel, getNodeKeyFromNode]);

  const concatDefaultPalette = useMemo(
    () => ['#2563eb', '#dc2626', '#16a34a', '#f97316', '#d946ef', '#0ea5e9', '#f59e0b', '#14b8a6'],
    [],
  );

  const concatNodeColors = useMemo(() => {
    const colors: Record<string, string> = {};
    concatNodeIds.forEach((nodeId, index) => {
      colors[nodeId] = concatDefaultPalette[index % concatDefaultPalette.length];
    });
    return colors;
  }, [concatNodeIds, concatDefaultPalette]);

  const concatNodeSelections = useMemo<NodeColumnSelection[]>(() => (
    concatNodeIds.map((nodeId) => ({ nodeId, column: '' }))
  ), [concatNodeIds]);

  const handleConcatColumnChange = useCallback(() => undefined, []);
  const handleConcatColorChange = useCallback(() => undefined, []);

  const concatAnalysis = useMemo<ConcatSchemaAnalysis>(() => {
    const result: ConcatSchemaAnalysis = {
      summaries: concatNodeSummaries,
      ready: false,
      issues: '',
      mismatches: [],
      baseColumns: [],
      baseColumnCount: 0,
    };

    if (concatNodeSummaries.length === 0) {
      result.issues = 'Select nodes in the workspace to enable concatenation.';
      return result;
    }

    if (concatNodeSummaries.length < 2) {
      result.issues = 'Pick at least two nodes to concatenate.';
      return result;
    }

    const base = concatNodeSummaries[0];
    if (!base.normalizedColumns.length) {
      result.issues = `${base.displayName || base.nodeId} has no columns to align.`;
      return result;
    }

    result.baseColumns = base.normalizedColumns;
    result.baseColumnCount = base.normalizedColumns.length;

    const baseColumnSet = new Set(base.normalizedColumns);
    const baseDtypes = base.normalizedColumns.reduce<Record<string, string>>((acc, column) => {
      acc[column] = base.dtypes[column] ?? '';
      return acc;
    }, {});

    concatNodeSummaries.slice(1).forEach((summary) => {
      const summaryColumnSet = new Set(summary.normalizedColumns);
      const missing = Array.from(baseColumnSet).filter((column) => !summaryColumnSet.has(column));
      const extra = Array.from(summaryColumnSet).filter((column) => !baseColumnSet.has(column));
      const typeMismatches = Array.from(baseColumnSet).filter((column) => {
        if (!summaryColumnSet.has(column)) return false;
        const baseType = baseDtypes[column] ?? '';
        const summaryType = summary.dtypes[column] ?? '';
        return baseType && summaryType && baseType !== summaryType;
      });

      const details: string[] = [];
      if (missing.length) {
        details.push(`Missing columns: ${missing.sort().join(', ')}`);
      }
      if (extra.length) {
        details.push(`Extra columns: ${extra.sort().join(', ')}`);
      }
      if (typeMismatches.length) {
        const mismatchText = typeMismatches
          .sort()
          .map((column) => `${column} (${baseDtypes[column] || 'unknown'} vs ${summary.dtypes[column] || 'unknown'})`)
          .join(', ');
        details.push(`Type mismatches: ${mismatchText}`);
      }

      if (details.length) {
        result.mismatches.push({
          nodeId: summary.nodeId,
          nodeName: summary.displayName || summary.nodeId,
          details,
        });
      }
    });

    if (result.mismatches.length === 0) {
      result.ready = true;
      result.issues = `Ready to concatenate ${concatNodeSummaries.length} nodes (${result.baseColumnCount} columns).`;
    } else {
      result.issues = 'Resolve schema mismatches before concatenating.';
    }

    return result;
  }, [concatNodeSummaries]);

  const concatUsedNodeIds = useMemo(() => concatAnalysis.summaries.map((summary) => summary.nodeId), [concatAnalysis.summaries]);
  const concatUsedNodeIdsSignature = useMemo(() => concatUsedNodeIds.join('|'), [concatUsedNodeIds]);

  const concatPreviewReady = concatAnalysis.ready;

  const concatPreviewColumnsToRender = useMemo(() => {
    if (concatPreviewColumns.length > 0) return concatPreviewColumns;
    if (concatPreviewData.length > 0 && typeof concatPreviewData[0] === 'object' && concatPreviewData[0] !== null) {
      return Object.keys(concatPreviewData[0]);
    }
    return [];
  }, [concatPreviewColumns, concatPreviewData]);

  const concatPreviewCurrentPage = concatPreviewPagination?.page ?? concatPreviewPage;
  const concatStatusMessage = concatAnalysis.issues;

  const autoConcatName = useMemo(() => {
    if (!concatAnalysis.summaries.length) return '';
    const labels = concatAnalysis.summaries.map((summary) => summary.displayName || summary.nodeId).filter(Boolean);
    if (!labels.length) return '';
    if (labels.length <= 3) {
      return `Concat(${labels.join(', ')})`;
    }
    const shortened = `${labels.slice(0, 3).join(', ')}, …`;
    return `Concat(${shortened})`;
  }, [concatAnalysis.summaries]);

  useEffect(() => {
    concatNameAutofillRef.current = autoConcatName || '';
  }, [autoConcatName]);

  useEffect(() => {
    setConcatPreviewPage(1);
  }, [concatUsedNodeIdsSignature]);

  const concatPreviewParams = useMemo<ConcatPreviewRequestSignature | null>(() => {
    if (!concatPreviewReady) return null;
    return {
      nodeIds: concatUsedNodeIds,
      page: concatPreviewPage,
      pageSize: concatPreviewPageSize,
    };
  }, [concatPreviewReady, concatUsedNodeIds, concatPreviewPage, concatPreviewPageSize]);

  useEffect(() => {
    if (!concatPreviewParams) {
      setConcatDebouncedRequest(null);
      setConcatPreviewData([]);
      setConcatPreviewColumns([]);
      setConcatPreviewPagination(null);
      setConcatPreviewError(null);
      setConcatPreviewLoading(false);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setConcatDebouncedRequest(concatPreviewParams);
    }, 600);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [concatPreviewParams]);

  useEffect(() => {
    if (!concatDebouncedRequest) return;

    let cancelled = false;
    setConcatPreviewLoading(true);
    setConcatPreviewError(null);

    concatPreview(concatDebouncedRequest.nodeIds, concatDebouncedRequest.page, concatDebouncedRequest.pageSize)
      .then((resp) => {
        if (cancelled) return;
        const rows: PreviewRow[] = Array.isArray(resp?.data) ? (resp.data as PreviewRow[]) : [];
        const cols = Array.isArray(resp?.columns) ? resp.columns : [];
        setConcatPreviewData(rows);
        setConcatPreviewColumns(cols);
        if (resp?.pagination) {
          setConcatPreviewPagination(resp.pagination);
          if (resp.pagination.page && resp.pagination.page !== concatPreviewPage) {
            setConcatPreviewPage(resp.pagination.page);
          }
        } else {
          setConcatPreviewPagination(null);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Failed to load concat preview data';
        setConcatPreviewError(message);
        setConcatPreviewData([]);
        setConcatPreviewColumns([]);
        setConcatPreviewPagination(null);
      })
      .finally(() => {
        if (!cancelled) {
          setConcatPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [concatDebouncedRequest, concatPreview, concatPreviewPage]);

  const handleConcatPreviewPrev = useCallback(() => {
    if (concatPreviewPagination?.has_prev && !concatPreviewLoading) {
      setConcatPreviewPage((prev) => Math.max(1, prev - 1));
    }
  }, [concatPreviewPagination, concatPreviewLoading]);

  const handleConcatPreviewNext = useCallback(() => {
    if (concatPreviewPagination?.has_next && !concatPreviewLoading) {
      setConcatPreviewPage((prev) => prev + 1);
    }
  }, [concatPreviewPagination, concatPreviewLoading]);

  const handleConcatPreviewPageSizeChange = useCallback((size: number) => {
    if (!Number.isNaN(size)) {
      setConcatPreviewPageSize(size);
      setConcatPreviewPage(1);
    }
  }, []);

  const handleApplyConcat = useCallback(async () => {
    if (!concatAnalysis.ready) {
      onAlert(concatStatusMessage || 'Select at least two compatible nodes to concatenate.');
      return;
    }
    const nodeIds = concatAnalysis.summaries.map((summary) => summary.nodeId);
    if (nodeIds.length < 2) {
      onAlert('Pick at least two nodes to concatenate.');
      return;
    }
    const requestedName = concatNewNodeName.trim() || concatNameAutofillRef.current || undefined;
    try {
      setIsConcatenating(true);
      await concatNodes(nodeIds, requestedName);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error applying concat';
      onAlert(`Error applying concat: ${message}`);
    } finally {
      setIsConcatenating(false);
    }
  }, [concatAnalysis, concatStatusMessage, concatNewNodeName, concatNodes, onAlert]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>Concatenate datasets</CardTitle>
              <CardDescription>Stack compatible nodes vertically into a single dataset.</CardDescription>
            </div>
            {(isConcatenating || isLoading.operations) && (
              <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Concatenating…
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-0">
          <p className="text-sm text-muted-foreground">
            Multi-select nodes in the workspace (Shift/⌘-click) to stack them vertically. We′ll align schemas and preserve column order.
          </p>

          <NodeSelectionPanel
            selectedNodes={concatSelectedNodes}
            nodeColumnSelections={concatNodeSelections}
            onColumnChange={handleConcatColumnChange}
            nodeColors={concatNodeColors}
            onColorChange={handleConcatColorChange}
            defaultPalette={concatDefaultPalette}
            maxCompare={MAX_CONCAT_NODES}
            className="rounded-lg border border-border/60 bg-muted/40"
            showColorPicker={false}
            showColumnPicker={false}
            showHeaderLabel
            showShape
            getNodeShapeFn={getNodeShape}
            disabled={concatSelectedNodes.length < 2}
            originalCount={concatOriginalCount}
          />

          {concatOriginalCount > MAX_CONCAT_NODES && (
            <div className="rounded-md border border-amber-500/50 bg-amber-100/60 p-3 text-sm text-amber-900">
              Using the first {MAX_CONCAT_NODES} of {concatOriginalCount} selected nodes. Deselect extras to include them.
            </div>
          )}

          {concatAnalysis.mismatches.length > 0 && (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <div className="font-semibold">Schema mismatches detected:</div>
              <ul className="space-y-2">
                {concatAnalysis.mismatches.map((mismatch) => (
                  <li key={`concat-mismatch-${mismatch.nodeId}`} className="space-y-1">
                    <div className="font-medium">{mismatch.nodeName}</div>
                    {mismatch.details.map((detail, idx) => (
                      <div key={`concat-mismatch-${mismatch.nodeId}-${idx}`} className="text-destructive">
                        {detail}
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="concat-new-node-name">New node name</Label>
              <Input
                id="concat-new-node-name"
                value={concatNewNodeName}
                placeholder={autoConcatName || 'Concatenated dataset'}
                onChange={(event) => setConcatNewNodeName(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">Leave blank to use the suggested name shown in gray.</p>
            </div>
            <div className="space-y-2">
              <Label>Schema status</Label>
              <div className="rounded-md border border-muted-foreground/40 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                {concatStatusMessage}
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3 border-t pt-4 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-muted-foreground">{concatStatusMessage}</div>
          <Button
            type="button"
            onClick={handleApplyConcat}
            disabled={!concatAnalysis.ready || !currentWorkspaceId || isConcatenating || isLoading.operations}
          >
            {isConcatenating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Concatenating…
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
              <CardTitle>Preview concat output</CardTitle>
              <CardDescription>Inspect a sample of the stacked rows before creating the node.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <PreviewTable
            title=""
            description=""
            columns={concatPreviewColumnsToRender}
            data={concatPreviewData}
            pagination={concatPreviewPagination}
            loading={concatPreviewLoading}
            error={concatPreviewError}
            ready={concatPreviewReady}
            readyMessage={
              concatAnalysis.summaries.length < 2
                ? 'Select at least two nodes to generate a concat preview.'
                : concatStatusMessage
            }
            page={concatPreviewCurrentPage}
            pageSize={concatPreviewPageSize}
            onPageSizeChange={handleConcatPreviewPageSizeChange}
            onPreviousPage={handleConcatPreviewPrev}
            onNextPage={handleConcatPreviewNext}
            loadingBadge={concatPreviewLoading ? (
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
