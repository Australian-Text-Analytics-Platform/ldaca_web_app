import {
  CircleAlert,
  Download as DownloadIcon,
  Loader2,
  MoreHorizontal,
  Star,
  Trash2,
} from 'lucide-react';
import type { WorkspaceCatalogueItem } from '@/api';
import { Button } from '@/components/ui/button';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { WorkspaceDownloadsHandle } from '@/features/workspace/workspace-downloads/WorkspaceDownloadsContext';
import { formatTimestamp } from '../utils/format';

interface WorkspaceManagerItemProps {
  workspace: WorkspaceCatalogueItem;
  currentWorkspaceId: string | null;
  hasActiveTask: boolean;
  selectionOperation: { workspaceId: string | null; action: 'load' | 'unload' } | null;
  downloads: WorkspaceDownloadsHandle;
  loadFailure?: string;
  favorite: boolean;
  onToggleFavorite: () => void;
  onLoadWorkspace: (workspaceId: string | null) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
}

const WorkspaceDescription = ({ description }: { description?: string | null }) => {
  const trimmedDescription = description?.trim();
  let descriptionText = 'No description added yet.';
  if (trimmedDescription) descriptionText = trimmedDescription;
  return (
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
        <div className="px-2 py-1.5 text-body text-widget-foreground whitespace-pre-wrap">
          {descriptionText}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** Renders one available or unavailable workspace and its valid actions. */
export function WorkspaceManagerItem({
  workspace,
  currentWorkspaceId,
  hasActiveTask,
  selectionOperation,
  downloads,
  loadFailure,
  favorite,
  onToggleFavorite,
  onLoadWorkspace,
  onDeleteWorkspace,
}: WorkspaceManagerItemProps) {
  const workspaceId = workspace.id;
  if ('message' in workspace) {
    const isIncompatible = workspace.reason === 'incompatible_format';
    const trimmedWorkspaceName = workspace.name?.trim();
    let workspaceName = 'Unnamed workspace';
    if (trimmedWorkspaceName) workspaceName = trimmedWorkspaceName;
    return (
      <div
        data-testid={`workspace-manager-item-${workspaceId}`}
        className="flex flex-col gap-3 rounded-md border border-error/50 bg-error/5 px-4 py-3 @min-[480px]/workspace-manager:flex-row @min-[480px]/workspace-manager:items-center @min-[480px]/workspace-manager:justify-between"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1 font-medium">
            <CircleAlert className="h-4 w-4 shrink-0 text-error" aria-hidden="true" />
            <span className="text-error">{workspaceName}</span>
            <WorkspaceDescription description={workspace.description} />
          </div>
          <div className="mt-1 break-all text-[11px] text-description">
            Workspace ID: <span>{workspaceId}</span>
          </div>
          <div className="mt-2 text-label-secondary text-description">
            Created {formatTimestamp(workspace.created_at)} | Updated{' '}
            {formatTimestamp(workspace.modified_at)}
          </div>
          <div className="mt-2 max-w-prose text-label-secondary text-description">
            {workspace.message}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <DisabledReasonTooltip reason={isIncompatible ? undefined : workspace.message}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void downloads.startDownload(workspaceId, workspaceName);
              }}
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
  const isSelectionTarget =
    selectionOperation?.action === 'load'
      ? selectionOperation.workspaceId === workspaceId
      : selectionOperation?.action === 'unload' && isActive;
  return (
    <div
      data-testid={`workspace-manager-item-${workspaceId}`}
      className={`flex flex-col gap-2 rounded-md border px-4 py-3 @min-[480px]/workspace-manager:flex-row @min-[480px]/workspace-manager:items-center @min-[480px]/workspace-manager:justify-between ${
        loadFailure
          ? 'border-error/50 bg-error/5'
          : isActive
            ? 'border-button bg-button/10 ring-1 ring-focus/20'
            : 'border-surface-border/70 bg-editor'
      }`}
    >
      <div>
        <div className="flex items-center gap-1 font-medium text-foreground">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 shrink-0"
            aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
            onClick={onToggleFavorite}
          >
            <Star
              className={`h-4 w-4 ${
                favorite
                  ? 'fill-[var(--vscode-charts-orange)] text-[var(--vscode-charts-orange)]'
                  : 'text-description'
              }`}
            />
          </Button>
          <span>{workspace.name.trim() ? workspace.name : workspaceId}</span>
          <WorkspaceDescription description={workspace.description} />
        </div>
        <div className="text-label-secondary text-description">
          Updated {formatTimestamp(workspace.modified_at)} | {workspace.total_nodes} data block
          {workspace.total_nodes === 1 ? '' : 's'}
        </div>
        {loadFailure ? (
          <div
            role="alert"
            className="mt-2 flex max-w-prose items-start gap-1.5 text-label-secondary text-error"
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
            {isSelectionTarget ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
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
          onClick={() => {
            void downloads.startDownload(
              workspaceId,
              workspace.name.trim() ? workspace.name : workspaceId,
            );
          }}
          disabled={downloads.isStarting(workspaceId) || downloads.isPending(workspaceId)}
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
}
