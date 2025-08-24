import React, { useState, useCallback } from 'react';
import { useWorkspace } from '../hooks/useWorkspace';
import NodeSelectionPanel from './NodeSelectionPanel';
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
  const { selectedNodes, getNodeShape, currentWorkspaceId } = useWorkspace();
  const { getAuthHeaders } = useAuth();
  const [format, setFormat] = useState('csv');
  const [exporting, setExporting] = useState(false);

  const nodeIds = selectedNodes.map((n: any, idx: number) => n.id || n.node_id || n.data?.id || n.data?.node_id || n.unique_id || `node-${idx}`);

  const handleExport = useCallback(async () => {
    if (!currentWorkspaceId || nodeIds.length === 0) return;
    setExporting(true);
    try {
  const params = new URLSearchParams({ node_ids: nodeIds.join(','), format });
  const apiBase = getApiBase();
  const resp = await fetch(`${apiBase}/workspaces/${currentWorkspaceId}/export?` + params.toString(), {
        headers: getAuthHeaders(),
      });
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      const multiple = nodeIds.length > 1;
      const ext = multiple ? 'zip' : (format === 'ipc' ? 'arrow' : format);
      const filename = multiple ? `export_${currentWorkspaceId}.${format}.zip` : `${(selectedNodes[0].name || nodeIds[0])}.${ext}`;
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
  }, [currentWorkspaceId, nodeIds, format, getAuthHeaders, selectedNodes]);

  return (
    <div className="bg-white rounded-lg shadow p-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-800">Export Nodes</h2>
        <p className="text-sm text-gray-500 mt-1">Select one or more nodes (checkboxes in left sidebar) and choose a format to download their data.</p>
      </div>
      <NodeSelectionPanel
        selectedNodes={selectedNodes}
        nodeColumnSelections={[]} // no column selection required for export
        onColumnChange={()=>{}}
        nodeColors={{}}
        onColorChange={()=>{}}
        getNodeColumns={() => []}
        defaultPalette={[]} // not used
        maxCompare={selectedNodes.length || 0}
        showHeaderLabel={false}
        showColorPicker={false}
        showShape
  getNodeShapeFn={getNodeShape}
      />
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
          onClick={handleExport}
          disabled={exporting || nodeIds.length === 0 || !currentWorkspaceId}
          className="px-5 py-2 mt-1.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {exporting && <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />}
          {exporting ? 'Exporting...' : 'Export'}
        </button>
      </div>
      {nodeIds.length === 0 && (
        <div className="text-sm text-gray-500">Select nodes in the left sidebar to enable export.</div>
      )}
    </div>
  );
};

export default ExportTab;