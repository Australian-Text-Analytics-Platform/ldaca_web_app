import React, { useCallback, useEffect, useMemo } from 'react';
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

export const FilePreviewPanel: React.FC<FilePreviewPanelProps> = ({ filename, open, onClose }) => {
  const { previewData, columns, totalRows, page, pageSize, loading, error, fetchPreview, clearPreview, setPageSize } = useFilePreview();

  const rows = useMemo(() => previewData as ReadonlyArray<Record<string, unknown>>, [previewData]);

  useEffect(() => {
    if (open && filename) {
      fetchPreview(filename, 0);
    } else if (!open) {
      clearPreview();
    }
  }, [open, filename, fetchPreview, clearPreview]);

  const canPrev = page > 0;
  const canNext = totalRows ? (page + 1) * pageSize < totalRows : rows.length > 0;

  const handlePrev = useCallback(() => {
    if (!filename || !canPrev) return;
    fetchPreview(filename, page - 1);
  }, [filename, canPrev, fetchPreview, page]);

  const handleNext = useCallback(() => {
    if (!filename || !canNext) return;
    fetchPreview(filename, page + 1);
  }, [filename, canNext, fetchPreview, page]);

  return (
    <Dialog
      open={open && Boolean(filename)}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <DialogContent className="w-full max-w-[min(80vw,_1000px)] border-none bg-transparent p-0 shadow-none">
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
              {loading ? (
                <div className="py-12 text-center text-muted-foreground">Loading…</div>
              ) : error ? (
                <div className="py-12 text-center text-destructive">{error}</div>
              ) : rows.length === 0 ? (
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
                      {rows.map((row, rowIndex) => (
                        <tr key={rowIndex} className={rowIndex % 2 ? 'bg-muted/40' : 'bg-background'}>
                          {columns.map((column) => (
                            <td key={`${column}-${rowIndex}`} className="whitespace-nowrap px-3 py-2">
                              {String(row[column] ?? '')}
                            </td>
                          ))}
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
