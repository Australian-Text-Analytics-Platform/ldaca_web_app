import { useState } from 'react';
import { Download } from 'lucide-react';
import { exportWorkspaceArchive } from '@/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { saveBlob } from '@/lib/download';
import { toast } from 'sonner';
import HelpIcon from '@/components/help/HelpIcon';
import InfoIcon from '@/components/help/InfoIcon';

const safeFilename = (value: string, fallback: string) =>
  `${(value.trim() || fallback).replace(/[^a-zA-Z0-9._-]+/g, '_')}.zip`;

/**
 * Exports the complete self-contained workspace archive.
 *
 * The backend owns archive selection and validation. The browser therefore
 * sends one typed archive request rather than reconstructing obsolete per-node
 * export URLs or format query parameters.
 */
function ExportFeature() {
  const { currentWorkspaceId, currentWorkspace } = useWorkspaceData();
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!currentWorkspaceId || exporting) return;
    setExporting(true);
    try {
      const { data } = await exportWorkspaceArchive({
        parseAs: 'blob',
        path: { workspace_id: currentWorkspaceId },
        throwOnError: true,
      });
      await saveBlob(data, safeFilename(currentWorkspace?.name ?? '', currentWorkspaceId));
      toast.success('Workspace archive exported');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not export workspace archive');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2">
          Export Workspace
          <InfoIcon
            targetKey="export.overview"
            label="About workspace export"
            tooltip="Export the complete workspace as a portable archive."
          />
          <HelpIcon
            targetKey="analysis.export.parameters"
            label="Workspace export"
            tooltip="The archive contains the workspace data, graph, tabs, and analyses."
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Export the complete workspace as a self-contained ZIP archive. Import the archive later to
          relocate the workspace.
        </p>
        <Button
          type="button"
          onClick={() => void handleExport()}
          disabled={!currentWorkspaceId || exporting}
          className="gap-2"
        >
          <Download className="h-4 w-4" />
          {exporting ? 'Exporting…' : 'Export workspace archive'}
        </Button>
      </CardContent>
    </Card>
  );
}

export default ExportFeature;
