import { type SyntheticEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { updateConfig } from '@/api';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { queryKeys } from '@/lib/queryKeys';
import { isTauri } from '@/lib/isTauri';
import { toast } from 'sonner';
import { FolderOpen } from 'lucide-react';

interface DataFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DataFolderSettingsPanelProps {
  onSaved?: () => void;
  onCancel?: () => void;
}

/**
 * Working-directory modal shell used by the sidebar in single-user desktop/web
 * mode. It mounts the content only while open so auth/query state is refreshed
 * from the latest app configuration each time the user edits the folder.
 * Why: callers need a focused rendering boundary for layout, accessibility, and state handoff.
 */
export function DataFolderDialog({ open, onOpenChange }: DataFolderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <DataFolderDialogContent onOpenChange={onOpenChange} />}
    </Dialog>
  );
}

/**
 * Form body for changing the backend data root. It coordinates auth refresh,
 * workspace reset, and query refetching so file/workspace consumers see the new
 * directory immediately after the dialog closes.
 * Why: changing the data root affects auth config, workspace selection, file lists, and workspace queries together.
 * Flow: seed the path from auth state, handle desktop folder picking, submit config changes, refresh auth/cache, and close on success.
 */
function DataFolderDialogContent({ onOpenChange }: Pick<DataFolderDialogProps, 'onOpenChange'>) {
  return (
    <DialogContent className="sm:max-w-106.25">
      <DialogHeader>
        <DialogTitle>Set Working Directory</DialogTitle>
        <DialogDescription>
          Choose the folder where your data is stored. This setting applies globally.
        </DialogDescription>
      </DialogHeader>
      <DataFolderSettingsPanel
        onSaved={() => {
          onOpenChange(false);
        }}
        onCancel={() => {
          onOpenChange(false);
        }}
      />
    </DialogContent>
  );
}

/**
 * Reusable working-directory settings form shared by the standalone dialog and
 * the unified Settings dialog. It keeps the existing backend config update,
 * auth refresh, workspace unload, and query refetch behavior in one place.
 * Used by: DataFolderDialog and SettingsDialog because both surfaces need the same single-user data-root update flow.
 * Flow: seed the path from auth state, handle desktop folder picking, submit config changes, refresh auth/cache, and notify the owning shell on success.
 */
export function DataFolderSettingsPanel({ onSaved, onCancel }: DataFolderSettingsPanelProps) {
  const queryClient = useQueryClient();
  const { dataFolder, refreshAuth } = useAuth();
  const { currentWorkspaceId } = useWorkspaceData();
  const { setCurrentWorkspace } = useWorkspaceActions();
  const [path, setPath] = useState(dataFolder ?? '');
  const [isLoading, setIsLoading] = useState(false);

  /** Called by: the DataFolderDialogContent Browse button because the interaction needs a single handler that validates state, runs the action, and updates feedback. */
  const handleBrowse = async () => {
    if (isTauri()) {
      try {
        const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
        const selected = await openDialog({
          directory: true,
          title: 'Select Working Directory',
          defaultPath: path || undefined,
        });
        if (selected) {
          setPath(selected);
        }
      } catch (error) {
        console.error('Failed to open folder picker:', error);
        toast.error('Failed to open folder picker');
      }
    } else {
      toast.info(
        'Type the full path to your data folder, or use the desktop app for a folder picker.',
      );
    }
  };

  /**
   * Called by: the DataFolderDialogContent form onSubmit prop because the interaction needs a single handler that validates state, runs the action, and updates feedback.
   * Flow: validate a non-empty path, clear the active workspace when the directory changes, update backend config, refresh auth/files/workspaces, and toast outcomes.
   */
  const handleSubmit = async (e: SyntheticEvent) => {
    e.preventDefault();
    const nextPath = path.trim();
    if (!nextPath) return;

    setIsLoading(true);
    try {
      const currentPath = dataFolder?.trim() ?? '';
      const isDirectoryChanging = nextPath !== currentPath;

      if (isDirectoryChanging && currentWorkspaceId) {
        await setCurrentWorkspace(null);
      }

      await updateConfig({ body: { data_root: nextPath }, throwOnError: true });
      toast.success('Working directory updated');
      await refreshAuth();
      await Promise.all([
        queryClient.refetchQueries({
          queryKey: queryKeys.workspaces,
          exact: true,
        }),
        queryClient.refetchQueries({
          queryKey: queryKeys.files,
        }),
      ]);
      onSaved?.();
    } catch (error: unknown) {
      console.error('Failed to update config:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to update working directory');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
    >
      <div className="grid gap-4 py-4">
        <div className="grid gap-2 sm:grid-cols-4 sm:items-center sm:gap-4">
          <Label htmlFor="path" className="sm:text-right">
            Path
          </Label>
          <div className="flex gap-2 sm:col-span-3">
            <Input
              id="path"
              value={path}
              onChange={(e) => {
                setPath(e.target.value);
              }}
              className="flex-1"
              placeholder="/path/to/data"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => {
                void handleBrowse();
              }}
              title="Browse..."
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
      <DialogFooter>
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={isLoading || !path.trim()}>
          {isLoading ? 'Saving...' : 'Save changes'}
        </Button>
      </DialogFooter>
    </form>
  );
}
