import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ServerPaginationFooter } from '@/features/views/common/components/ServerPaginationFooter';
import { useServerTable } from '@/features/views/common/hooks/useServerTable';
import type { AnnotationAiPreviewSession } from '../hooks/useAnnotationAiPreviewSession';
import type { AnnotationNodePageRow } from '../hooks/useAnnotationNodePage';

const NO_CLASS_VALUE = '__no_class__';

/** Coerce an unknown cell value to display text without object stringification. */
const cellText = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

interface AnnotationAiPreviewPanelProps {
  session: AnnotationAiPreviewSession;
}

/**
 * Renders the current Annotation AI preview session without owning its network
 * or cache lifecycle.
 *
 * Rendered by: `AnnotationFeature` while the tab-persisted preview is open.
 * `useAnnotationAiPreviewSession` supplies page data, hydrated/current labels,
 * mutation state, and commands; this component owns only the TanStack table
 * adapter and the detach-confirmation presentation.
 */
export function AnnotationAiPreviewPanel({ session }: AnnotationAiPreviewPanelProps) {
  const [detachDialogOpen, setDetachDialogOpen] = useState(false);
  const { page, predictions, classes, detach, annotateAll, columns } = session;
  const tableColumns: ColumnDef<AnnotationNodePageRow>[] = [
    { id: columns.text, accessorFn: (row) => row[columns.text] },
    { id: 'ai_prediction', accessorFn: (row) => row[columns.text] },
  ];
  const table = useServerTable({
    data: page.rows,
    columns: tableColumns,
    rowCount: page.rowCount,
    pageIndex: page.pagination.pageIndex,
    pageSize: page.pagination.pageSize,
    onPaginationChange: page.setPagination,
  });

  return (
    <section
      aria-label="AI Annotation Preview"
      className="mt-5 rounded-lg border bg-background/60 p-4"
    >
      <h3 className="mb-3 text-base font-semibold">AI Preview</h3>
      {page.query.isLoading ? (
        <div className="rounded-md border border-border px-4 py-3 text-sm text-muted-foreground">
          Loading texts...
        </div>
      ) : page.query.isError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Could not load texts.
        </div>
      ) : page.rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          No rows to annotate.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="max-h-96 overflow-y-auto overflow-x-hidden">
            <Table className="w-full table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-1/2">{columns.text}</TableHead>
                  <TableHead className="w-1/2">
                    <span className="flex items-center gap-2">
                      AI prediction
                      {predictions.query.isFetching ? (
                        <span className="text-xs font-normal text-muted-foreground">
                          Annotating...
                        </span>
                      ) : null}
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((row, index) => {
                  const rowPosition = page.pagination.pageIndex * page.pagination.pageSize + index;
                  const value = predictions.getSelection(rowPosition, predictions.labels[index]);
                  const existing = cellText(row[columns.annotation]).trim();
                  return (
                    <TableRow key={rowPosition} className="align-top hover:bg-transparent">
                      <TableCell className="break-words whitespace-pre-wrap">
                        {cellText(row[columns.text])}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {existing ? (
                            <span
                              className="shrink-0 text-sm text-muted-foreground line-through"
                              title="Existing annotation"
                            >
                              {existing}
                            </span>
                          ) : null}
                          <Select
                            value={value}
                            disabled={!predictions.canEdit || classes.options.length === 0}
                            onValueChange={(next) => {
                              predictions.setSelection(
                                rowPosition,
                                next === NO_CLASS_VALUE ? '' : next,
                              );
                            }}
                          >
                            <SelectTrigger
                              aria-label={`AI class for row ${String(rowPosition + 1)}`}
                              className="w-full text-sm"
                            >
                              <SelectValue placeholder="—" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_CLASS_VALUE} className="text-muted-foreground">
                                None
                              </SelectItem>
                              {classes.options.map((name) => (
                                <SelectItem key={name} value={name}>
                                  {name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {predictions.query.isError ? (
            <div className="flex items-center justify-between gap-3 border-t border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
              <span>
                {predictions.query.error instanceof Error
                  ? predictions.query.error.message
                  : 'AI annotation failed.'}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void predictions.query.refetch();
                }}
              >
                Retry
              </Button>
            </div>
          ) : null}
          <ServerPaginationFooter
            table={table}
            pageIndex={page.pagination.pageIndex}
            pageSize={page.pagination.pageSize}
            rowCount={page.rowCount}
            loading={page.query.isFetching || session.isMaterializing}
          />
          <div className="flex items-center justify-end gap-3 border-t border-border px-4 py-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={detach.isPending || !detach.canRun}
              onClick={() => {
                setDetachDialogOpen(true);
              }}
            >
              {detach.isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                  Detaching…
                </>
              ) : (
                'Detach Previewed Rows'
              )}
            </Button>
            <ConfirmDialog
              open={detachDialogOpen}
              onOpenChange={setDetachDialogOpen}
              title="Detach previewed rows"
              description={`Copy the ${String(detach.count)} previewed row${
                detach.count === 1 ? '' : 's'
              } into a new child table with their AI labels? The source table is left unchanged.`}
              confirmText="Detach"
              onConfirm={detach.run}
            />
            {annotateAll.isPending ? (
              <span className="text-xs text-muted-foreground">Annotating every row…</span>
            ) : null}
            <Button
              type="button"
              size="sm"
              disabled={annotateAll.isPending || !annotateAll.canRun}
              onClick={annotateAll.run}
            >
              {annotateAll.isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                  Annotating…
                </>
              ) : (
                'Annotate All'
              )}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
