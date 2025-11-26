import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useFilePreview } from '../../hooks/useFilePreview';
import columnPersistence from '../../utils/columnPersistence';
import { useWorkspaceData } from '../../hooks/useWorkspaceData';
import { Dialog, DialogContent } from '../ui/dialog';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

const ALL_MODES = ['DocLazyFrame', 'LazyFrame', 'DocDataFrame', 'DataFrame'] as const;

type AddMode = (typeof ALL_MODES)[number];
type DocumentMode = Extract<AddMode, 'DocLazyFrame' | 'DocDataFrame'>;

interface AddFilePanelProps {
  filename: string | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (opts: { mode: AddMode; documentColumn?: string | null }) => Promise<void> | void;
}

const isDocumentMode = (mode: AddMode): mode is DocumentMode => mode === 'DocLazyFrame' || mode === 'DocDataFrame';

const coerceMode = (mode: string | null | undefined): AddMode => {
  if (!mode) return 'DocLazyFrame';
  return isAddMode(mode) ? mode : 'DocLazyFrame';
};

const isAddMode = (value: string): value is AddMode => {
  switch (value) {
    case 'DocLazyFrame':
    case 'LazyFrame':
    case 'DocDataFrame':
    case 'DataFrame':
      return true;
    default:
      return false;
  }
};

type PreviewRow = Record<string, unknown>;

function guessDocumentColumn(columns: string[], rows: ReadonlyArray<PreviewRow>): string | null {
  if (!columns.length || !rows.length) return null;
  const stringCols = columns.filter((col) => rows.some((row) => typeof row[col] === 'string' && row[col] !== 'None'));
  if (!stringCols.length) return null;
  if (stringCols.length === 1) return stringCols[0];
  const averages: Record<string, number> = {};
  stringCols.forEach((col) => {
    let total = 0;
    let count = 0;
    rows.forEach((row) => {
      const value = row[col];
      if (typeof value === 'string') {
        total += value.length;
        count++;
      }
    });
    averages[col] = count ? total / count : 0;
  });
  return stringCols.sort((a, b) => averages[b] - averages[a])[0];
}

export const AddFilePanel: React.FC<AddFilePanelProps> = ({ filename, open, onClose, onConfirm }) => {
  const { currentWorkspaceId } = useWorkspaceData();
  const {
    previewData,
    columns,
    fetchPreview,
    clearPreview,
    loading,
    error,
    fileType,
    supportedTypes,
    sheetNames,
    selectedSheet,
    setSelectedSheet
  } = useFilePreview();

  const [mode, setMode] = useState<AddMode>('DocLazyFrame');
  const [documentColumn, setDocumentColumn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const guessedColumn = useMemo(
    () => guessDocumentColumn(columns, previewData as ReadonlyArray<PreviewRow>),
    [columns, previewData]
  );

  const filePersistenceCtx = useMemo(
    () => ({
      workspaceId: currentWorkspaceId ?? null,
      scope: 'add-file-panel',
      storage: 'local' as const
    }),
    [currentWorkspaceId]
  );

  const persistedDocumentColumn = useMemo(() => {
    if (!filename) return null;
    return columnPersistence.get(filePersistenceCtx, filename);
  }, [filePersistenceCtx, filename]);

  const resetState = useCallback(() => {
    setMode('DocLazyFrame');
    setDocumentColumn(null);
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

  useEffect(() => {
    if (!supportedTypes || supportedTypes.length === 0) return;
    const fallback = coerceMode(supportedTypes[0]);
    if (!supportedTypes.includes(mode)) {
      setMode(fallback);
    }
    }, [supportedTypes, mode]);

  useEffect(() => {
    if (!open) return;

    if (!isDocumentMode(mode)) {
      setDocumentColumn(null);
      return;
    }

    if (fileType === 'text') {
      setDocumentColumn(columns[0] || 'text');
      return;
    }

    setDocumentColumn((prev) => prev || persistedDocumentColumn || guessedColumn || null);
  }, [mode, guessedColumn, persistedDocumentColumn, open, fileType, columns]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleConfirm = useCallback(async () => {
    if (!filename) return;
    try {
      setSubmitting(true);
      await onConfirm({
        mode,
        documentColumn: isDocumentMode(mode) ? documentColumn || undefined : undefined
      });
      if (isDocumentMode(mode) && filename && documentColumn && fileType !== 'text') {
        columnPersistence.set(filePersistenceCtx, filename, documentColumn);
      }
      handleClose();
    } finally {
      setSubmitting(false);
    }
  }, [filename, mode, documentColumn, onConfirm, filePersistenceCtx, handleClose, fileType]);

  const autoDocumentColumn = isDocumentMode(mode) && fileType === 'text';
  const allowDocumentColumn = isDocumentMode(mode) && !autoDocumentColumn;

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
        <Card className="flex w-full max-h-[90vh] min-w-0 flex-col">
          <CardHeader className="border-b px-6 py-4">
            <CardTitle className="truncate text-lg font-semibold">Add File{filename ? `: ${filename}` : ''}</CardTitle>
            <CardDescription>
              Configure how the file should be added to the current workspace. Options are pre-filled using recent choices.
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
              <label className="mb-2 block text-sm font-medium text-foreground">Mode</label>
              <div className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {(supportedTypes?.length ? supportedTypes : [...ALL_MODES]).filter(isAddMode).map((type) => (
                  <label
                    key={type}
                    className={`flex cursor-pointer items-center justify-center gap-2 rounded border border-border bg-background p-2 text-sm shadow-sm transition hover:bg-accent/70 ${
                      mode === type ? 'border-primary ring-1 ring-primary' : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name="add-mode"
                      value={type}
                      checked={mode === type}
                      onChange={() => setMode(type)}
                    />
                    <span className="font-medium">{type}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Doc* modes enable text-aware operations; plain modes add data without text semantics.</p>
            </div>

            {allowDocumentColumn && (
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Text / document column</label>
                {loading ? (
                  <div className="text-sm text-muted-foreground">Loading preview…</div>
                ) : error ? (
                  <div className="text-sm text-destructive">{error}</div>
                ) : (
                  <Select value={documentColumn || ''} onValueChange={(value) => setDocumentColumn(value || null)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a column" />
                    </SelectTrigger>
                    <SelectContent>
                      {columns.map((column) => (
                        <SelectItem key={column} value={column}>
                          {column}
                          {column === guessedColumn ? ' (guessed)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="mt-1 text-xs text-muted-foreground">A preferred column is pre-selected automatically; change it if needed.</p>
              </div>
            )}

            {autoDocumentColumn && (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                Plain text files expose a single column (“{documentColumn ?? 'text'}”). It will be used automatically as the document column.
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
              <Button onClick={handleConfirm} disabled={submitting || (allowDocumentColumn && !documentColumn)}>
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
