import type { ColumnDef } from '@tanstack/react-table';
import { ArrowRight, Loader2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
import { AnalysisTableFrame } from '@/features/views/common/components/AnalysisTableScrollArea';
import {
  ColumnComparisonDialog,
  ConfusionMatrix,
  type ConfusionCount,
} from '@/features/views/common/components/ColumnComparison';
import { PaginatedTableProcessingRow } from '@/features/views/common/components/PaginatedTableProcessingRow';
import { ServerPaginationFooter } from '@/features/views/common/components/ServerPaginationFooter';
import { useServerTable } from '@/features/views/common/hooks/useServerTable';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import type { AnnotationAiPreview, AnnotationPreviewRow } from '../hooks/useAnnotationAiPreview';

const NO_CORRECTION_VALUE = '__no_correction__';

/** Coerce an unknown cell value to display text without object stringification. */
const cellText = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

interface AnnotationAiPreviewPanelProps {
  preview: AnnotationAiPreview;
  comparison: {
    columns: string[];
    onColumnsChange: (columns: string[]) => void;
  };
  correction: {
    nodeId: string;
    column: string | null;
    classOptions: string[];
  };
}

/**
 * Renders the current Annotation AI preview page without owning its request
 * lifecycle.
 *
 * Rendered by: `AnnotationFeature` while preview is open.
 * `useAnnotationAiPreview` supplies page data, fresh labels, and query state;
 * this component never writes preview labels into the selected annotation
 * column. A reviewer's explicit correction is a separate set_cell edit in the
 * configured correction column.
 */
export function AnnotationAiPreviewPanel({
  preview,
  comparison,
  correction,
}: AnnotationAiPreviewPanelProps) {
  const { page, predictions, columns } = preview;
  const { setCell } = useWorkspaceActions();
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [savingRows, setSavingRows] = useState<Set<string>>(new Set());
  const [compareDialogOpen, setCompareDialogOpen] = useState(false);
  const [draftComparisonColumns, setDraftComparisonColumns] = useState<string[]>([]);
  const secondaryColumnOptions = preview.sourceColumns.filter(
    (column) => column !== columns.text && column !== columns.annotation,
  );
  const activeComparisonColumns = comparison.columns.filter((column) =>
    secondaryColumnOptions.includes(column),
  );
  const correctionColumn = correction.column;
  const previewColumn = `${columns.annotation} (preview)`;
  const comparisonRows = new Map<string, ConfusionCount[]>();
  activeComparisonColumns.forEach((targetColumn) => {
    const counts = new Map<string, ConfusionCount>();
    page.rows.forEach((row, index) => {
      const reference = predictions.labels[index];
      const rowPosition = page.pagination.pageIndex * page.pagination.pageSize + index;
      const selectionKey = `${targetColumn}:${String(rowPosition)}`;
      const targetValue = Object.hasOwn(selections, selectionKey)
        ? selections[selectionKey]
        : row[targetColumn];
      if (reference == null || targetValue == null) return;
      const comparison = cellText(targetValue);
      const key = JSON.stringify([reference, comparison]);
      const existing = counts.get(key);
      counts.set(key, {
        reference,
        comparison,
        count: (existing?.count ?? 0) + 1,
      });
    });
    comparisonRows.set(targetColumn, Array.from(counts.values()));
  });
  const tableColumns: ColumnDef<AnnotationPreviewRow>[] = [
    { id: columns.text, accessorFn: (row) => row[columns.text] },
    { id: 'annotation_preview', accessorFn: (row) => row[columns.annotation] },
    ...(correctionColumn
      ? [
          { id: 'correction_arrow', accessorFn: () => null },
          {
            id: correctionColumn,
            accessorFn: (row: AnnotationPreviewRow) => row[correctionColumn],
          },
        ]
      : []),
  ];
  const table = useServerTable({
    data: page.rows,
    columns: tableColumns,
    rowCount: page.rowCount,
    pageIndex: page.pagination.pageIndex,
    pageSize: page.pagination.pageSize,
    onPaginationChange: page.setPagination,
  });

  const saveCorrection = ({
    rowPosition,
    previous,
    next,
  }: {
    rowPosition: number;
    previous: string;
    next: string;
  }) => {
    if (!correction.column) return;
    const resolved = next === NO_CORRECTION_VALUE ? '' : next;
    const selectionKey = `${correction.column}:${String(rowPosition)}`;
    setSelections((current) => ({ ...current, [selectionKey]: resolved }));
    setSavingRows((current) => new Set(current).add(selectionKey));
    void setCell(correction.nodeId, correction.column, rowPosition, resolved || null)
      .catch((error: unknown) => {
        setSelections((current) => {
          const nextSelections = { ...current };
          if (previous) nextSelections[selectionKey] = previous;
          else Reflect.deleteProperty(nextSelections, selectionKey);
          return nextSelections;
        });
        toast.error(
          error instanceof Error ? error.message : 'Could not save the annotation correction.',
        );
      })
      .finally(() => {
        setSavingRows((current) => {
          const nextSaving = new Set(current);
          nextSaving.delete(selectionKey);
          return nextSaving;
        });
      });
  };

  return (
    <>
      <section
        aria-label="AI Annotation Preview"
        className="mt-5 rounded-lg border bg-background/60 p-4"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold">AI Preview</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              secondaryColumnOptions.length === 0 ||
              predictions.query.isFetching ||
              preview.comparison.query.isFetching
            }
            onClick={() => {
              setDraftComparisonColumns(activeComparisonColumns);
              setCompareDialogOpen(true);
            }}
          >
            Compare To
          </Button>
        </div>
        <AnalysisTableFrame
          maxHeightClass="max-h-96"
          contentClassName="min-w-full"
          belowTable={
            <>
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
                loading={page.query.isFetching}
              >
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={predictions.query.isFetching}
                  onClick={() => {
                    void predictions.query.refetch();
                  }}
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={predictions.query.isFetching ? 'animate-spin' : undefined}
                  />
                  Refresh page
                </Button>
              </ServerPaginationFooter>
            </>
          }
        >
          <Table className="w-full table-auto" disableContainer>
            <TableHeader>
              <TableRow>
                <TableHead>{columns.text}</TableHead>
                <TableHead className="w-px whitespace-nowrap">
                  {columns.annotation} (preview)
                </TableHead>
                {correction.column ? (
                  <>
                    <TableHead className="w-8 px-1 text-center" aria-label="changes to">
                      <ArrowRight aria-hidden="true" className="mx-auto size-4" />
                    </TableHead>
                    <TableHead className="w-px whitespace-nowrap">
                      Correction: {correction.column}
                    </TableHead>
                  </>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.query.isLoading ? (
                <PaginatedTableProcessingRow columnCount={tableColumns.length} />
              ) : page.query.isError ? (
                <TableRow>
                  <TableCell
                    className="h-24 text-center text-destructive"
                    colSpan={tableColumns.length}
                  >
                    Could not load annotations.
                  </TableCell>
                </TableRow>
              ) : page.rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    className="h-24 text-center text-muted-foreground"
                    colSpan={tableColumns.length}
                  >
                    No rows to annotate.
                  </TableCell>
                </TableRow>
              ) : (
                page.rows.map((row, index) => {
                  const rowPosition = page.pagination.pageIndex * page.pagination.pageSize + index;
                  const value = predictions.labels[index] ?? '';
                  const existing = cellText(row[columns.annotation]).trim();
                  const seededCorrection = correction.column
                    ? cellText(row[correction.column]).trim()
                    : '';
                  const selectionKey = correction.column
                    ? `${correction.column}:${String(rowPosition)}`
                    : '';
                  const correctionValue = selections[selectionKey] ?? seededCorrection;
                  return (
                    <TableRow key={rowPosition} className="align-top hover:bg-transparent">
                      <TableCell className="break-words whitespace-pre-wrap">
                        {cellText(row[columns.text])}
                      </TableCell>
                      <TableCell className="w-px whitespace-nowrap">
                        {predictions.query.isFetching ? (
                          <span role="status" aria-label="Predicting annotation">
                            <Loader2
                              aria-hidden="true"
                              className="size-4 animate-spin text-muted-foreground"
                            />
                          </span>
                        ) : (
                          <div className="flex items-center gap-2">
                            {existing ? (
                              <>
                                <span className="shrink-0 text-sm text-muted-foreground">
                                  {existing}
                                </span>
                                <ArrowRight
                                  role="img"
                                  aria-label="changes to"
                                  className="size-4 shrink-0 text-muted-foreground"
                                />
                              </>
                            ) : null}
                            <span className="text-sm">{value || '—'}</span>
                          </div>
                        )}
                      </TableCell>
                      {correction.column ? (
                        <>
                          <TableCell className="w-8 px-1 text-center">
                            <ArrowRight
                              role="img"
                              aria-label="corrected to"
                              className="mx-auto size-4 text-muted-foreground"
                            />
                          </TableCell>
                          <TableCell className="w-px">
                            <Select
                              value={correctionValue || NO_CORRECTION_VALUE}
                              disabled={savingRows.has(selectionKey)}
                              onValueChange={(next) => {
                                saveCorrection({ rowPosition, previous: correctionValue, next });
                              }}
                            >
                              <SelectTrigger
                                aria-label={`Correct prediction for row ${String(rowPosition + 1)}`}
                                className="h-8 min-w-28 text-sm"
                              >
                                <SelectValue placeholder="None" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem
                                  value={NO_CORRECTION_VALUE}
                                  className="text-muted-foreground"
                                >
                                  None
                                </SelectItem>
                                {correction.classOptions.map((name) => (
                                  <SelectItem key={name} value={name}>
                                    {name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </>
                      ) : null}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </AnalysisTableFrame>
        {activeComparisonColumns.length > 0 ? (
          <div className="mt-4 space-y-4" aria-label="Preview annotation comparisons">
            {activeComparisonColumns.map((targetColumn) => (
              <ConfusionMatrix
                key={targetColumn}
                referenceColumn={previewColumn}
                comparisonColumn={targetColumn}
                rows={comparisonRows.get(targetColumn)}
                isLoading={predictions.query.isFetching || preview.comparison.query.isFetching}
                isError={predictions.query.isError || preview.comparison.query.isError}
              />
            ))}
          </div>
        ) : null}
      </section>
      <ColumnComparisonDialog
        open={compareDialogOpen}
        referenceColumn={previewColumn}
        availableColumns={secondaryColumnOptions}
        selectedColumns={draftComparisonColumns}
        scopeDescription="on the current Preview page"
        onOpenChange={setCompareDialogOpen}
        onSelectedColumnsChange={setDraftComparisonColumns}
        onCompare={() => {
          comparison.onColumnsChange(draftComparisonColumns);
          setCompareDialogOpen(false);
        }}
      />
    </>
  );
}
