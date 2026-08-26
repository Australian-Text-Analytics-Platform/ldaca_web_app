import { Loader2, RefreshCcw, Upload } from 'lucide-react';
import React, { useRef } from 'react';
import type { WorkspaceCatalogueItem } from '@/api';
import HelpIcon from '@/components/help/HelpIcon';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useUpdateUserPreferences,
  useUserPreferences,
} from '@/features/preferences/useUserPreferences';
import type { WorkspaceDownloadsHandle } from '@/features/workspace/workspace-downloads/WorkspaceDownloadsContext';
import { WorkspaceManagerItem } from './WorkspaceManagerItem';

export interface WorkspaceManagerCardProps {
  workspaces: WorkspaceCatalogueItem[];
  currentWorkspaceId: string | null;
  busy: boolean;
  hasActiveTask?: boolean;
  selectionOperation?: {
    workspaceId: string | null;
    action: 'load' | 'unload';
  } | null;
  uploadingZip: boolean;
  refreshing: boolean;
  downloads: WorkspaceDownloadsHandle;
  loadFailures?: Readonly<Record<string, string>>;
  onUploadZip: (file: File) => Promise<void> | void;
  onRefresh: () => void;
  onLoadWorkspace: (workspaceId: string | null) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
}

/**
 * Lists saved workspaces and their quick actions. `DataLoaderFeature` uses it
 * beside the active-workspace card for load/unload, favorite, download, delete,
 * refresh, and ZIP upload controls.
 * Rendered by `DataLoaderFeature` beside `ActiveWorkspaceCard`.
 * Flow: render the workspace list and controls, capture rename/delete/save/upload events, and
 * hand mutations to parent hooks while reflecting busy states.
 */
export function WorkspaceManagerCard({
  workspaces,
  currentWorkspaceId,
  busy,
  hasActiveTask = false,
  selectionOperation = null,
  uploadingZip,
  refreshing,
  downloads,
  loadFailures = {},
  onUploadZip,
  onRefresh,
  onLoadWorkspace,
  onDeleteWorkspace,
}: WorkspaceManagerCardProps) {
  const zipInputRef = useRef<HTMLInputElement | null>(null);
  const { preferences } = useUserPreferences();
  const updatePreferences = useUpdateUserPreferences();
  const favoriteWorkspaces = preferences.favorite_workspaces ?? [];
  const isFavorite = (workspaceId: string) => favoriteWorkspaces.includes(workspaceId);
  const toggleFavorite = (workspaceId: string) => {
    updatePreferences.mutate({
      favorite_workspaces: isFavorite(workspaceId)
        ? favoriteWorkspaces.filter((id) => id !== workspaceId)
        : [...favoriteWorkspaces, workspaceId],
    });
  };

  /**
   * Forwards the selected ZIP file to the parent upload action and clears the
   * file input so selecting the same archive again still fires change events.
   * Attached to the hidden workspace-ZIP input's `onChange` prop.
   */
  const handleZipChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await onUploadZip(file);
    } finally {
      event.target.value = '';
    }
  };

  return (
    <Card
      data-guidance="workspace-manager"
      className="@container/workspace-manager flex h-full flex-col overflow-hidden"
    >
      <CardHeader>
        <div className="flex flex-col items-stretch gap-2 @min-[288px]/workspace-manager:flex-row @min-[288px]/workspace-manager:items-center @min-[288px]/workspace-manager:justify-between">
          <CardTitle className="flex items-center gap-2">
            Workspace manager
            <HelpIcon
              targetKey="data-loader.workspace-manager.section"
              label="Workspace manager overview"
              tooltip="Switch between saved workspaces or remove ones you no longer need."
            />
          </CardTitle>
          <div className="flex w-full flex-wrap items-center gap-1 @min-[288px]/workspace-manager:w-auto @min-[288px]/workspace-manager:justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => zipInputRef.current?.click()}
              disabled={uploadingZip || busy}
            >
              <Upload className="mr-1.5 h-4 w-4" />
              {uploadingZip ? 'Uploading…' : 'Upload workspace'}
            </Button>
            <input
              ref={zipInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => {
                void handleZipChange(e);
              }}
            />
            <Button
              size="icon"
              variant="ghost"
              aria-label="Refresh workspace list"
              title="Refresh workspace list"
              onClick={onRefresh}
              disabled={refreshing || busy}
            >
              <RefreshCcw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col min-h-0 overflow-hidden">
        {busy && !workspaces.length ? (
          <div className="flex items-center gap-2 text-body text-description">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading workspaces…
          </div>
        ) : workspaces.length === 0 ? (
          <div className="rounded-md border border-dashed border-surface-border-foreground/60 px-4 py-3 text-center text-body text-description">
            No workspaces yet. Create one to get started.
          </div>
        ) : (
          <div className="space-y-3 overflow-y-auto pr-2">
            {workspaces.map((workspace) => (
              <WorkspaceManagerItem
                key={workspace.id}
                workspace={workspace}
                currentWorkspaceId={currentWorkspaceId}
                hasActiveTask={hasActiveTask}
                selectionOperation={selectionOperation}
                downloads={downloads}
                loadFailure={loadFailures[workspace.id]}
                favorite={isFavorite(workspace.id)}
                onToggleFavorite={() => {
                  toggleFavorite(workspace.id);
                }}
                onLoadWorkspace={onLoadWorkspace}
                onDeleteWorkspace={onDeleteWorkspace}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
