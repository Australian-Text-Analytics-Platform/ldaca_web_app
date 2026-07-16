import { type SyntheticEvent, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { setRuntimeBackendUrl } from '@/lib/backend/runtimeBackend';

/**
 * Renders the Tauri-owned working-directory form inside `SettingsDialog`.
 * The native supervisor validates the path, restarts the local backend, and
 * rolls back on failure. This panel only rebinds frontend state to the ready
 * backend URL returned by that transaction.
 */
export function DataFolderSettingsPanel() {
  const queryClient = useQueryClient();
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [path, setPath] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let active = true;
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke<string | null>('get_data_root'))
      .then((configuredPath) => {
        if (!active) return;
        setCurrentPath(configuredPath);
        setPath(configuredPath ?? '');
      })
      .catch((error: unknown) => {
        console.error('Failed to read working directory:', error);
        toast.error('Failed to read working directory');
      });
    return () => {
      active = false;
    };
  }, []);

  /**
   * Opens the native directory picker for the Settings path field.
   */
  const handleBrowse = async () => {
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
  };

  /**
   * Commits one native data-root switch and rebinds all cached server state.
   * If the switch rolls back, rediscover the replacement backend port before
   * reporting the original error.
   */
  const handleSubmit = async (event: SyntheticEvent) => {
    event.preventDefault();
    const nextPath = path.trim();
    if (!nextPath) return;

    setIsLoading(true);
    try {
      await queryClient.cancelQueries();
      const { invoke } = await import('@tauri-apps/api/core');
      const backendUrl = await invoke<string>('set_data_root', { dataRoot: nextPath });
      setRuntimeBackendUrl(backendUrl);
      setCurrentPath(nextPath);
      await queryClient.resetQueries();
      toast.success('Working directory updated');
    } catch (error: unknown) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const backendUrl = await invoke<string>('get_backend_url');
        setRuntimeBackendUrl(backendUrl);
        await queryClient.resetQueries();
      } catch (rebindError) {
        console.error('Failed to rediscover backend after data-root error:', rebindError);
      }
      console.error('Failed to update working directory:', error);
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
        <p className="break-all text-sm text-muted-foreground">
          Current: {currentPath ?? 'Not configured'}
        </p>
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
