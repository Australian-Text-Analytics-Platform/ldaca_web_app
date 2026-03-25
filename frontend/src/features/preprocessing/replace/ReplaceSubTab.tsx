import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

import NodeSelectionPanel, { type WorkspaceNodeLike } from '../../../components/NodeSelectionPanel';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Tag } from '../../../components/ui/tag';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { ApiError } from '../../../api/http';
import type {
  ReplaceApplyResponse,
  ReplacePreviewResponse,
  ReplaceRequest,
} from '../../../api/nodes';
import { mapColumnsToInfo } from '../../../utils/columnTypes';

const DEFAULT_PREVIEW_LIMIT = 25;
const DEFAULT_PALETTE = ['#2563eb'];

const getErrorMessage = (error: unknown): string => {
  if (!error) return 'Unknown error';
  if (error instanceof ApiError) return error.message || 'Request failed';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Request failed';
};

const getNodeId = (node: WorkspaceNodeLike, fallbackIndex: number): string =>
  node.id || node.node_id || `node-${fallbackIndex}`;

const formatPreviewValue = (value: unknown): string => {
  if (value === null) return '(null)';
  if (value === undefined) return '(undefined)';
  if (typeof value === 'string') return value.length > 0 ? value : '(empty string)';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export interface ReplaceSubTabProps {
  selectedNodeId: string | null;
  selectedNodes: WorkspaceNodeLike[];
  workspaceNodes: WorkspaceNodeLike[];
  isLoading: {
    nodeData: boolean;
    graph: boolean;
    operations: boolean;
  };
  onAlert: (message: string) => void;
  replaceTextPreview: (nodeId: string, request: ReplaceRequest) => Promise<ReplacePreviewResponse>;
  replaceText: (nodeId: string, request: ReplaceRequest) => Promise<ReplaceApplyResponse>;
  refreshNodeSchema: (nodeId: string) => Promise<unknown>;
}

export const ReplaceSubTab: React.FC<ReplaceSubTabProps> = ({
  selectedNodeId,
  selectedNodes,
  workspaceNodes,
  isLoading,
  onAlert,
  replaceTextPreview,
  replaceText,
  refreshNodeSchema,
}) => {
  const effectiveNodes = (() => {
    if (selectedNodes.length > 0) {
      return selectedNodes.slice(0, 1);
    }
    if (!selectedNodeId) {
      return [];
    }
    const fallback = workspaceNodes.find((node, index) => getNodeId(node, index) === selectedNodeId);
    return fallback ? [fallback] : [];
  })();

  const activeNode = effectiveNodes[0] ?? null;
  const activeNodeId = activeNode ? getNodeId(activeNode, 0) : null;
  const stringColumns = activeNode
    ? mapColumnsToInfo(activeNode)
        .filter((column) => column.dataType === 'string')
        .map((column) => column.name)
    : [];
  const stringColumnKey = stringColumns.join('\u0000');
  const firstStringColumn = stringColumns[0] ?? '';

  const [selectedColumn, setSelectedColumn] = useState('');
  const [pattern, setPattern] = useState('');
  const [replacement, setReplacement] = useState('');
  const [outputColumnName, setOutputColumnName] = useState('');
  const [previewData, setPreviewData] = useState<ReplacePreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewStale, setPreviewStale] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const previewTimerRef = useRef<number | null>(null);
  const previewColumnName = outputColumnName.trim() || selectedColumn;
  useEffect(() => {
    const availableColumns = stringColumnKey.length > 0 ? stringColumnKey.split('\u0000') : [];
    if (!activeNodeId || stringColumnKey.length === 0) {
      setSelectedColumn('');
      setPreviewData(null);
      setPreviewError(null);
      setPreviewStale(false);
      return;
    }
    if (selectedColumn && availableColumns.includes(selectedColumn)) {
      return;
    }
    setSelectedColumn(firstStringColumn);
  }, [activeNodeId, firstStringColumn, selectedColumn, stringColumnKey]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && previewTimerRef.current) {
        window.clearTimeout(previewTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }

    if (!activeNodeId || !selectedColumn || pattern.length === 0) {
      setPreviewData(null);
      setPreviewError(null);
      setPreviewStale(false);
      return;
    }

    setPreviewStale(true);
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null;
      void (async () => {
        setPreviewLoading(true);
        setPreviewError(null);
        try {
          const request: ReplaceRequest = {
            source_column: selectedColumn,
            pattern,
            replacement,
            output_column_name: previewColumnName,
            preview_limit: DEFAULT_PREVIEW_LIMIT,
          };
          const response = await replaceTextPreview(activeNodeId, request);
          setPreviewData(response);
          setPreviewStale(false);
        } catch (error) {
          setPreviewData(null);
          setPreviewError(getErrorMessage(error));
          setPreviewStale(false);
        } finally {
          setPreviewLoading(false);
        }
      })();
    }, 250);

    return () => {
      if (previewTimerRef.current) {
        window.clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }
    };
  }, [activeNodeId, pattern, previewColumnName, replacement, replaceTextPreview, selectedColumn]);

  const handleApply = async () => {
    if (!activeNodeId || !selectedColumn || pattern.length === 0) {
      return;
    }
    setApplyLoading(true);
    setPreviewError(null);
    try {
      const request: ReplaceRequest = {
        source_column: selectedColumn,
        pattern,
        replacement,
        output_column_name: previewColumnName,
        preview_limit: DEFAULT_PREVIEW_LIMIT,
      };
      const response = await replaceText(activeNodeId, request);
      onAlert(response.message || `Updated column ${response.column_name}`);
      await refreshNodeSchema(activeNodeId);
      const refreshedPreview = await replaceTextPreview(activeNodeId, request);
      setPreviewData(refreshedPreview);
      setPreviewStale(false);
    } catch (error) {
      setPreviewError(getErrorMessage(error));
    } finally {
      setApplyLoading(false);
    }
  };

  const hasSelection = Boolean(activeNodeId);
  const controlsDisabled = !hasSelection || isLoading.nodeData || isLoading.operations || applyLoading;
  const canApply = Boolean(activeNodeId && selectedColumn && pattern.length > 0 && !applyLoading);
  const resolvedOutputColumnName = previewColumnName;
  const previewColumns =
    previewData?.columns && previewData.columns.length > 0
      ? previewData.columns
      : previewData?.data && previewData.data.length > 0
        ? Object.keys(previewData.data[0])
        : [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>Replace text with regex</CardTitle>
              <CardDescription>
                Apply Polars string regex replacement to a selected text column. Leave the output column blank to overwrite the source column.
              </CardDescription>
            </div>
            {(previewLoading || previewStale) && (
              <Tag tone="muted">
                <Loader2 className={`h-3.5 w-3.5 ${previewLoading ? 'animate-spin' : ''}`} />
                {previewLoading ? 'Refreshing preview…' : 'Preview pending…'}
              </Tag>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-0">
          <NodeSelectionPanel
            selectedNodes={effectiveNodes}
            nodeColumnSelections={activeNodeId ? [{ nodeId: activeNodeId, column: selectedColumn }] : []}
            onColumnChange={(nodeId, column) => {
              if (nodeId === activeNodeId) {
                setSelectedColumn(column);
              }
            }}
            nodeColors={activeNodeId ? { [activeNodeId]: DEFAULT_PALETTE[0] } : {}}
            onColorChange={() => {}}
            defaultPalette={DEFAULT_PALETTE}
            maxCompare={1}
            className="rounded-lg border border-border/60 bg-muted/40"
            showColorPicker={false}
            showColumnPicker
            showHeaderLabel
            showShape
            disabled={controlsDisabled}
            originalCount={selectedNodes.length}
            allowedDataTypes={['string']}
            fallbackToAllColumns={false}
            statusMessage={
              hasSelection && stringColumns.length === 0
                ? 'The selected data block has no string columns available for regex replacement.'
                : undefined
            }
          />

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="replace-pattern">Regex pattern</Label>
              <Input
                id="replace-pattern"
                value={pattern}
                onChange={(event) => setPattern(event.target.value)}
                placeholder="\\d+"
                disabled={controlsDisabled || !selectedColumn}
              />
              <p className="text-xs text-muted-foreground">Uses Polars <code className="font-mono text-[0.75rem]">Expr.str.replace</code>, so the first regex match in each value is replaced.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="replace-replacement">Replacement</Label>
              <Input
                id="replace-replacement"
                value={replacement}
                onChange={(event) => setReplacement(event.target.value)}
                placeholder="#"
                disabled={controlsDisabled || !selectedColumn}
              />
              <p className="text-xs text-muted-foreground">Leave empty to remove the matched text.</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="replace-output-column">Output column name</Label>
            <Input
              id="replace-output-column"
              value={outputColumnName}
              onChange={(event) => setOutputColumnName(event.target.value)}
              placeholder={selectedColumn || 'Leave blank to overwrite the selected column'}
              disabled={controlsDisabled || !selectedColumn}
            />
            <p className="text-xs text-muted-foreground">When blank, the replacement is written back to <span className="font-medium text-foreground">{selectedColumn || 'the selected column'}</span>.</p>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3 border-t border-border bg-muted/20 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            <p>Source column: {selectedColumn || 'Select a string column'}</p>
            <p>Output column: {resolvedOutputColumnName || 'Select a string column'}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {previewError && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span>{previewError}</span>
              </div>
            )}
            <Button type="button" onClick={() => void handleApply()} disabled={!canApply}>
              {applyLoading ? 'Applying replacement…' : 'Add to Data Block'}
            </Button>
          </div>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preview replaced values</CardTitle>
          <CardDescription>Review the updated rows before applying the replacement to the selected data block.</CardDescription>
        </CardHeader>
        <CardContent>
          {!hasSelection ? (
            <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 p-4 text-sm text-muted-foreground">
              Select a data block to configure a regex replacement.
            </div>
          ) : !selectedColumn ? (
            <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 p-4 text-sm text-muted-foreground">
              Choose a string column to preview replacements.
            </div>
          ) : pattern.length === 0 ? (
            <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 p-4 text-sm text-muted-foreground">
              Enter a regex pattern to preview the replacement.
            </div>
          ) : previewError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              {previewError}
            </div>
          ) : previewData ? (
            <div className="overflow-hidden rounded-lg border border-border">
              <Table disableContainer>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    {previewColumns.map((column: string) => (
                      <TableHead key={column}>{column}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewData.data.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={Math.max(previewColumns.length, 1)} className="py-6 text-center text-muted-foreground">
                        No rows match the current configuration.
                      </TableCell>
                    </TableRow>
                  ) : (
                    previewData.data.map((row: Record<string, unknown>, rowIndex: number) => (
                      <TableRow key={rowIndex}>
                        {previewColumns.map((column: string) => (
                          <TableCell key={`${rowIndex}-${column}`} className="max-w-xs truncate font-mono text-xs" title={formatPreviewValue(row[column])}>
                            {formatPreviewValue(row[column])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 p-4 text-sm text-muted-foreground">
              Preview results will appear here after the first refresh.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ReplaceSubTab;