import React, { useState } from 'react';
import { Download } from 'lucide-react';
import type { GraphNode } from '../../../types/api';
import { useWorkspaceSelection } from '../../../hooks/useWorkspaceSelection';
import { useWorkspaceData } from '../../../hooks/useWorkspaceData';
import { useAuth } from '../../../hooks/useAuth';
import { getApiBase } from '../../../api/env';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Label } from '../../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { toast } from 'sonner';
import { saveBlob } from '../../../lib/download';
import HelpIcon from '../../../components/help/HelpIcon';
import InfoIcon from '../../../components/help/InfoIcon';

type DownloadStatus = 'idle' | 'downloading';

// Supported formats aligned with backend / Polars write_* methods
const FORMATS = [
  { value: 'csv', label: 'CSV (.csv)' },
  { value: 'json', label: 'JSON (.json)' },
  { value: 'ndjson', label: 'NDJSON (.ndjson)' },
  { value: 'parquet', label: 'Parquet (.parquet)' },
  { value: 'ipc', label: 'Arrow IPC (.arrow)' },
];

const padFilenamePart = (value: number) => String(value).padStart(2, '0');

const buildTimestampFragment = (date: Date = new Date()) =>
  `${padFilenamePart(date.getMonth() + 1)}-${padFilenamePart(date.getDate())}_${padFilenamePart(date.getHours())}-${padFilenamePart(date.getMinutes())}-${padFilenamePart(date.getSeconds())}`;

const toSafeArchiveLabel = (value: string) =>
  Array.from((value || 'workspace').trim())
    .map((char) => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char))
    .join('')
    .trim() || 'workspace';

const getDownloadExtension = (selectedFormat: string) =>
  selectedFormat === 'ipc' ? 'arrow' : selectedFormat;

const ExportFeature: React.FC = () => {
  const { selectedNodes: rawSelectedNodes } = useWorkspaceSelection();
  const { currentWorkspaceId, currentWorkspace } = useWorkspaceData();
  const selectedNodes = rawSelectedNodes ?? [];
  const { getAuthHeaders } = useAuth();
  const [format, setFormat] = useState('csv');
  const [exporting, setExporting] = useState(false);
  const [downloadingIds, setDownloadingIds] = useState<Record<string, DownloadStatus>>({});

  const nodeIds = selectedNodes.map((n: GraphNode, idx: number) => {
    const data = n.data as Record<string, unknown> | undefined;
    return n.id || String(n.node_id ?? data?.id ?? data?.node_id ?? n.unique_id ?? `node-${idx}`);
  });

  // Best-effort helpers for node display
  const toDisplay = (n: GraphNode) => {
    const data = n.data as Record<string, unknown> | undefined;
    const id = n.id || String(n.node_id ?? data?.id ?? data?.node_id ?? n.unique_id ?? '');
    const name = String(data?.nodeName ?? data?.label ?? n.label ?? n.name ?? id);
    const shapeArr = Array.isArray(data?.shape)
      ? (data.shape as (number | string | null | undefined)[])
      : null;
    const formatDimension = (value: number | string | null | undefined) =>
      typeof value === 'number' || typeof value === 'string' ? value : '?';
    const shape = shapeArr
      ? `${formatDimension(shapeArr[0])} × ${formatDimension(shapeArr[1])}`
      : null;
    return { id, name, shape };
  };

  // Export all selected nodes in the requested format (zip when multiple)
  const handleExportAll = async () => {
    if (!currentWorkspaceId || nodeIds.length === 0) return;
    setExporting(true);
    try {
      const params = new URLSearchParams({ node_ids: nodeIds.join(','), format });
      const apiBase = getApiBase();
      const resp = await fetch(`${apiBase}/workspaces/export?` + params.toString(), {
        headers: getAuthHeaders(),
      });
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      const multiple = nodeIds.length > 1;
      const ext = multiple ? 'zip' : getDownloadExtension(format);
      const filename = multiple
        ? `${buildTimestampFragment()}_${toSafeArchiveLabel(currentWorkspace?.name || currentWorkspaceId || 'workspace')}.zip`
        : `${toDisplay(selectedNodes[0]!).name || nodeIds[0]}.${ext}`;
      await saveBlob(blob, filename);
    } catch (e) {
      console.error(e);
      toast.error('Failed to export data blocks');
    } finally {
      setExporting(false);
    }
  };

  // Download a single node in the selected format
  const handleDownloadOne = async (node: GraphNode) => {
    if (!currentWorkspaceId) return;
    const { id, name } = toDisplay(node);
    if (!id) return;
    setDownloadingIds((s) => ({ ...s, [id]: 'downloading' }));
    try {
      const params = new URLSearchParams({ node_ids: id, format });
      const apiBase = getApiBase();
      const resp = await fetch(`${apiBase}/workspaces/export?` + params.toString(), {
        headers: getAuthHeaders(),
      });
      if (!resp.ok) throw new Error('Download failed');
      const blob = await resp.blob();
      const ext = getDownloadExtension(format);
      const filename = `${name || id}.${ext}`;
      await saveBlob(blob, filename);
    } catch (e) {
      console.error(e);
      toast.error('Failed to download data block');
    } finally {
      setDownloadingIds((s) => ({ ...s, [id]: 'idle' }));
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            Export Data Blocks
            <InfoIcon
              targetKey="export.overview"
              label="About Exporting Data"
              tooltip="Learn what exporting does and how it can help you."
            />
            <HelpIcon
              targetKey="analysis.export.parameters"
              label="Export parameters"
              tooltip="Select data blocks, choose a format, and export them for download."
            />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border-border/50 bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3">
            <div className="text-muted-foreground text-sm">
              Workspace ID:{' '}
              <span className="text-foreground font-mono">{currentWorkspaceId ?? '—'}</span>
            </div>
            <Badge variant={selectedNodes.length ? 'default' : 'outline'}>
              {selectedNodes.length
                ? `${selectedNodes.length} data block${selectedNodes.length > 1 ? 's' : ''} selected`
                : 'No data blocks selected'}
            </Badge>
          </div>

          <div className="space-y-3">
            <Label className="text-sm font-medium">Selected Data Blocks</Label>
            <div className="border-border/60 bg-background max-h-104 space-y-2 overflow-y-auto rounded-lg border p-2 shadow-sm">
              {selectedNodes.length === 0 && (
                <div className="border-border/40 bg-muted/30 text-muted-foreground flex items-center justify-center rounded-md border border-dashed py-10 text-sm">
                  Choose data blocks in the graph sidebar to enable exports.
                </div>
              )}
              {selectedNodes.map((n: GraphNode) => {
                const info = toDisplay(n);
                const status = downloadingIds[info.id ?? ''] ?? 'idle';
                const isDownloading = status === 'downloading';
                return (
                  <div
                    key={info.id}
                    className="border-border/40 bg-card/60 hover:bg-card/80 flex flex-col gap-3 rounded-md border p-3 transition md:flex-row md:items-center md:justify-between"
                  >
                    <div className="space-y-1">
                      <p className="text-foreground text-sm font-semibold">{info.name}</p>
                      <p className="text-muted-foreground font-mono text-[11px]">{info.id}</p>
                      {info.shape && (
                        <p className="text-muted-foreground text-xs">Shape: {info.shape}</p>
                      )}
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
                <Label className="text-foreground block text-sm font-medium">Format</Label>
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
        <Card className="border-border/50 bg-muted/30 border-dashed">
          <CardContent className="text-muted-foreground py-8 text-center text-sm">
            Tip: open the Data tab and use the data block checkbox to mark items for export.
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ExportFeature;
