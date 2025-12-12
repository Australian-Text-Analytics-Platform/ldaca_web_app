import React, { useCallback, useEffect, useState } from 'react';
import { useFilePreview } from '../../hooks/useFilePreview';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

interface AddFilePanelProps {
  filename: string | null;
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
}

export const AddFilePanel: React.FC<AddFilePanelProps> = ({ filename, open, onClose, onConfirm }) => {
  const {
    previewData,
    columns,
    fetchPreview,
    clearPreview,
    loading,
    error,
    fileType,
    sheetNames,
    selectedSheet,
    setSelectedSheet
  } = useFilePreview();

  const [submitting, setSubmitting] = useState(false);

  const resetState = useCallback(() => {
    setSubmitting(false);
    if (selectedSheet) {
      setSelectedSheet(null);
    }
    clearPreview();
  }, [clearPreview, selectedSheet, setSelectedSheet]);

  useEffect(() => {
    if (open && filename) {
      fetchPreview(filename, 0);
    } else if (!open) {
      resetState();
    }
  }, [open, filename, fetchPreview, resetState]);


  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleConfirm = useCallback(async () => {
    if (!filename) return;
    try {
      setSubmitting(true);
      await onConfirm();
      handleClose();
    } finally {
      setSubmitting(false);
    }
  }, [filename, onConfirm, handleClose]);

  return (
    <Dialog
      open={open && Boolean(filename)}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleClose();
        }
      }}
    >
      <DialogContent className="w-full max-w-[min(80vw,_960px)] border-none bg-transparent p-0 shadow-none">
        <DialogHeader className="sr-only">
          <DialogTitle>{filename ? `Add file: ${filename}` : 'Add file to workspace'}</DialogTitle>
          <DialogDescription>Files are staged as DocLazyFrames automatically. Choose an optional sheet, inspect the preview, and confirm.</DialogDescription>
        </DialogHeader>
        <Card className="flex w-full max-h-[90vh] min-w-0 flex-col">
          <CardHeader className="border-b px-6 py-4">
            <CardTitle className="truncate text-lg font-semibold">Add File{filename ? `: ${filename}` : ''}</CardTitle>
            <CardDescription>
              Files are added as DocLazyFrames automatically. Choose an optional sheet, inspect the preview, and confirm to stage the node lazily.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex-1 min-w-0 space-y-6 overflow-auto px-6 py-6">
            {fileType === 'excel' && sheetNames && sheetNames.length > 0 && (
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Sheet</label>
                <Select
                  value={selectedSheet || ''}
                  onValueChange={(value) => {
                    const next = value || null;
                    setSelectedSheet(next);
                    if (filename) {
                      fetchPreview(filename, 0, { sheetName: next || undefined });
                    }
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
                              className="max-w-[12rem] truncate px-2 py-1"
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
              <Button onClick={handleConfirm} disabled={submitting}>
                {submitting ? 'Adding…' : 'Add to Workspace'}
              </Button>
            </div>
          </CardFooter>
        </Card>
      </DialogContent>
    </Dialog>
  );
};

export default AddFilePanel;
