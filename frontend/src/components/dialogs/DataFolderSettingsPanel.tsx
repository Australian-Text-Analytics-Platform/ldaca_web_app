import { type SyntheticEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import { updateAdminConfig } from '@/api';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { isTauri } from '@/lib/isTauri';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Renders the live working-directory settings form inside `SettingsDialog`.
 * Changing the backend data root affects auth-derived configuration, workspace
 * selection, and both workspace/file caches, so this panel owns that complete
 * transition rather than exposing callbacks to an orphan dialog shell.
 *
 * Flow: seed the path from auth state, optionally browse in Tauri, unload the
 * active workspace before a path change, update admin config, refresh auth and
 * server-state queries, then report the result through the global toaster.
 */
export function DataFolderSettingsPanel() {
  const queryClient = useQueryClient();
  const { dataFolder, refreshAuth } = useAuth();
  const { currentWorkspaceId } = useWorkspaceData();
  const { setCurrentWorkspace } = useWorkspaceActions();
  const [path, setPath] = useState(dataFolder ?? '');
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Opens the native directory picker for the Settings path field. Called by:
   * this panel's Browse button; web builds retain typed-path input and explain
   * why a native picker is unavailable.
   */
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
   * Commits a data-root change from `SettingsDialog` without leaving workspace
   * or file queries pointed at the old root.
   *
   * Steps: validate the trimmed path, unload an active workspace only when the
   * directory changes, update backend config, refresh auth, then refetch the
   * workspace and file query families before releasing the busy state.
   */
  const handleSubmit = async (event: SyntheticEvent) => {
    event.preventDefault();
    const nextPath = path.trim();
    if (!nextPath) return;

    setIsLoading(true);
    try {
      const currentPath = dataFolder?.trim() ?? '';
      const isDirectoryChanging = nextPath !== currentPath;

      if (isDirectoryChanging && currentWorkspaceId) {
        await setCurrentWorkspace(null);
      }

      await updateAdminConfig({ body: { data_root: nextPath }, throwOnError: true });
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
    } catch (error: unknown) {
      console.error('Failed to update config:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to update working directory');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
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
              onChange={(event) => {
                setPath(event.target.value);
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
        <Button type="submit" disabled={isLoading || !path.trim()}>
          {isLoading ? 'Saving...' : 'Save changes'}
        </Button>
      </DialogFooter>
    </form>
  );
}
