import { type FormEvent, useEffect, useState } from 'react';
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
import { configApi } from '@/api/config';
import { useAuth } from '@/hooks/useAuth';
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';
import { useWorkspaceData } from '@/hooks/useWorkspaceData';
import { queryKeys } from '@/lib/queryKeys';
import { toast } from 'sonner';
import { FolderOpen } from 'lucide-react';

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

interface DataFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DataFolderDialog({
  open,
  onOpenChange,
}: DataFolderDialogProps) {
  const queryClient = useQueryClient();
  const { dataFolder, refreshAuth } = useAuth();
  const { currentWorkspaceId } = useWorkspaceData();
  const { setCurrentWorkspace } = useWorkspaceActions();
  const [path, setPath] = useState(dataFolder || '');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (open && dataFolder) {
      setPath(dataFolder);
    }
  }, [open, dataFolder]);

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
      toast.info('Type the full path to your data folder, or use the desktop app for a folder picker.');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
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

      await configApi.updateConfig({ data_root: nextPath });
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
      onOpenChange(false);
    } catch (error: unknown) {
      console.error('Failed to update config:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to update working directory');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Set Working Directory</DialogTitle>
          <DialogDescription>
            Choose the folder where your data is stored. This setting applies globally.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="path" className="text-right">
                Path
              </Label>
              <div className="col-span-3 flex gap-2">
                <Input
                  id="path"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  className="flex-1"
                  placeholder="/path/to/data"
                />
                <Button type="button" variant="outline" size="icon" onClick={handleBrowse} title="Browse...">
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !path.trim()}>
              {isLoading ? 'Saving...' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
