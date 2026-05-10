import React, { useRef } from 'react';
import { Download as DownloadIcon, Loader2, MoreHorizontal, RefreshCcw, Star, Trash2, Upload } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import HelpIcon from '@/components/help/HelpIcon';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { formatBytes, formatTimestamp, getWorkspaceId } from '../utils/format';
import type { PendingWorkspaceDownloadsHandle } from '../hooks/usePendingWorkspaceDownloads';

export type WorkspaceListItem = {
  id?: string;
  unique_id?: string;
  name?: string;
  description?: string;
  modified_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  total_nodes?: number;
  dataframe_count?: number;
  workspace_size_Byte?: number;
};

export type WorkspaceManagerCardProps = {
  workspaces: WorkspaceListItem[];
  currentWorkspaceId: string | null;
  busy: boolean;
  uploadingZip: boolean;
  refreshing: boolean;
  downloads: PendingWorkspaceDownloadsHandle;
  onUploadZip: (file: File) => Promise<void> | void;
  onRefresh: () => void;
  onLoadWorkspace: (workspaceId: string | null) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
};

export const WorkspaceManagerCard: React.FC<WorkspaceManagerCardProps> = ({
  workspaces,
  currentWorkspaceId,
  busy,
  uploadingZip,
  refreshing,
  downloads,
  onUploadZip,
  onRefresh,
  onLoadWorkspace,
  onDeleteWorkspace,
}) => {
  const zipInputRef = useRef<HTMLInputElement | null>(null);
  const { toggleFavorite, isFavorite } = usePreferencesStore();

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
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            Workspace manager
            <HelpIcon
              targetKey="data-loader.workspace-manager.section"
              label="Workspace manager overview"
              tooltip="Switch between saved workspaces or remove ones you no longer need."
            />
          </CardTitle>
          <div className="flex items-center gap-1">
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
              onChange={handleZipChange}
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
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading workspaces…
          </div>
        ) : workspaces.length === 0 ? (
          <div className="rounded-md border border-dashed border-muted-foreground/60 px-4 py-3 text-center text-sm text-muted-foreground">
            No workspaces yet. Create one to get started.
          </div>
        ) : (
          <div className="space-y-3 overflow-y-auto pr-2">
            {workspaces.map((workspace) => {
              const workspaceId = getWorkspaceId(workspace);
              if (!workspaceId) return null;
              const isActive = workspaceId === currentWorkspaceId;
              const blockCount = workspace.total_nodes ?? workspace.dataframe_count ?? 0;
              return (
                <div
                  key={workspaceId}
                  data-testid={`workspace-manager-item-${workspaceId}`}
                  className={`flex flex-col gap-2 rounded-md border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                    isActive
                      ? 'border-primary bg-primary/10 ring-1 ring-primary/20 shadow-sm'
                      : 'border-border/70 bg-background'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-1 font-medium text-foreground">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 shrink-0"
                        aria-label={isFavorite(workspaceId) ? 'Remove from favorites' : 'Add to favorites'}
                        onClick={() => toggleFavorite(workspaceId)}
                      >
                        <Star
                          className={`h-4 w-4 ${
                            isFavorite(workspaceId) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'
                          }`}
                        />
                      </Button>
                      <span>{workspace.name || workspaceId}</span>
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            aria-label="View workspace description"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="max-w-xs">
                          <DropdownMenuLabel>Description</DropdownMenuLabel>
                          <div className="px-2 py-1.5 text-sm text-popover-foreground whitespace-pre-wrap">
                            {workspace.description?.trim() || 'No description added yet.'}
                          </div>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Updated {formatTimestamp(workspace.modified_at || workspace.updated_at)} | {blockCount} data block{blockCount === 1 ? '' : 's'} | Size {formatBytes(Number(workspace.workspace_size_Byte || 0))}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={isActive ? 'outline' : 'secondary'}
                      onClick={() => onLoadWorkspace(isActive ? null : workspaceId)}
                    >
                      {isActive ? 'Unload' : 'Load'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void downloads.startDownload(workspaceId, workspace.name || workspaceId)}
                      disabled={downloads.isStarting(workspaceId) || downloads.isPending(workspaceId)}
                    >
                      <DownloadIcon className="mr-1.5 h-4 w-4" />
                      {downloads.isPending(workspaceId)
                        ? 'Preparing…'
                        : downloads.isStarting(workspaceId)
                          ? 'Starting…'
                          : 'Download'}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => onDeleteWorkspace(workspaceId)}>
                      <Trash2 className="mr-1.5 h-4 w-4" /> Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default WorkspaceManagerCard;
