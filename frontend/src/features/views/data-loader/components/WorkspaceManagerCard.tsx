import {
  CircleAlert,
  Download as DownloadIcon,
  Loader2,
  MoreHorizontal,
  RefreshCcw,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import React, { useRef } from 'react';
import type { WorkspaceCatalogueItem } from '@/api';
import HelpIcon from '@/components/help/HelpIcon';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  useUpdateUserPreferences,
  useUserPreferences,
} from '@/features/preferences/useUserPreferences';
import type { WorkspaceDownloadsHandle } from '@/features/workspace/workspace-downloads/WorkspaceDownloadsContext';
import { formatTimestamp } from '../utils/format';

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
              const workspaceId = workspace.id;
              if (workspace.availability === 'unavailable') {
                const isIncompatible = workspace.reason === 'incompatible_format';
                const workspaceName = workspace.name?.trim()
                  ? workspace.name.trim()
                  : 'Unnamed workspace';
                const workspaceDescription = workspace.description?.trim()
                  ? workspace.description.trim()
                  : 'No description available.';
                return (
                  <div
                    key={workspaceId}
                    data-testid={`workspace-manager-item-${workspaceId}`}
                    className="flex flex-col gap-3 rounded-md border border-destructive/50 bg-destructive/5 px-4 py-3 @min-[480px]/workspace-manager:flex-row @min-[480px]/workspace-manager:items-center @min-[480px]/workspace-manager:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-medium text-destructive">
                        <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>{workspaceName}</span>
                      </div>
                      <div className="mt-1 break-all text-[11px] text-muted-foreground">
                        <span>Workspace ID: </span>
                        <span>{workspaceId}</span>
                      </div>
                      <div className="mt-2 max-w-prose whitespace-pre-wrap text-xs text-foreground">
                        {workspaceDescription}
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        Created {formatTimestamp(workspace.created_at)} | Updated{' '}
                        {formatTimestamp(workspace.modified_at)}
                      </div>
                      <div className="mt-2 max-w-prose text-xs text-muted-foreground">
                        {workspace.message}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <DisabledReasonTooltip reason={workspace.message}>
                        <Button size="sm" variant="secondary" disabled>
                          Load
                        </Button>
                      </DisabledReasonTooltip>
                      <DisabledReasonTooltip
                        reason={isIncompatible ? undefined : workspace.message}
                      >
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void downloads.startDownload(workspaceId, workspaceName)}
                          disabled={
                            !isIncompatible ||
                            downloads.isStarting(workspaceId) ||
                            downloads.isPending(workspaceId)
                          }
                        >
                          <DownloadIcon className="mr-1.5 h-4 w-4" />
                          {downloads.isPending(workspaceId)
                            ? 'Preparing…'
                            : downloads.isStarting(workspaceId)
                              ? 'Starting…'
                              : 'Download archive'}
                        </Button>
                      </DisabledReasonTooltip>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          onDeleteWorkspace(workspaceId);
                        }}
                      >
                        <Trash2 className="mr-1.5 h-4 w-4" /> Delete
                      </Button>
                    </div>
                  </div>
                );
              }
              const isActive = workspaceId === currentWorkspaceId;
              const blockCount = workspace.total_nodes;
              const loadFailure = loadFailures[workspaceId];
              const isSelectionTarget =
                selectionOperation?.action === 'load'
                  ? selectionOperation.workspaceId === workspaceId
                  : selectionOperation?.action === 'unload' && isActive;
              return (
                <div
                  key={workspaceId}
                  data-testid={`workspace-manager-item-${workspaceId}`}
                  className={`flex flex-col gap-2 rounded-md border px-4 py-3 @min-[480px]/workspace-manager:flex-row @min-[480px]/workspace-manager:items-center @min-[480px]/workspace-manager:justify-between ${
                    loadFailure
                      ? 'border-destructive/50 bg-destructive/5'
                      : isActive
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
                        aria-label={
                          isFavorite(workspaceId) ? 'Remove from favorites' : 'Add to favorites'
                        }
                        onClick={() => {
                          toggleFavorite(workspaceId);
                        }}
                      >
                        <Star
                          className={`h-4 w-4 ${
                            isFavorite(workspaceId)
                              ? 'fill-yellow-400 text-yellow-400'
                              : 'text-muted-foreground'
                          }`}
                        />
                      </Button>
                      {/* an empty workspace name should fall through to its id */}
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
                            {/* an empty/whitespace description should fall through to the placeholder */}
                            {}
                            {workspace.description.trim() || 'No description added yet.'}
                          </div>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Updated {formatTimestamp(workspace.modified_at)} | {blockCount} data block
                      {blockCount === 1 ? '' : 's'}
                    </div>
                    {loadFailure ? (
                      <div
                        role="alert"
                        className="mt-2 flex max-w-prose items-start gap-1.5 text-xs text-destructive"
                      >
                        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>
                          <span className="font-medium">Failed to load:</span> {loadFailure}
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <DisabledReasonTooltip
                      reason={
                        hasActiveTask
                          ? isActive
                            ? 'A task is still running on this workspace. Wait for it to finish, or cancel it from the task list, before unloading.'
                            : 'A task is still running on the current workspace. Wait for it to finish, or cancel it from the task list, before switching workspaces.'
                          : selectionOperation
                            ? 'Another Workspace Load or Unload operation is in progress.'
                            : undefined
                      }
                    >
                      <Button
                        data-guidance={isActive ? undefined : 'load-workspace'}
                        size="sm"
                        variant={isActive ? 'outline' : 'secondary'}
                        onClick={() => {
                          onLoadWorkspace(isActive ? null : workspaceId);
                        }}
                        disabled={hasActiveTask || Boolean(selectionOperation)}
                      >
                        {isSelectionTarget ? (
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : null}
                        {isSelectionTarget
                          ? selectionOperation?.action === 'unload'
                            ? 'Unloading…'
                            : 'Loading…'
                          : isActive
                            ? 'Unload'
                            : 'Load'}
                      </Button>
                    </DisabledReasonTooltip>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        // an empty workspace name should fall through to its id
                        void downloads.startDownload(workspaceId, workspace.name || workspaceId)
                      }
                      disabled={
                        downloads.isStarting(workspaceId) || downloads.isPending(workspaceId)
                      }
                    >
                      <DownloadIcon className="mr-1.5 h-4 w-4" />
                      {downloads.isPending(workspaceId)
                        ? 'Preparing…'
                        : downloads.isStarting(workspaceId)
                          ? 'Starting…'
                          : 'Download'}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        onDeleteWorkspace(workspaceId);
                      }}
                    >
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
}
