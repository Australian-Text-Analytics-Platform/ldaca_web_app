import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface DataBlockRenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
  value: string;
  onValueChange: (value: string) => void;
  onRename: (name: string) => void;
}

/**
 * Canonical Data Block rename dialog shared by graph cards and sidebar rows.
 * The caller owns the draft so each entry point can seed it from its current
 * node before opening; this component owns validation and modal geometry.
 */
export function DataBlockRenameDialog({
  open,
  onOpenChange,
  currentName,
  value,
  onValueChange,
  onRename,
}: DataBlockRenameDialogProps) {
  const trimmedValue = value.trim();
  const canRename = trimmedValue.length > 0 && trimmedValue !== currentName;

  const handleSubmit = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canRename) return;
    onRename(trimmedValue);
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-[calc(100vw-2rem)] min-w-0 max-w-lg">
        <form className="grid min-w-0 gap-3" onSubmit={handleSubmit}>
          <AlertDialogHeader className="min-w-0">
            <AlertDialogTitle>Rename Data Block</AlertDialogTitle>
            <AlertDialogDescription>Enter a new name for this Data Block.</AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={value}
            onChange={(event) => {
              onValueChange(event.target.value);
            }}
            aria-label="New Data Block name"
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <Button type="submit" disabled={!canRename}>
              Rename
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
