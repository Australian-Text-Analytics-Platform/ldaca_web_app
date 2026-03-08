import React, { useState, useEffect } from 'react';
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
import { toast } from 'sonner';

interface DataFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const DataFolderDialog: React.FC<DataFolderDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { dataFolder, refreshAuth } = useAuth();
  const [path, setPath] = useState(dataFolder || '');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (open && dataFolder) {
      setPath(dataFolder);
    }
  }, [open, dataFolder]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await configApi.updateConfig({ data_root: path });
      toast.success('Working directory updated');
      await refreshAuth();
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
              <Input
                id="path"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                className="col-span-3"
                placeholder="/path/to/data"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving...' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
