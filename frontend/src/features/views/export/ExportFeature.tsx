import { useState } from 'react';
import { Download } from 'lucide-react';
import { exportWorkspaceArchive, type DataBlockExportFormat } from '@/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import HelpIcon from '@/components/help/HelpIcon';
import InfoIcon from '@/components/help/InfoIcon';
import { NodeInputsPanel } from '@/features/views/common/components/NodeInputsPanel';
import type { NodeInput } from '@/features/views/common/nodeInputs/nodeInputsCore';
import { useNodeInputs } from '@/features/views/common/nodeInputs/useNodeInputs';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { projectWorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import {
  DATA_BLOCK_EXPORT_FORMATS,
  downloadDataBlocks,
} from '@/features/workspace/common/dataBlockExport';
import { saveBlob } from '@/lib/download';
import { toast } from 'sonner';

const EXPORT_CONSTRAINTS = {};

const safeStem = (value: string, fallback: string) =>
  (value.trim() || fallback).replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || fallback;

interface ExportSelection {
  workspaceId: string | null;
  inputs: NodeInput[];
}

/** Selects and downloads physical Data Block contents or the complete Workspace archive. */
function ExportFeature() {
  const { currentWorkspaceId, currentWorkspace, nodes } = useWorkspaceData();
  const { selectedNodeIds } = useWorkspaceSelection();
  const [selection, setSelection] = useState<ExportSelection>({
    workspaceId: currentWorkspaceId,
    inputs: [],
  });
  const [format, setFormat] = useState<DataBlockExportFormat>('csv');
  const [exportingDataBlocks, setExportingDataBlocks] = useState(false);
  const [exportingWorkspace, setExportingWorkspace] = useState(false);
  const inputs = selection.workspaceId === currentWorkspaceId ? selection.inputs : [];
  const allNodes = nodes.map(projectWorkspaceNodeMetadata);
  const nodeInputs = useNodeInputs({
    value: inputs,
    onChange: (next) => {
      setSelection({ workspaceId: currentWorkspaceId, inputs: next });
    },
    allNodes,
    constraints: EXPORT_CONSTRAINTS,
  });
  const selectedIds = nodeInputs.resolvedNodes.map((node) => node.id);

  const handleDataBlockExport = async () => {
    if (!currentWorkspaceId || selectedIds.length === 0 || exportingDataBlocks) return;
    setExportingDataBlocks(true);
    try {
      await downloadDataBlocks({
        workspaceId: currentWorkspaceId,
        workspaceName: currentWorkspace?.name ?? '',
        dataBlocks: nodeInputs.selectedNodes.map((node) => ({ id: node.id, name: node.name })),
        format,
      });
      toast.success(
        selectedIds.length === 1
          ? 'Data Block exported'
          : `${String(selectedIds.length)} Data Blocks exported`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not export Data Blocks');
    } finally {
      setExportingDataBlocks(false);
    }
  };

  const handleWorkspaceExport = async () => {
    if (!currentWorkspaceId || exportingWorkspace) return;
    setExportingWorkspace(true);
    try {
      const { data } = await exportWorkspaceArchive({
        parseAs: 'blob',
        path: { workspace_id: currentWorkspaceId },
        throwOnError: true,
      });
      await saveBlob(data, `${safeStem(currentWorkspace?.name ?? '', currentWorkspaceId)}.zip`);
      toast.success('Workspace archive exported');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not export workspace archive');
    } finally {
      setExportingWorkspace(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            Export Data Blocks
            <InfoIcon
              targetKey="export.overview"
              label="About Data Block export"
              tooltip="Download selected Data Blocks in a portable table format."
            />
            <HelpIcon
              targetKey="analysis.export.parameters"
              label="Data Block export"
              tooltip="Choose any number of Data Blocks and one output format."
            />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <NodeInputsPanel
            resolvedNodes={nodeInputs.resolvedNodes}
            availableNodes={nodeInputs.availableNodes}
            graphSelectedIds={selectedNodeIds}
            canAddMore={nodeInputs.canAddMore}
            showAddAll
            maxVisibleCards={3}
            onAddNodes={nodeInputs.addNodes}
            getAddRejection={nodeInputs.getAddRejection}
            onRemoveNode={nodeInputs.removeNode}
            onClear={nodeInputs.clear}
            onColumnChange={nodeInputs.setColumn}
            showColumnPicker={false}
            title="Data Blocks"
            disabled={exportingDataBlocks}
            emptyMessage="No Data Blocks selected. Add individual Data Blocks or use Add all."
          />

          <div className="flex flex-wrap items-end justify-between gap-4 border-t pt-4">
            <div className="w-full max-w-xs space-y-2">
              <label htmlFor="data-block-export-format" className="text-sm font-medium">
                Format
              </label>
              <Select
                value={format}
                disabled={exportingDataBlocks}
                onValueChange={(value) => {
                  const next = DATA_BLOCK_EXPORT_FORMATS.find(
                    (candidate) => candidate.value === value,
                  );
                  if (next) setFormat(next.value);
                }}
              >
                <SelectTrigger id="data-block-export-format" aria-label="Export format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATA_BLOCK_EXPORT_FORMATS.map((candidate) => (
                    <SelectItem key={candidate.value} value={candidate.value}>
                      {candidate.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 text-right">
              <Button
                type="button"
                onClick={() => void handleDataBlockExport()}
                disabled={!currentWorkspaceId || selectedIds.length === 0 || exportingDataBlocks}
                className="gap-2"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                {exportingDataBlocks
                  ? 'Exporting…'
                  : `Export ${String(selectedIds.length)} Data Block${selectedIds.length === 1 ? '' : 's'}`}
              </Button>
              <p className="text-xs text-muted-foreground">
                {selectedIds.length > 1
                  ? 'Multiple files will be packaged into one ZIP.'
                  : 'A single Data Block downloads directly.'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle>Export Workspace</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Export the complete workspace as a self-contained ZIP archive. Import the archive later
            to relocate the workspace.
          </p>
          <Button
            type="button"
            onClick={() => void handleWorkspaceExport()}
            disabled={!currentWorkspaceId || exportingWorkspace}
            variant="outline"
            className="gap-2"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {exportingWorkspace ? 'Exporting…' : 'Export workspace archive'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default ExportFeature;
