import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { useFilePreview } from '../../hooks/useFilePreview';
import { SUPPORTED_LANGUAGES } from '@/lib/languages';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { defaultNodeNameFromFile } from '@/features/data-loader/utils/fileTreeHelpers';
import { acceptPlaceholderOnTab } from '@/features/preprocessing/utils/placeholderTabFill';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

interface AddFilePanelProps {
  filename: string | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (selectedSheet?: string | null, nodeName?: string) => Promise<void> | void;
}

export const AddFilePanel: React.FC<AddFilePanelProps> = ({ filename, open, onClose, onConfirm }) => {
  const {
    previewData,
    columns,
    loading,
    error,
    fileType,
    sheetNames,
    selectedSheet,
    setSelectedSheet,
  } = useFilePreview(filename, open);

  // Phase 4.2: language selector. Selecting a non-English language here
  // updates the per-user ``defaultLanguage`` preference, which the
  // per-feature ``effective_language`` resolvers (Phase 3 / 4.5) then
  // honor for every analysis on the new corpus. Existing English flows
  // are unchanged when the user leaves the default selected.
  const defaultLanguage = usePreferencesStore((state) => state.defaultLanguage);
  const setDefaultLanguage = usePreferencesStore((state) => state.setDefaultLanguage);
  const selectedLanguage = defaultLanguage ?? 'en';

  const [submitting, setSubmitting] = useState(false);
  // User-supplied data block name. Empty string means "use the server's
  // derived default" — the placeholder shows what that default would be.
  const [nodeName, setNodeName] = useState('');
  const defaultName = useMemo(() => defaultNodeNameFromFile(filename ?? ''), [filename]);

  useEffect(() => {
    if (!open) {
      setSubmitting(false);
      setNodeName('');
    }
  }, [open]);

  // Reset the typed name whenever the source file changes so a stale value
  // from a previous panel open doesn't leak into the next file.
  useEffect(() => {
    setNodeName('');
  }, [filename]);

  const handleClose = () => {
    onClose();
  };

  const handleConfirm = async () => {
    if (!filename) return;
    try {
      setSubmitting(true);
      const trimmed = nodeName.trim();
      // Blank input means "let the server compute the default" — passing
      // undefined keeps the API contract symmetric with the placeholder UX.
      await onConfirm(selectedSheet, trimmed || undefined);
      handleClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open && Boolean(filename)}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleClose();
        }
      }}
    >
      <DialogContent className="w-full max-w-[min(80vw,960px)] border-none bg-transparent p-0 shadow-none">
        <DialogHeader className="sr-only">
          <DialogTitle>{filename ? `Add file: ${filename}` : 'Add file to workspace'}</DialogTitle>
          <DialogDescription>Files are added as data blocks automatically. Choose an optional sheet, inspect the preview, and confirm.</DialogDescription>
        </DialogHeader>
        <Card className="flex w-full max-h-[90vh] min-w-0 flex-col">
          <CardHeader className="border-b px-6 py-4">
            <CardTitle className="truncate text-lg font-semibold">Add File{filename ? `: ${filename}` : ''}</CardTitle>
            <CardDescription>
              Files are added as data blocks automatically. Choose an optional sheet, inspect the preview, and confirm before adding it to the workspace.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex-1 min-w-0 space-y-4 overflow-auto px-6 py-6">
            <div>
              <Label htmlFor="add-file-node-name" className="mb-2 block text-sm font-medium text-foreground">
                Data block name
              </Label>
              <Input
                id="add-file-node-name"
                value={nodeName}
                placeholder={defaultName}
                onChange={(event) => setNodeName(event.target.value)}
                onKeyDown={(event) =>
                  acceptPlaceholderOnTab({ event, value: nodeName, setValue: setNodeName })
                }
                aria-label="Data block name"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Leave blank to use the suggested name above. Press Tab to fill it in and edit, or start typing to replace it.
              </p>
            </div>
            <div>
              <label
                htmlFor="add-file-language"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                Language
              </label>
              <Select
                value={selectedLanguage}
                onValueChange={(value) => {
                  setDefaultLanguage(value);
                }}
              >
                <SelectTrigger id="add-file-language" aria-label="Corpus language">
                  <SelectValue placeholder="English" />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LANGUAGES.map((option) => (
                    <SelectItem key={option.code} value={option.code}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                Sets the default for this and future corpora. Analysis tools
                without a language-specific implementation (e.g. quotation
                extractor) will disable themselves on non-English corpora.
              </p>
            </div>
            {fileType === 'excel' && sheetNames && sheetNames.length > 0 && (
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Sheet</label>
                <Select
                  value={selectedSheet || ''}
                  onValueChange={(value) => {
                    const next = value || null;
                    setSelectedSheet(next);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a sheet" />
                  </SelectTrigger>
                  <SelectContent>
                    {sheetNames.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">The first sheet loads by default. Choose another to refresh the preview.</p>
              </div>
            )}
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">Preview (first rows)</label>
              <div className="max-h-60 w-full min-w-0 max-w-full overflow-x-auto overflow-y-auto rounded border border-border">
                {loading ? (
                  <div className="p-4 text-sm text-muted-foreground">Loading…</div>
                ) : error ? (
                  <div className="p-4 text-sm text-destructive">{error}</div>
                ) : previewData.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground">No preview</div>
                ) : (
                  <table className="min-w-max text-xs">
                    <thead>
                      <tr className="bg-muted">
                        {columns.map((column) => (
                          <th key={column} className="px-2 py-1 text-left font-medium">
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.slice(0, 10).map((row, rowIndex) => (
                        <tr key={rowIndex} className={rowIndex % 2 ? 'bg-muted/50' : 'bg-background'}>
                          {columns.map((column) => (
                            <td
                              key={column}
                              className="max-w-48 truncate px-2 py-1"
                              title={String(row[column] ?? '')}
                            >
                              {String(row[column] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </CardContent>

          <CardFooter className="border-t px-6 py-4">
            <div className="flex w-full items-center justify-end gap-2">
              <Button variant="outline" onClick={handleClose} type="button">
                Cancel
              </Button>
              <Button size="sm" onClick={handleConfirm} disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Adding…
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Add to Workspace
                  </>
                )}
              </Button>
            </div>
          </CardFooter>
        </Card>
      </DialogContent>
    </Dialog>
  );
};

export default AddFilePanel;
