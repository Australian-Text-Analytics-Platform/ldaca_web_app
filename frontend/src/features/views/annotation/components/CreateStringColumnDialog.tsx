import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { acceptPlaceholderOnTab } from '@/features/views/common/placeholderTabFill';

interface CreateStringColumnDialogProps {
  open: boolean;
  title: string;
  description: string;
  inputId: string;
  inputLabel: string;
  value: string;
  placeholder: string;
  error: string | null;
  pending: boolean;
  onValueChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

/** Shared dialog for Annotation's empty annotation and correction columns. */
export function CreateStringColumnDialog({
  open,
  title,
  description,
  inputId,
  inputLabel,
  value,
  placeholder,
  error,
  pending,
  onValueChange,
  onClose,
  onSubmit,
}: CreateStringColumnDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) onClose();
      }}
    >
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={inputId}>Column name</Label>
            <Input
              id={inputId}
              aria-label={inputLabel}
              value={value}
              placeholder={placeholder}
              maxLength={500}
              disabled={pending}
              onChange={(event) => {
                onValueChange(event.target.value);
              }}
              onKeyDown={(event) => {
                acceptPlaceholderOnTab({ event, value, setValue: onValueChange });
              }}
            />
            {error ? (
              <p role="alert" className="text-body text-error">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
