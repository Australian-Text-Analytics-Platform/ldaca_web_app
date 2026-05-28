import React, { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { useFilePreview } from '../../hooks/useFilePreview';
import { SUPPORTED_LANGUAGES } from '@/lib/languages';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

interface AddFilePanelProps {
  filename: string | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (selectedSheet?: string | null) => Promise<void> | void;
}

/**
 * Confirmation dialog opened by the data loader before a selected file becomes
 * a workspace block. It gates rendering on a filename so preview hooks only run
 * for an actual file chosen by the uploader.
 * Rendered by: DataLoaderFeature when a pending upload needs confirmation.
 * Flow: combine open state with filename presence, mirror close events to the caller, then mount the dialog content only for a concrete file.
 */
export const AddFilePanel: React.FC<AddFilePanelProps> = ({ filename, open, onClose, onConfirm }) => {
  const isOpen = open && Boolean(filename);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      {isOpen && filename && (
        <AddFilePanelContent
          filename={filename}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      )}
    </Dialog>
  );
};

/**
 * File-add dialog body used by `AddFilePanel`. It shows preview rows, optional
 * Excel sheet selection, and corpus language defaults before delegating the
 * actual add operation back to the data-loader feature.
 * Why: adding a file needs preview, sheet, and language choices gathered before the data-loader mutates the workspace.
 * Flow: query preview data, read/update language preference, manage submit state, then render language, sheet, preview, and confirm controls.
 */
function AddFilePanelContent({
  filename,
  onClose,
  onConfirm,
}: Omit<AddFilePanelProps, 'open'> & { filename: string }) {
  const {
    previewData,
    columns,
    loading,
    error,
    fileType,
    sheetNames,
    selectedSheet,
    setSelectedSheet,
  } = useFilePreview(filename, true);

  const defaultLanguage = usePreferencesStore((state) => state.defaultLanguage);
  const setDefaultLanguage = usePreferencesStore((state) => state.setDefaultLanguage);
  const selectedLanguage = defaultLanguage ?? 'en';

  const [submitting, setSubmitting] = useState(false);

  /** Called by: AddFilePanelContent Cancel button and post-confirm close path because the interaction needs a single handler that validates state, runs the action, and updates feedback. */
  const handleClose = () => {
    onClose();
  };

  /** Called by: AddFilePanelContent Add to Workspace button because the interaction needs a single handler that validates state, runs the action, and updates feedback. */
  const handleConfirm = async () => {
    if (!filename) return;
    try {
      setSubmitting(true);
      await onConfirm(selectedSheet);
      handleClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
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
  );
}

export default AddFilePanel;
