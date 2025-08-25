import React, { useState, useCallback, useMemo } from 'react';
import { useWorkspace } from '../hooks/useWorkspace';
import { useAuth } from '../hooks/useAuth';
import { getApiBase } from '../api';

// Supported formats aligned with backend / Polars write_* methods
const FORMATS = [
  { value: 'csv', label: 'CSV (.csv)' },
  { value: 'json', label: 'JSON (.json)' },
  { value: 'ndjson', label: 'NDJSON (.ndjson)' },
  { value: 'parquet', label: 'Parquet (.parquet)' },
  { value: 'ipc', label: 'Arrow IPC (.arrow)' },
];

const ExportTab: React.FC = () => {
  const { selectedNodes, currentWorkspaceId } = useWorkspace();
  const { getAuthHeaders } = useAuth();
  const [format, setFormat] = useState('csv');
  const [exporting, setExporting] = useState(false);
  const [downloadingIds, setDownloadingIds] = useState<Record<string, boolean>>({});

  const nodeIds = useMemo(() => selectedNodes.map((n: any, idx: number) => n.id || n.node_id || n.data?.id || n.data?.node_id || n.unique_id || `node-${idx}`), [selectedNodes]);

  // Best-effort helpers for node display
  const toDisplay = useCallback((n: any) => {
    const id = n.id || n.node_id || n.data?.id || n.data?.node_id || n.unique_id;
    const name = n?.data?.nodeName || n?.data?.label || n?.label || n?.name || id;
    const shapeArr = Array.isArray(n?.data?.shape) ? n.data.shape : null;
    const shape = shapeArr ? `${shapeArr[0]} × ${shapeArr[1]}` : null;
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
      alert('Failed to export nodes');
    } finally {
      setExporting(false);
    }
  }, [currentWorkspaceId, nodeIds, getAuthHeaders, selectedNodes, toDisplay]);

  // Download a single node in the selected format
  const handleDownloadOne = useCallback(async (node: any) => {
    if (!currentWorkspaceId) return;
    const { id, name } = toDisplay(node);
    if (!id) return;
    setDownloadingIds((s) => ({ ...s, [id]: true }));
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
      alert('Failed to download node');
    } finally {
      setDownloadingIds((s) => ({ ...s, [id]: false }));
    }
  }, [currentWorkspaceId, format, getAuthHeaders, toDisplay]);

  return (
    <div className="bg-white rounded-lg shadow p-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-800">Export Nodes</h2>
        <p className="text-sm text-gray-500 mt-1">Select one or more nodes (checkboxes in left sidebar) and choose a format to download their data.</p>
      </div>
      <div className="space-y-2 max-h-[28rem] overflow-y-auto border border-gray-200 rounded-md p-1">
        {selectedNodes.length === 0 && (
          <div className="p-2 text-gray-500 text-sm">No nodes selected. Use the checkboxes in the left sidebar.</div>
        )}
        {selectedNodes.map((n: any) => {
          const info = toDisplay(n);
          return (
            <div key={info.id} className="flex items-center justify-between p-2 border border-gray-200 rounded hover:bg-gray-50">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-800">{info.name}</p>
                <p className="text-[11px] text-gray-400 break-all">{info.id}</p>
                {info.shape && <p className="text-xs text-gray-500">Shape: {info.shape}</p>}
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleDownloadOne(n)}
                  disabled={!!downloadingIds[info.id!]}
                  className="px-2 py-1 text-sm bg-blue-50 text-blue-600 rounded hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Download this node"
                >
                  {downloadingIds[info.id!] ? 'Downloading...' : 'Download'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-end gap-4 flex-wrap">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Format</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            >
              {FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
        </div>
        <button
          onClick={handleExportAll}
          disabled={exporting || nodeIds.length === 0 || !currentWorkspaceId}
          className="px-5 py-2 mt-1.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {exporting && <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />}
          {exporting ? 'Exporting...' : 'Export All (CSV .zip)'}
        </button>
      </div>
      {nodeIds.length === 0 && (
        <div className="text-sm text-gray-500">Select nodes in the left sidebar to enable export.</div>
      )}
    </div>
  );
};

export default ExportTab;