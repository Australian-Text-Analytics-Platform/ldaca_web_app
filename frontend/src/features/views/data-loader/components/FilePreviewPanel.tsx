import { useFilePreview } from '../hooks/useFilePreview';
import { FilePreviewContent } from './FilePreviewContent';
import { CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface FilePreviewPanelProps {
  filename: string | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Read-only file preview dialog used by the data loader before import. It owns
 * preview pagination and worksheet selection while the caller controls which
 * filename is being inspected. Delegates the shared Dialog/Card/table layout to
 * FilePreviewContent and supplies pagination controls in the footer slot.
 *
 * Why: upload/import flows need an inspect-only preview that can page and
 * switch Excel sheets without mutating the workspace.
 * Flow: read preview hook data, derive previous/next availability, then render
 * via FilePreviewContent with a paginated footer.
 */
export function FilePreviewPanel({ filename, open, onClose }: FilePreviewPanelProps) {
  const {
    previewData,
    columns,
    hasNext,
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

  const canPrev = page > 1;
  const canNext = hasNext;

  const handlePrev = () => {
    if (!filename || !canPrev) return;
    setPage((p) => Math.max(1, p - 1));
  };

  const handleNext = () => {
    if (!filename || !canNext) return;
    setPage((p) => p + 1);
  };

  const handleSheetChange = (sheet: string | null) => {
    setSelectedSheet(sheet);
    setPage(1);
  };

  const footer = (
    <CardFooter className="border-t px-6 py-4">
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">Page {page}</div>
        <div className="flex items-center gap-2">
          <Button onClick={handlePrev} disabled={!canPrev || loading} variant="outline" size="sm">
            Prev
          </Button>
          <Button onClick={handleNext} disabled={!canNext || loading} variant="outline" size="sm">
            Next
          </Button>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              setPageSize(Number(value));
              setPage(1);
            }}
          >
            <SelectTrigger className="w-20" aria-label="Rows per page">
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
  );

  return (
    <FilePreviewContent
      filename={filename ?? ''}
      open={open}
      onClose={onClose}
      onSheetChange={handleSheetChange}
      data={{
        previewData,
        columns,
        loading,
        error,
        fileType,
        sheetNames,
        selectedSheet,
        setSelectedSheet,
      }}
      dialogMaxWidth="min(80vw, 1000px)"
      title={filename ? `Preview: ${filename}` : 'File preview'}
      description="Inspect file content before adding to workspace."
      footer={footer}
    />
  );
}
