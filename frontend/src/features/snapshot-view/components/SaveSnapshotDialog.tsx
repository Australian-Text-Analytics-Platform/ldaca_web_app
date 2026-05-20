import React, { useEffect, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
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
import { Textarea } from '@/components/ui/textarea';
import type { SnapshotToolKey } from '../types';

/** Maximum allowed length of the user-typed name *before* the
 * ``<tool>-`` prefix and ``.ldaca-snapshot`` suffix. Matches the
 * server-side cap in ``api/snapshots.py``. */
const MAX_NAME_LENGTH = 80;
const INVALID_NAME_CHARS = /[/\\:*?"<>|]/;

export interface SaveSnapshotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tool key — used to build the on-disk filename and check
   * collisions against the existing tool-scoped list. */
  tool: SnapshotToolKey;
  /** Pre-fetched list of filenames already in the user's snapshots
   * folder for this tool. The dialog uses this to inline-validate
   * the typed name (no overwrite-confirm modal — the user authored
   * the name, they should adjust it instead of overwriting). */
  existingFilenames: string[];
  /** Default name shown when the dialog opens. Typically a
   * tool + timestamp suggestion the user can accept or edit. */
  defaultName?: string;
  /** Called when the user clicks Save with a valid + unique name.
   * Receives the validated filename (already includes the
   * ``<tool>-`` prefix and ``.ldaca-snapshot`` suffix) and the
   * raw description text. The implementation does the actual
   * capture + upload; this dialog is purely presentational. */
  onSave: (filename: string, description: string) => Promise<void>;
}

function sanitiseName(raw: string): string {
  return raw.replace(INVALID_NAME_CHARS, '_').trim();
}

interface NameValidation {
  ok: boolean;
  /** ``error`` is null when the name is fine; otherwise a
   * user-facing message shown beneath the input. */
  error: string | null;
}

function validateName(
  rawName: string,
  tool: SnapshotToolKey,
  existingFilenames: string[],
): NameValidation {
  const trimmed = rawName.trim();
  if (!trimmed) {
    return { ok: false, error: null }; // Empty — disable Save without nagging.
  }
  if (INVALID_NAME_CHARS.test(rawName)) {
    return { ok: false, error: 'Name can\'t contain / \\ : * ? " < > |' };
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Name is too long (max ${MAX_NAME_LENGTH} chars)` };
  }
  const filename = `${tool}-${trimmed}.ldaca-snapshot`;
  if (existingFilenames.includes(filename)) {
    return { ok: false, error: 'A snapshot with this name already exists' };
  }
  return { ok: true, error: null };
}

export const SaveSnapshotDialog: React.FC<SaveSnapshotDialogProps> = ({
  open,
  onOpenChange,
  tool,
  existingFilenames,
  defaultName,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Reset state every time the dialog opens, prefilled with the
  // default name suggestion. The reset on close is important so a
  // failed save followed by re-open starts clean.
  /* eslint-disable react-hooks/set-state-in-effect -- intentional reset on open; cascade is the desired behavior, not a perf bug */
  useEffect(() => {
    if (open) {
      setName(defaultName ?? '');
      setDescription('');
      setIsSaving(false);
    }
  }, [open, defaultName]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const validation = validateName(name, tool, existingFilenames);

  const handleSave = async () => {
    if (!validation.ok || isSaving) return;
    const filename = `${tool}-${sanitiseName(name)}.ldaca-snapshot`;
    setIsSaving(true);
    try {
      await onSave(filename, description);
      toast.success(`Saved snapshot "${name.trim()}"`);
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save snapshot';
      toast.error(msg);
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !isSaving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-4 w-4" /> Save snapshot
          </DialogTitle>
          <DialogDescription>
            Save the current view so you can re-open it later or share it via the
            <code className="mx-1 rounded bg-muted px-1 text-xs">.ldaca-snapshot</code>
            file on disk.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="snapshot-name">Name</Label>
            <Input
              id="snapshot-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. pride-prejudice-demo"
              disabled={isSaving}
              autoFocus
            />
            <p
              className={
                validation.error
                  ? 'text-xs text-destructive'
                  : 'text-xs text-muted-foreground'
              }
            >
              {validation.error ??
                `On disk: ${tool}-${sanitiseName(name) || '<name>'}.ldaca-snapshot`}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="snapshot-description">Description (optional)</Label>
            <Textarea
              id="snapshot-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notes for whoever opens this snapshot later…"
              disabled={isSaving}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!validation.ok || isSaving}
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
