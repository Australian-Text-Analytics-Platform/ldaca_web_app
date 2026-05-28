import { useState } from 'react';
import { LogOut, Plus, RefreshCcw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import HelpIcon from '@/components/help/HelpIcon';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { formatBytes, formatTimestamp } from '../utils/format';
import type { WorkspaceListItem } from './WorkspaceManagerCard';

export type ActiveWorkspaceCardProps = {
  currentWorkspace: WorkspaceListItem | null;
  nodeCount: number;
  busy: boolean;
  hasActiveTask?: boolean;
  onCreate: (name: string, description: string) => Promise<boolean>;
  onRename: (value: string) => Promise<void> | void;
  onUpdateDescription: (value: string) => Promise<void> | void;
  onSave: () => Promise<void> | void;
  onUnload: () => Promise<void> | void;
};

/**
 * Renders the active-workspace/create-workspace panel. `DataLoaderFeature`
 * uses it to keep workspace creation and currently loaded workspace controls
 * in one card while delegating persistence to workspace hooks.
 * Rendered by: DataLoaderFeature module (rg call sites/imports) because the parent needs this component boundary to keep feature controls and state presentation isolated.
 * Flow: sync local editable drafts to the active workspace identity, choose create vs
 * active-workspace controls, gate unsafe unloads while tasks run, then forward
 * save/rename/create events to parent actions.
 */
export function ActiveWorkspaceCard({
  currentWorkspace,
  nodeCount,
  busy,
  hasActiveTask = false,
  onCreate,
  onRename,
  onUpdateDescription,
  onSave,
  onUnload,
}: ActiveWorkspaceCardProps) {
  const hasWorkspaceSelected = Boolean(currentWorkspace);
  const workspaceKey = currentWorkspace?.id ?? currentWorkspace?.unique_id ?? null;

  const [renameValue, setRenameValue] = useState(currentWorkspace?.name ?? '');
  const [descriptionValue, setDescriptionValue] = useState(currentWorkspace?.description ?? '');
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceDescription, setNewWorkspaceDescription] = useState('');

  // Reset rename/description inputs when the active workspace switches (or
  // when its persisted name/description change underneath us). React-blessed
  // pattern: derive state during render, not in an effect.
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [syncedKey, setSyncedKey] = useState(workspaceKey);
  const [syncedName, setSyncedName] = useState(currentWorkspace?.name ?? '');
  const [syncedDescription, setSyncedDescription] = useState(currentWorkspace?.description ?? '');
  if (
    workspaceKey !== syncedKey ||
    (currentWorkspace?.name ?? '') !== syncedName ||
    (currentWorkspace?.description ?? '') !== syncedDescription
  ) {
    setSyncedKey(workspaceKey);
    setSyncedName(currentWorkspace?.name ?? '');
    setSyncedDescription(currentWorkspace?.description ?? '');
    setRenameValue(currentWorkspace?.name ?? '');
    setDescriptionValue(currentWorkspace?.description ?? '');
  }

  const normalizedCurrentDescription = (currentWorkspace?.description || '').trim();
  const normalizedDescriptionValue = descriptionValue.trim();

  /**
   * Submits the create form and clears local inputs only after the parent
   * workspace action reports success.
   * Called by: ActiveWorkspaceCard internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleCreate = async () => {
    const ok = await onCreate(newWorkspaceName.trim(), newWorkspaceDescription.trim());
    if (ok) {
      setNewWorkspaceName('');
      setNewWorkspaceDescription('');
    }
  };

  return (
    <Card
      data-testid={currentWorkspace ? 'active-workspace-card' : 'create-workspace-card'}
      data-hint-id="workspace.create-or-load"
      className="flex h-full flex-col overflow-hidden"
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {currentWorkspace ? 'Active workspace' : 'Create workspace'}
          {currentWorkspace ? (
            <HelpIcon
              targetKey="data-loader.active-workspace.section"
              label="Active workspace overview"
              tooltip="Choose or rename the workspace where new data blocks will be added. Save regularly to persist your progress."
            />
          ) : (
            <HelpIcon
              targetKey="data-loader.create-workspace.name"
              label="Create workspace overview"
              tooltip="Create a new workspace before uploading files or adding data blocks. Add an optional description if you want to capture its purpose."
            />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 overflow-y-auto space-y-4">
        {currentWorkspace ? (
          <>
            <div className="rounded-md border border-border/60 bg-muted/30 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground">
                {currentWorkspace.name}
                <Badge>
                  {nodeCount} data block{nodeCount === 1 ? '' : 's'}
                </Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Updated {formatTimestamp(currentWorkspace.modified_at || currentWorkspace.updated_at)} | Size{' '}
                {formatBytes(Number(currentWorkspace.workspace_size_Byte || 0))} | Created{' '}
                {formatTimestamp(currentWorkspace.created_at)}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="rename-workspace">Rename workspace</Label>
                <HelpIcon targetKey="data-loader.rename-workspace.input" label="Rename workspace input" />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="rename-workspace"
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  placeholder="Enter new name"
                  disabled={!hasWorkspaceSelected || busy}
                />
                <Button
                  onClick={() => void onRename(renameValue.trim())}
                  disabled={!hasWorkspaceSelected || !renameValue.trim()}
                >
                  Rename
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="workspace-description">Workspace description</Label>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="workspace-description"
                  aria-label="Workspace description"
                  value={descriptionValue}
                  onChange={(event) => setDescriptionValue(event.target.value)}
                  placeholder="Enter workspace description"
                  disabled={!hasWorkspaceSelected || busy}
                />
                <Button
                  onClick={() => void onUpdateDescription(descriptionValue.trim())}
                  disabled={!hasWorkspaceSelected || busy || normalizedDescriptionValue === normalizedCurrentDescription}
                >
                  Update description
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => void onSave()} disabled={!hasWorkspaceSelected}>
                <RefreshCcw className="mr-2 h-4 w-4" /> Save
              </Button>
              <div className="flex items-center gap-1">
                <DisabledReasonTooltip
                  reason={
                    hasActiveTask
                      ? 'A task is still running on this workspace. Wait for it to finish, or cancel it from the task list, before unloading.'
                      : undefined
                  }
                >
                  <Button
                    variant="outline"
                    onClick={() => void onUnload()}
                    disabled={!hasWorkspaceSelected || busy || hasActiveTask}
                  >
                    <LogOut className="mr-2 h-4 w-4" /> Unload
                  </Button>
                </DisabledReasonTooltip>
                <HelpIcon targetKey="data-loader.unload.button" label="Unload workspace" />
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <Input
              id="new-workspace-name"
              value={newWorkspaceName}
              onChange={(event) => setNewWorkspaceName(event.target.value)}
              placeholder="Workspace name"
            />
            <Input
              value={newWorkspaceDescription}
              onChange={(event) => setNewWorkspaceDescription(event.target.value)}
              placeholder="Optional description"
            />
            <div className="flex items-center gap-2">
              <DisabledReasonTooltip reason={!newWorkspaceName.trim() ? 'Enter a workspace name first' : undefined}>
                <Button onClick={() => void handleCreate()} disabled={!newWorkspaceName.trim()}>
                  <Plus className="mr-2 h-4 w-4" /> Create workspace
                </Button>
              </DisabledReasonTooltip>
              <HelpIcon targetKey="data-loader.create-workspace.button" label="Create workspace" />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default ActiveWorkspaceCard;
