import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface FilePreviewData {
  previewData: Record<string, unknown>[];
  columns: string[];
  loading: boolean;
  error: string | null;
  fileType: string | null;
  sheetNames: string[] | null;
  selectedSheet: string | null;
  setSelectedSheet: (sheet: string | null) => void;
}

interface FilePreviewContentProps {
  filename: string;
  open: boolean;
  onClose: () => void;
  onSheetChange?: (sheet: string | null) => void;
  data: FilePreviewData;
  dialogMaxWidth?: string;
  cardMaxHeight?: string;
  title?: string;
  description?: string;
  headerSlot?: React.ReactNode;
  footer: React.ReactNode;
}

/**
 * Shared file preview layout used by AddFilePanel and FilePreviewPanel.
 * Owns the Dialog + Card chrome, Excel sheet selector, and preview table.
 * Callers provide footer buttons and optional header content via slots.
 *
 * Rendered by: AddFilePanel (confirm dialog with language selector), FilePreviewPanel (read-only preview with pagination).
 * Flow: render Dialog skeleton, Card with header/content/footer, then
 * optionally render a sheet selector for Excel files, followed by a preview
 * table that handles loading / error / empty / data states.
 */
export function FilePreviewContent({
  filename,
  open,
  onClose,
  onSheetChange,
  data,
  dialogMaxWidth = 'min(80vw, 960px)',
  cardMaxHeight = '90vh',
  title,
  description,
  headerSlot,
  footer,
}: FilePreviewContentProps) {
  const isOpen = open && Boolean(filename);
  const {
    previewData,
    columns,
    loading,
    error,
    fileType,
    sheetNames,
    selectedSheet,
    setSelectedSheet,
  } = data;

  const handleSheetChange = (value: string) => {
    const next = value || null;
    setSelectedSheet(next);
    onSheetChange?.(next);
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        className="w-full border-none bg-transparent p-0 shadow-none"
        style={{ maxWidth: dialogMaxWidth }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title ?? `Preview: ${filename}`}</DialogTitle>
          <DialogDescription>
            {description ?? 'Inspect file content before adding to workspace.'}
          </DialogDescription>
        </DialogHeader>
        <Card className="flex w-full min-w-0 flex-col" style={{ maxHeight: cardMaxHeight }}>
          <CardHeader className="border-b px-6 py-4">
            <CardTitle className="truncate text-lg font-semibold">
              {title ?? `File${filename ? `: ${filename}` : ''}`}
            </CardTitle>
            <CardDescription>{description ?? ''}</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 min-w-0 space-y-4 overflow-auto px-6 py-6">
            {headerSlot}
            {fileType === 'excel' && sheetNames && sheetNames.length > 0 && (
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Sheet</label>
                <Select value={selectedSheet ?? ''} onValueChange={handleSheetChange}>
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
                <p className="mt-1 text-xs text-muted-foreground">
                  The first sheet loads by default. Choose another to refresh the preview.
                </p>
              </div>
            )}
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                Preview (first rows)
              </label>
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
                      {previewData.map((row, rowIndex) => (
                        <tr
                          key={rowIndex}
                          className={rowIndex % 2 ? 'bg-muted/50' : 'bg-background'}
                        >
                          {columns.map((column) => (
                            <td
                              key={column}
                              className="max-w-48 truncate px-2 py-1"
                              title={String((row[column] ?? '') as string | number | boolean)}
                            >
                              {String((row[column] ?? '') as string | number | boolean)}
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
          {footer}
        </Card>
      </DialogContent>
    </Dialog>
  );
}
