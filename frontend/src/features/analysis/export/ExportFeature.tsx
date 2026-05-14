import React, { useState } from 'react';
import { Download } from 'lucide-react';
import type { GraphNode } from '@/types/api';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useAuth } from '@/hooks/useAuth';
import { getApiBase } from '@/api/env';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { saveBlob } from '@/lib/download';
import HelpIcon from '@/components/help/HelpIcon';
import InfoIcon from '@/components/help/InfoIcon';
import { useNodeColorManagement } from '@/features/analysis/common';

type DownloadStatus = 'idle' | 'downloading';

// Supported formats aligned with backend / Polars write_* methods
const FORMATS = [
  { value: 'csv', label: 'CSV (.csv)' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
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

  // Subscribe to the global node-colour store. Reuses whatever colour was
  // assigned to each node by Concordance / Topic Modelling / Frequency /
  // etc., so Export's listing visually matches the rest of the analysis
  // surface for the same node.
  const { nodeColors } = useNodeColorManagement({ activeNodeIds: nodeIds });

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

  // On Windows, both WebView2's native fetch and tauri-plugin-http drop
  // large cross-origin response bodies — backend returns 200, but the body
  // never fully reaches JS (WebView2 chokes on Range/large responses;
  // plugin-http's IPC channel resets mid-transfer for >10MB blobs). To
  // bypass both paths we expose a Rust Tauri command (`download_to_downloads`)
  // that uses reqwest to stream the URL straight to the user's Downloads
  // folder. The body never crosses the WebView2 / IPC boundary.
  // The web build keeps the original fetch + blob + saveBlob path.
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  const tauriDownloadToDisk = async (
    url: string,
    headers: Record<string, string>,
    filename: string,
  ): Promise<string> => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('download_to_downloads', { url, headers, filename });
  };

  // Pull a human-readable error description out of a non-OK Response. FastAPI
  // returns {"detail": "..."}; fall back to plain text or HTTP status. Used to
  // surface real backend errors (e.g. Polars sink failure on Windows) in the
  // download/export failure toasts instead of a generic "Failed to ...".
  const describeResponseError = async (resp: Response): Promise<string> => {
    try {
      const text = await resp.text();
      if (!text) return `HTTP ${resp.status}`;
      try {
        const parsed = JSON.parse(text) as { detail?: unknown };
        if (typeof parsed.detail === 'string' && parsed.detail.trim()) return parsed.detail;
      } catch {
        // not JSON
      }
      return text.length > 500 ? `${text.slice(0, 500)}\u2026` : text;
    } catch {
      return `HTTP ${resp.status}`;
    }
  };

  // Export all selected nodes in the requested format (zip when multiple)
  const handleExportAll = async () => {
    if (!currentWorkspaceId || nodeIds.length === 0) return;
    setExporting(true);
    try {
      const params = new URLSearchParams({ node_ids: nodeIds.join(','), format });
      const apiBase = getApiBase();
      const url = `${apiBase}/workspaces/export?` + params.toString();
      const headers = getAuthHeaders();
      const multiple = nodeIds.length > 1;
      const ext = multiple ? 'zip' : getDownloadExtension(format);
      const filename = multiple
        ? `${buildTimestampFragment()}_${toSafeArchiveLabel(currentWorkspace?.name || currentWorkspaceId || 'workspace')}.zip`
        : `${toDisplay(selectedNodes[0]!).name || nodeIds[0]}.${ext}`;

      if (isTauri) {
        const fullPath = await tauriDownloadToDisk(url, headers, filename);
        toast.success(`Saved ${filename} to Downloads`, { description: fullPath });
        return;
      }

      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        const description = await describeResponseError(resp);
        toast.error('Failed to export data blocks', { description });
        return;
      }
      const blob = await resp.blob();
      await saveBlob(blob, filename);
    } catch (e) {
      console.error(e);
      const description = e instanceof Error ? e.message : String(e);
      toast.error('Failed to export data blocks', { description });
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
      const url = `${apiBase}/workspaces/export?` + params.toString();
      const headers = getAuthHeaders();
      const ext = getDownloadExtension(format);
      const filename = `${name || id}.${ext}`;

      if (isTauri) {
        const fullPath = await tauriDownloadToDisk(url, headers, filename);
        toast.success(`Saved ${filename} to Downloads`, { description: fullPath });
        return;
      }

      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        const description = await describeResponseError(resp);
        toast.error('Failed to download data block', { description });
        return;
      }
      const blob = await resp.blob();
      await saveBlob(blob, filename);
    } catch (e) {
      console.error(e);
      const description = e instanceof Error ? e.message : String(e);
      toast.error('Failed to download data block', { description });
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
              Workspace:{' '}
              <span className="text-foreground font-medium">
                {currentWorkspace?.name ?? '—'}
              </span>
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
                // Reuse the colour the analysis tabs have already assigned
                // to this node. Same node ⇒ same colour everywhere.
                const nameColor = nodeColors[info.id ?? ''];
                return (
                  <div
                    key={info.id}
                    className="border-border/40 bg-card/60 hover:bg-card/80 flex flex-col gap-3 rounded-md border p-3 transition md:flex-row md:items-center md:justify-between"
                  >
                    <div className="space-y-1">
                      <p
                        className="text-sm font-semibold text-foreground"
                        style={nameColor ? { color: nameColor } : undefined}
                      >
                        {info.name}
                      </p>
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
