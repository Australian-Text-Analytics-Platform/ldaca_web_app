import React, { useState, useCallback, useMemo } from 'react';
import { Download } from 'lucide-react';
import { useWorkspaceSelection } from '../../../hooks/useWorkspaceSelection';
import { useWorkspaceData } from '../../../hooks/useWorkspaceData';
import { useAuth } from '../../../hooks/useAuth';
import { getApiBase } from '../../../api/env';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Label } from '../../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { toast } from 'sonner';
import HelpIcon from '../../../components/help/HelpIcon';

type DownloadStatus = 'idle' | 'downloading';

// Supported formats aligned with backend / Polars write_* methods
const FORMATS = [
  { value: 'csv', label: 'CSV (.csv)' },
  { value: 'json', label: 'JSON (.json)' },
  { value: 'ndjson', label: 'NDJSON (.ndjson)' },
  { value: 'parquet', label: 'Parquet (.parquet)' },
  { value: 'ipc', label: 'Arrow IPC (.arrow)' },
];

const ExportFeature: React.FC = () => {
  const { selectedNodes: rawSelectedNodes } = useWorkspaceSelection();
  const { currentWorkspaceId } = useWorkspaceData();
  const selectedNodes = useMemo(() => rawSelectedNodes ?? [], [rawSelectedNodes]);
  const { getAuthHeaders } = useAuth();
  const [format, setFormat] = useState('csv');
  const [exporting, setExporting] = useState(false);
  const [downloadingIds, setDownloadingIds] = useState<Record<string, DownloadStatus>>({});

  const nodeIds = useMemo(() => selectedNodes.map((n: any, idx: number) => n.id || n.node_id || n.data?.id || n.data?.node_id || n.unique_id || `node-${idx}`), [selectedNodes]);

  // Best-effort helpers for node display
  const toDisplay = useCallback((n: any) => {
    const id = n.id || n.node_id || n.data?.id || n.data?.node_id || n.unique_id;
    const name = n?.data?.nodeName || n?.data?.label || n?.label || n?.name || id;
    const shapeArr = Array.isArray(n?.data?.shape) ? n.data.shape : null;
    const formatDimension = (value: number | string | null | undefined) =>
      typeof value === 'number' || typeof value === 'string' ? value : '?';
    const shape = shapeArr ? `${formatDimension(shapeArr[0])} × ${formatDimension(shapeArr[1])}` : null;
    return { id, name, shape };
  }, []);

  // Export all as CSV (zip when multiple)
  const handleExportAll = useCallback(async () => {
    if (!currentWorkspaceId || nodeIds.length === 0) return;
    setExporting(true);
    try {
  const params = new URLSearchParams({ node_ids: nodeIds.join(','), format: 'csv' });
  const apiBase = getApiBase();
  const resp = await fetch(`${apiBase}/workspaces/${currentWorkspaceId}/export?` + params.toString(), {
        headers: getAuthHeaders(),
      });
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      const multiple = nodeIds.length > 1;
      const ext = multiple ? 'zip' : 'csv';
      const filename = multiple ? `export_${currentWorkspaceId}.csv.zip` : `${(toDisplay(selectedNodes[0]).name || nodeIds[0])}.${ext}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
    } catch (e) {
      console.error(e);
      toast.error('Failed to export nodes');
    } finally {
      setExporting(false);
    }
  }, [currentWorkspaceId, nodeIds, getAuthHeaders, selectedNodes, toDisplay]);

  // Download a single node in the selected format
  const handleDownloadOne = useCallback(async (node: any) => {
    if (!currentWorkspaceId) return;
    const { id, name } = toDisplay(node);
    if (!id) return;
  setDownloadingIds((s) => ({ ...s, [id]: 'downloading' }));
    try {
      const params = new URLSearchParams({ node_ids: id, format });
      const apiBase = getApiBase();
      const resp = await fetch(`${apiBase}/workspaces/${currentWorkspaceId}/export?` + params.toString(), {
        headers: getAuthHeaders(),
      });
      if (!resp.ok) throw new Error('Download failed');
      const blob = await resp.blob();
      const ext = format === 'ipc' ? 'arrow' : format;
      const filename = `${name || id}.${ext}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
    } catch (e) {
      console.error(e);
      toast.error('Failed to download node');
    } finally {
      setDownloadingIds((s) => ({ ...s, [id]: 'idle' }));
    }
  }, [currentWorkspaceId, format, getAuthHeaders, toDisplay]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle>Export Nodes</CardTitle>
          <CardDescription>
            Select one or more nodes in the workspace graph and download their data in the format you prefer.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border/50 bg-muted/40 px-4 py-3">
            <div className="text-sm text-muted-foreground">
              Workspace ID: <span className="font-mono text-foreground">{currentWorkspaceId ?? '—'}</span>
            </div>
            <Badge variant={selectedNodes.length ? 'default' : 'outline'}>
              {selectedNodes.length ? `${selectedNodes.length} node${selectedNodes.length > 1 ? 's' : ''} selected` : 'No nodes selected'}
            </Badge>
          </div>

          <div className="space-y-3">
            <Label className="text-sm font-medium">Selected Nodes</Label>
            <div className="max-h-104 space-y-2 overflow-y-auto rounded-lg border border-border/60 bg-background p-2 shadow-sm">
              {selectedNodes.length === 0 && (
                <div className="flex items-center justify-center rounded-md border border-dashed border-border/40 bg-muted/30 py-10 text-sm text-muted-foreground">
                  Choose nodes in the graph sidebar to enable exports.
                </div>
              )}
              {selectedNodes.map((n: any) => {
                const info = toDisplay(n);
                const status = downloadingIds[info.id ?? ''] ?? 'idle';
                const isDownloading = status === 'downloading';
                return (
                  <div
                    key={info.id}
                    className="flex flex-col gap-3 rounded-md border border-border/40 bg-card/60 p-3 transition hover:bg-card/80 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-foreground">{info.name}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">{info.id}</p>
                      {info.shape && <p className="text-xs text-muted-foreground">Shape: {info.shape}</p>}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isDownloading}
                      onClick={() => handleDownloadOne(n)}
                      className="gap-1"
                    >
                      <Download className="h-4 w-4" />
                      {isDownloading ? 'Downloading…' : 'Download'}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="w-full max-w-xs">
              <div className="mb-2 flex items-center gap-2">
                <Label className="block text-sm font-medium text-foreground">Format</Label>
                <HelpIcon targetKey="analysis.export.format" label="Export format selector" />
              </div>
              <Select value={format} onValueChange={(value) => setFormat(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a format" />
                </SelectTrigger>
                <SelectContent>
                  {FORMATS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleExportAll}
                disabled={exporting || nodeIds.length === 0 || !currentWorkspaceId}
                className="gap-2"
              >
                {exporting && (
                  <span className="inline-flex h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
                )}
                {exporting ? 'Exporting…' : 'Export All (ZIP bundle)'}
              </Button>
              <HelpIcon targetKey="analysis.export.run" label="Export action" />
            </div>
          </div>
        </CardContent>
      </Card>

      {!selectedNodes.length && (
        <Card className="border-dashed border-border/50 bg-muted/30">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Tip: open the Data tab and use the node checkbox to mark items for export.
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ExportFeature;