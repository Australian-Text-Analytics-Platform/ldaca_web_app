import React from 'react';
import { useFilePreview } from '../../hooks/useFilePreview';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

interface FilePreviewPanelProps {
  filename: string | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Read-only file preview dialog used by the data loader before import. It owns
 * preview pagination and worksheet selection while the caller controls which
 * filename is being inspected.
 * Why: upload/import flows need an inspect-only preview that can page and switch Excel sheets without mutating the workspace.
 * Flow: read preview hook data, derive previous/next availability, then render sheet picker, preview table, and paging controls.
 */
export const FilePreviewPanel: React.FC<FilePreviewPanelProps> = ({ filename, open, onClose }) => {
  const {
    previewData,
    columns,
    totalRows,
    fileType,
    sheetNames,
    selectedSheet,
    setSelectedSheet,
    page,
    pageSize,
    loading,
    error,
    setPage,
    setPageSize,
  } = useFilePreview(filename, open);

  const canPrev = page > 0;
  const canNext = totalRows ? (page + 1) * pageSize < totalRows : previewData.length > 0;

  /** Called by: FilePreviewPanel Prev button because the interaction needs a single handler that validates state, runs the action, and updates feedback. */
  const handlePrev = () => {
    if (!filename || !canPrev) return;
    setPage((p) => p - 1);
  };

  /** Called by: FilePreviewPanel Next button because the interaction needs a single handler that validates state, runs the action, and updates feedback. */
  const handleNext = () => {
    if (!filename || !canNext) return;
    setPage((p) => p + 1);
  };

  return (
    <Dialog
      open={open && Boolean(filename)}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <DialogContent className="w-full max-w-[min(80vw,1000px)] border-none bg-transparent p-0 shadow-none">
        <DialogHeader className="sr-only">
          <DialogTitle>{filename ? `Preview: ${filename}` : 'File preview'}</DialogTitle>
          <DialogDescription>Inspect the first rows of the uploaded file before adding it to a workspace.</DialogDescription>
        </DialogHeader>
        <Card className="flex h-[85vh] w-full max-h-[90vh] min-w-0 flex-col">
          <CardHeader className="border-b px-6 py-4">
            <CardTitle className="truncate text-lg font-semibold">Preview{filename ? `: ${filename}` : ''}</CardTitle>
            <CardDescription>Inspect the first rows of the uploaded file before adding it to a workspace.</CardDescription>
          </CardHeader>

          <CardContent className="flex-1 min-w-0 overflow-hidden px-0 py-0">
            <div className="h-full w-full min-w-0 overflow-y-auto px-6 py-4">
              {fileType === 'excel' && sheetNames && sheetNames.length > 0 && (
                <div className="mb-4">
                  <label className="mb-2 block text-sm font-medium text-foreground">Sheet</label>
                  <Select
                    value={selectedSheet || ''}
                    onValueChange={(value) => {
                      const next = value || null;
                      setSelectedSheet(next);
                      setPage(0);
                    }}
                  >
                    <SelectTrigger className="w-full max-w-xs">
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
                  <p className="mt-1 text-xs text-muted-foreground">Choose a worksheet to refresh the preview.</p>
                </div>
              )}

              {loading ? (
                <div className="py-12 text-center text-muted-foreground">Loading…</div>
              ) : error ? (
                <div className="py-12 text-center text-destructive">{error}</div>
              ) : previewData.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">No preview data</div>
              ) : (
                <div className="w-full min-w-0 max-w-full overflow-x-auto rounded-md border border-border/50">
                  <table className="min-w-max max-w-full text-sm">
                    <thead>
                      <tr className="bg-muted">
                        {columns.map((column) => (
                          <th key={column} className="whitespace-nowrap px-3 py-2 text-left font-medium">
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.map((row, rowIndex) => (
                        <tr key={rowIndex} className={rowIndex % 2 ? 'bg-muted/40' : 'bg-background'}>
                          {columns.map((column) => {
                            const cellValue = String(row[column] ?? '');
                            return (
                              <td key={`${column}-${rowIndex}`} className="max-w-xs truncate px-3 py-2" title={cellValue}>
                                {cellValue}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </CardContent>

          <CardFooter className="border-t px-6 py-4">
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground">
                Page {page + 1}
                {totalRows ? ` of ~${Math.ceil(totalRows / pageSize)}` : ''}
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={handlePrev} disabled={!canPrev || loading} variant="outline" size="sm">
                  Prev
                </Button>
                <Button onClick={handleNext} disabled={!canNext || loading} variant="outline" size="sm">
                  Next
                </Button>
                <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50, 100].map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardFooter>
        </Card>
      </DialogContent>
    </Dialog>
  );
};

export default FilePreviewPanel;
