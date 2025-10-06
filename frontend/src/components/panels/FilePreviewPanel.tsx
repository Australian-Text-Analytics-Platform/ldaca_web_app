import React, { useCallback, useEffect, useMemo } from 'react';
import { useFilePreview } from '../../hooks/useFilePreview';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '../ui/sheet';
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
    <Sheet
      open={open && Boolean(filename)}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="sm:max-w-4xl w-full overflow-hidden">
        <SheetHeader className="px-1">
          <SheetTitle className="truncate">Preview{filename ? `: ${filename}` : ''}</SheetTitle>
          <SheetDescription>Inspect the first rows of the uploaded file before adding it to a workspace.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-auto px-1">
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">Loading…</div>
          ) : error ? (
            <div className="py-12 text-center text-destructive">{error}</div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">No preview data</div>
          ) : (
            <div className="w-full overflow-auto">
              <table className="min-w-full text-sm">
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

        <SheetFooter className="border-t border-border/70 px-1 py-3">
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
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default FilePreviewPanel;
