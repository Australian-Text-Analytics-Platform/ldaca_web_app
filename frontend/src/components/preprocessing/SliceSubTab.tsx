import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

import type { SliceRequest as SliceRequestPayload, FilterPreviewResponse } from '../../api/nodes';
import NodeSelectionPanel, { NodeColumnSelection, WorkspaceNodeLike } from '../NodeSelectionPanel';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { PreviewTable } from './PreviewTable';
import type { PreviewPagination, PreviewRow } from './types';

type SliceOperationResult = {
  success?: boolean;
  message?: string;
  node_id?: string;
  data?: {
    node_name?: string;
    data_type?: string;
  };
};

type NodeShapeInfo = {
  shape: [number, number];
  is_lazy: boolean;
  calculated: boolean;
};

type SliceHistory = {
  nodeId?: string;
  nodeName: string;
  offset: number;
  length?: number;
};

type SlicePreviewJob = {
  nodeId: string;
  request: SliceRequestPayload;
  signature: string;
};

interface SliceSubTabProps {
  selectedNodeId: string | null;
  selectedNode: WorkspaceNodeLike | null;
  selectedNodes: WorkspaceNodeLike[];
  workspaceNodes: WorkspaceNodeLike[];
  getNodeShape: (nodeId: string) => Promise<NodeShapeInfo | null>;
  sliceNode: (nodeId: string, request: SliceRequestPayload) => Promise<SliceOperationResult>;
  slicePreview: (
    nodeId: string,
    request: SliceRequestPayload,
    page: number,
    pageSize: number
  ) => Promise<FilterPreviewResponse>;
  isLoading: {
    operations: boolean;
  };
  onAlert: (message: string) => void;
}

export const SliceSubTab: React.FC<SliceSubTabProps> = ({
  selectedNodeId,
  selectedNode,
  selectedNodes,
  workspaceNodes,
  getNodeShape,
  sliceNode,
  slicePreview,
  isLoading,
  onAlert,
}) => {
  const [offsetInput, setOffsetInput] = useState('0');
  const [lengthInput, setLengthInput] = useState('');
  const [newNodeName, setNewNodeName] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [isSlicing, setIsSlicing] = useState(false);
  const [lastResult, setLastResult] = useState<SliceHistory | null>(null);

  const [previewData, setPreviewData] = useState<PreviewRow[]>([]);
  const [previewColumns, setPreviewColumns] = useState<string[]>([]);
  const [previewPagination, setPreviewPagination] = useState<PreviewPagination | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewPageSize, setPreviewPageSize] = useState(10);
  const [debouncedRequest, setDebouncedRequest] = useState<SlicePreviewJob | null>(null);

  const defaultPalette = useMemo(
    () => ['#2563eb', '#dc2626', '#16a34a', '#f97316', '#d946ef', '#0ea5e9'],
    []
  );

  const workspaceNodeMap = useMemo(() => {
    const map = new Map<string, WorkspaceNodeLike>();
    workspaceNodes.forEach((node) => {
      const base = node as Record<string, unknown>;
      const data = (base.data ?? {}) as Record<string, unknown>;
      const candidates = [
        base.id,
        base.node_id,
        base.unique_id,
        data.id,
        data.node_id,
      ];
      candidates.forEach((value) => {
        if (typeof value === 'string' && value.length > 0) {
          map.set(value, node);
        }
      });
    });
    return map;
  }, [workspaceNodes]);

  const deriveNodeLabel = useCallback((node: WorkspaceNodeLike | null | undefined): string => {
    if (!node) return '';
    const base = node as Record<string, unknown>;
    const data = (base.data ?? {}) as Record<string, unknown>;
    return (
      (base.name as string | undefined) ??
      (data.name as string | undefined) ??
      (data.nodeName as string | undefined) ??
      (base.label as string | undefined) ??
      (data.label as string | undefined) ??
      (base.id as string | undefined) ??
      (base.node_id as string | undefined) ??
      ''
    );
  }, []);

  const activeNode = useMemo<WorkspaceNodeLike | null>(() => {
    if (selectedNode) return selectedNode;
    if (!selectedNodeId) return null;
    return workspaceNodeMap.get(selectedNodeId) ?? null;
  }, [selectedNode, selectedNodeId, workspaceNodeMap]);

  const sliceSelectedNodesForPanel = useMemo<WorkspaceNodeLike[]>(() => {
    return activeNode ? [activeNode] : [];
  }, [activeNode]);

  const sliceNodeSelections = useMemo<NodeColumnSelection[]>(() => (
    selectedNodeId ? [{ nodeId: selectedNodeId, column: '' }] : []
  ), [selectedNodeId]);

  const sliceNodeColors = useMemo(() => (
    selectedNodeId ? { [selectedNodeId]: '#2563eb' } : {}
  ), [selectedNodeId]);

  const handleSliceColorChange = useCallback(() => undefined, []);
  const handleSliceColumnChange = useCallback(() => undefined, []);

  const selectedNodeLabel = useMemo(() => {
    if (!selectedNodeId) return '';
    return deriveNodeLabel(activeNode) || selectedNodeId;
  }, [activeNode, deriveNodeLabel, selectedNodeId]);

  useEffect(() => {
    if (!selectedNodeId) {
      setOffsetInput('0');
      setLengthInput('');
      setNewNodeName('');
      setLastResult(null);
      setInlineError(null);
      setPreviewData([]);
      setPreviewColumns([]);
      setPreviewPagination(null);
      setPreviewError(null);
      setDebouncedRequest(null);
      setPreviewPage(1);
      return;
    }
    const baseName = selectedNodeLabel || selectedNodeId;
    setOffsetInput('0');
    setLengthInput('');
    setNewNodeName(`${baseName}_sliced`);
    setLastResult(null);
    setInlineError(null);
    setPreviewData([]);
    setPreviewColumns([]);
    setPreviewPagination(null);
    setPreviewError(null);
    setDebouncedRequest(null);
    setPreviewPage(1);
  }, [selectedNodeId, selectedNodeLabel]);

  useEffect(() => {
    setInlineError(null);
  }, [offsetInput, lengthInput, selectedNodeId]);

  const trimmedOffset = offsetInput.trim();
  const offsetNumber = Number(trimmedOffset);
  const offsetValid =
    trimmedOffset.length > 0 && Number.isInteger(offsetNumber) && offsetNumber >= 0;

  const trimmedLength = lengthInput.trim();
  const lengthNumber = trimmedLength.length > 0 ? Number(trimmedLength) : null;
  const lengthValid =
    lengthNumber === null || (Number.isInteger(lengthNumber) && lengthNumber >= 0);
  const lengthValue = lengthNumber === null ? undefined : lengthNumber;

  const hasSelection = Boolean(selectedNodeId);
  const previewReady = hasSelection && offsetValid && lengthValid;

  const rangeSummary = useMemo(() => {
    if (!hasSelection) {
      return 'Select a node to configure slicing.';
    }
    if (!offsetValid) {
      return 'Offset must be a non-negative integer (zero-based row index).';
    }
    if (!lengthValid) {
      return 'Length must be a non-negative integer when provided.';
    }
    if (lengthValue === undefined) {
      return `Rows ${offsetNumber} → end of dataset.`;
    }
    if (lengthValue === 0) {
      return `Slice starting at row ${offsetNumber} returning zero rows (length = 0).`;
    }
    const endRow = offsetNumber + lengthValue - 1;
    return `Rows ${offsetNumber}–${endRow} inclusive (${lengthValue} total).`;
  }, [hasSelection, offsetNumber, offsetValid, lengthValid, lengthValue]);

  const lastResultSummary = useMemo(() => {
    if (!lastResult) {
      return 'Adjust parameters and add to workspace to create a sliced node.';
    }
    if (lastResult.length === undefined) {
      return `Last slice “${lastResult.nodeName}” (offset ${lastResult.offset} → end).`;
    }
    if (lastResult.length === 0) {
      return `Last slice “${lastResult.nodeName}” (offset ${lastResult.offset}, zero rows).`;
    }
    const endRow = lastResult.offset + lastResult.length - 1;
    return `Last slice “${lastResult.nodeName}” (rows ${lastResult.offset}–${endRow}).`;
  }, [lastResult]);

  const applyDisabled =
    !hasSelection || !offsetValid || !lengthValid || isSlicing || isLoading.operations;

  const handleApplySlice = useCallback(async () => {
    if (!selectedNodeId) {
      setInlineError('Select a node to slice.');
      return;
    }
    if (!offsetValid) {
      setInlineError('Offset must be a non-negative integer.');
      return;
    }
    if (!lengthValid) {
      setInlineError('Length must be a non-negative integer when provided.');
      return;
    }

    const payload: SliceRequestPayload = { offset: offsetNumber };
    if (typeof lengthValue === 'number') {
      payload.length = lengthValue;
    }
    const trimmedName = newNodeName.trim();
    if (trimmedName.length > 0) {
      payload.new_node_name = trimmedName;
    }

    setInlineError(null);
    setIsSlicing(true);
    try {
      const response = await sliceNode(selectedNodeId, payload);
      if (response?.success === false) {
        const message = response.message || 'Slice operation failed';
        setInlineError(message);
        onAlert(`Slice failed: ${message}`);
        return;
      }
      const responseName =
        response?.data?.node_name?.trim?.() ||
        trimmedName ||
        `${selectedNodeLabel}_sliced`;
      const resultNodeId = response?.node_id;
      setLastResult({
        nodeId: resultNodeId ?? undefined,
        nodeName: responseName,
        offset: offsetNumber,
        length: lengthValue,
      });
      onAlert(
        `Slice created: ${responseName}${resultNodeId ? ` (${resultNodeId})` : ''}.`
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Slice operation failed';
      setInlineError(message);
      onAlert(`Slice failed: ${message}`);
    } finally {
      setIsSlicing(false);
    }
  }, [lengthValid, lengthValue, newNodeName, offsetNumber, offsetValid, onAlert, selectedNodeId, selectedNodeLabel, sliceNode]);

  const previewRequest = useMemo(() => {
    if (!previewReady) return null;
    const payload: SliceRequestPayload = { offset: offsetNumber };
    if (typeof lengthValue === 'number') {
      payload.length = lengthValue;
    }
    return payload;
  }, [lengthValue, offsetNumber, previewReady]);

  const previewSignature = useMemo(() => {
    if (!previewReady || !selectedNodeId) return '';
    return JSON.stringify({
      nodeId: selectedNodeId,
      offset: offsetNumber,
      length: lengthValue ?? null,
    });
  }, [lengthValue, offsetNumber, previewReady, selectedNodeId]);

  useEffect(() => {
    setPreviewPage(1);
  }, [previewSignature]);

  useEffect(() => {
    if (!previewReady || !previewRequest || !selectedNodeId) {
      setDebouncedRequest(null);
      if (!previewReady) {
        setPreviewLoading(false);
        setPreviewData([]);
        setPreviewColumns([]);
        setPreviewPagination(null);
        setPreviewError(null);
      }
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setDebouncedRequest({
        nodeId: selectedNodeId,
        request: previewRequest,
        signature: previewSignature,
      });
    }, 400);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [previewReady, previewRequest, previewSignature, selectedNodeId]);

  useEffect(() => {
    if (!debouncedRequest) return;

    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);

    slicePreview(
      debouncedRequest.nodeId,
      debouncedRequest.request,
      previewPage,
      previewPageSize,
    )
      .then((response) => {
        if (cancelled) return;
        const rows: PreviewRow[] = Array.isArray(response?.data)
          ? (response.data as PreviewRow[])
          : [];
        const cols = Array.isArray(response?.columns) ? response.columns : [];
        setPreviewData(rows);
        setPreviewColumns(cols);
        if (response?.pagination) {
          setPreviewPagination(response.pagination);
          if (
            response.pagination.page &&
            response.pagination.page !== previewPage
          ) {
            setPreviewPage(response.pagination.page);
          }
        } else {
          setPreviewPagination(null);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Failed to load slice preview';
        setPreviewError(message);
        setPreviewData([]);
        setPreviewColumns([]);
        setPreviewPagination(null);
      })
      .finally(() => {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedRequest, previewPage, previewPageSize, slicePreview]);

  const previewColumnsToRender = useMemo(() => {
    if (previewColumns.length > 0) return previewColumns;
    if (
      previewData.length > 0 &&
      typeof previewData[0] === 'object' &&
      previewData[0] !== null
    ) {
      return Object.keys(previewData[0]);
    }
    return [];
  }, [previewColumns, previewData]);

  const currentPreviewPage = previewPagination?.page ?? previewPage;

  const handlePreviewPrev = useCallback(() => {
    if (previewPagination?.has_prev && !previewLoading) {
      setPreviewPage((prev) => Math.max(1, prev - 1));
    }
  }, [previewLoading, previewPagination]);

  const handlePreviewNext = useCallback(() => {
    if (previewPagination?.has_next && !previewLoading) {
      setPreviewPage((prev) => prev + 1);
    }
  }, [previewLoading, previewPagination]);

  const handlePreviewPageSizeChange = useCallback((size: number) => {
    if (!Number.isNaN(size)) {
      setPreviewPageSize(size);
      setPreviewPage(1);
    }
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>Slice datasets</CardTitle>
              <CardDescription>
                Extract a contiguous row window using Polars slice(offset, length) semantics.
              </CardDescription>
            </div>
            {(isSlicing || isLoading.operations) && (
              <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {isSlicing ? 'Adding to workspace…' : 'Working…'}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-0">
          <p className="text-sm text-muted-foreground">
            Configure the slice parameters below. Offsets are zero-based and length is optional—leave it blank to include all rows from the offset onward.
          </p>

          <NodeSelectionPanel
            selectedNodes={sliceSelectedNodesForPanel}
            nodeColumnSelections={sliceNodeSelections}
            onColumnChange={handleSliceColumnChange}
            nodeColors={sliceNodeColors}
            onColorChange={handleSliceColorChange}
            defaultPalette={defaultPalette}
            maxCompare={1}
            className="rounded-lg border border-border/60 bg-muted/40"
            showColorPicker={false}
            showColumnPicker={false}
            showHeaderLabel
            showShape
            getNodeShapeFn={getNodeShape}
            disabled={!hasSelection}
            originalCount={selectedNodes.length}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="slice-offset">Offset</Label>
              <Input
                id="slice-offset"
                type="number"
                inputMode="numeric"
                min={0}
                value={offsetInput}
                onChange={(event) => setOffsetInput(event.target.value)}
                disabled={!hasSelection}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="slice-length">Length (optional)</Label>
              <Input
                id="slice-length"
                type="number"
                inputMode="numeric"
                min={0}
                value={lengthInput}
                onChange={(event) => setLengthInput(event.target.value)}
                placeholder="Leave blank to include all remaining rows"
                disabled={!hasSelection}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="slice-node-name">New node name (optional)</Label>
            <Input
              id="slice-node-name"
              value={newNodeName}
              onChange={(event) => setNewNodeName(event.target.value)}
              placeholder={hasSelection ? `${selectedNodeLabel}_sliced` : 'Select a node to auto-fill name'}
              disabled={!hasSelection}
            />
          </div>

          <div className="rounded-md border border-dashed border-muted-foreground/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {rangeSummary}
          </div>

          {inlineError && (
            <div className="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span className="inline-flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                {inlineError}
              </span>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-3 border-t border-border bg-muted/20 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            {lastResult ? lastResultSummary : rangeSummary}
          </div>
          <Button
            type="button"
            onClick={handleApplySlice}
            disabled={applyDisabled}
            className="w-full sm:w-auto"
          >
            {isSlicing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding to workspace…
              </>
            ) : (
              'Add to Workspace'
            )}
          </Button>
        </CardFooter>
      </Card>

      <PreviewTable
        title="Preview sliced rows"
        description="Review the rows that match the current offset and optional length before creating a new node."
        columns={previewColumnsToRender}
        data={previewData}
        pagination={previewPagination}
        loading={previewLoading}
        error={previewError}
        ready={previewReady}
        readyMessage={hasSelection
          ? 'Adjust offset and optional length to see a preview of the sliced rows.'
          : 'Select a node to preview slice results.'}
        page={currentPreviewPage}
        pageSize={previewPageSize}
        onPageSizeChange={handlePreviewPageSizeChange}
        onPreviousPage={handlePreviewPrev}
        onNextPage={handlePreviewNext}
      />
    </div>
  );
};
