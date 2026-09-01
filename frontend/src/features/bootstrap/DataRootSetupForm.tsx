import { useState } from 'react';
import { FolderOpen } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { isTauri } from '@/lib/isTauri';

interface DataRootSetupFormProps {
  currentPath?: string | null;
  suggestedPath: string | null;
  submitLabel?: string;
  onSubmit: (path: string) => Promise<void>;
}

export function DataRootSetupForm({
  currentPath,
  suggestedPath,
  submitLabel = 'Use this folder',
  onSubmit,
}: DataRootSetupFormProps) {
  const desktopRuntime = isTauri();
  const [path, setPath] = useState(currentPath ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (selectedPath: string) => {
    const nextPath = selectedPath.trim();
    if (!nextPath) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(nextPath);
      setPath(nextPath);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Data Root could not be opened');
    } finally {
      setSubmitting(false);
    }
  };

  const chooseFolder = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      directory: true,
      title: 'Choose Data Root',
      defaultPath: path.trim() ? path : (suggestedPath ?? undefined),
    });
    if (typeof selected === 'string') await submit(selected);
  };

  return (
    <div className="w-full space-y-4 text-left">
      {currentPath && (
        <p className="break-all text-body-secondary text-description">
          Current Data Root: {currentPath}
        </p>
      )}
      {desktopRuntime ? (
        <Button
          type="button"
          className="w-full"
          disabled={submitting}
          onClick={() => {
            void chooseFolder();
          }}
        >
          <FolderOpen className="h-4 w-4" />
          Choose folder
        </Button>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(path);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="data-root-path">Folder on the server</Label>
            <Textarea
              id="data-root-path"
              value={path}
              disabled={submitting}
              placeholder={suggestedPath ?? '/absolute/server/path'}
              wrap="soft"
              className="resize-none break-all"
              onChange={(event) => {
                setPath(event.target.value);
              }}
            />
            <p className="text-label-secondary text-description">
              This is an absolute filesystem path on the machine running Wordflow, not a folder
              upload from this browser.
            </p>
          </div>
          <Button type="submit" className="w-full" disabled={submitting || !path.trim()}>
            {submitting ? 'Opening…' : submitLabel}
          </Button>
        </form>
      )}
      {suggestedPath && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={submitting}
          onClick={() => {
            void submit(suggestedPath);
          }}
        >
          Use recommended location
        </Button>
      )}
      {error && <p className="text-body text-error">{error}</p>}
    </div>
  );
}
