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
import {
  ColumnComparisonHeader,
  ColumnComparisonSelector,
  type ConfusionCount,
} from '@/features/views/common/components/ColumnComparison';
import type { IntercoderReliabilityMetric } from '@/features/views/common/columnComparisonModel';
import { MetadataColumnSelector } from '@/features/views/common/components/MetadataColumnSelector';
import { PaginatedTableProcessingRow } from '@/features/views/common/components/PaginatedTableProcessingRow';
import { ServerPaginationFooter } from '@/features/views/common/components/ServerPaginationFooter';
import { type ServerColumnDef, useServerTable } from '@/features/views/common/hooks/useServerTable';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { toBgColor } from '@/features/views/common/vizPalette';
import {
  annotationValuesDiffer,
  isInvalidAnnotationLabel,
  normalizeAnnotationLabel,
} from '../annotationRowFilter';
import type { AnnotationAiPreview, AnnotationPreviewRow } from '../hooks/useAnnotationAiPreview';
import { AnnotationCorrectionColumnControl } from './AnnotationCorrectionColumnControl';
import { AnnotationTableFrame } from './AnnotationTableFrame';
import { InvalidAnnotationClassItem } from './InvalidAnnotationClassItem';

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
  sourceColor: string;
  comparison: {
    columns: string[];
    onColumnsChange: (columns: string[]) => void;
    metric: IntercoderReliabilityMetric;
    onMetricChange: (metric: IntercoderReliabilityMetric) => void;
  };
  metadata: {
    columns: string[];
    onColumnsChange: (columns: string[]) => void;
  };
  /** Shared per-tab result-table height; null keeps the default. */
  tableHeight: number | null;
  onTableHeightChange: (height: number | null) => void;
  correction: {
    nodeId: string;
    column: string | null;
    classOptions: string[];
    onColumnChange: (column: string | null) => void;
    onCreate: () => void;
    onUseAsExample: () => void;
    disabled?: boolean;
  };
}

/**
 * Renders the current Annotation AI preview page without owning its request
 * lifecycle.
 *
 * Rendered by: `AnnotationFeature` while preview is open.
 * `useAnnotationAiPreview` supplies page data, fresh labels, and query state;
 * this component never writes preview labels into the selected annotation
 * column. Comparisons start masked: their page-local reliability is always
 * shown, but per-row values and difference tint appear only after reveal.
 * Empty, blank, and non-Codebook cells never count as differences. A
 * reviewer's explicit correction is a separate set_cell edit in the
 * configured correction column.
 */
export function AnnotationAiPreviewPanel({
  preview,
  sourceColor,
  comparison,
  metadata,
  tableHeight,
  onTableHeightChange,
  correction,
}: AnnotationAiPreviewPanelProps) {
  const { page, predictions, columns } = preview;
  const classOptions = correction.classOptions;
  const { setCell } = useWorkspaceActions();
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [savingRows, setSavingRows] = useState<Set<string>>(new Set());
  const [revealedComparisonColumns, setRevealedComparisonColumns] = useState<Set<string>>(
    new Set(),
  );
  const secondaryColumnOptions = preview.sourceColumns.filter(
    (column) => column !== columns.text && column !== columns.annotation,
  );
  const correctionColumn = correction.column;
  const comparisonColumnOptions = preview.sourceComparableColumns.filter(
    (column) =>
      column !== columns.text && column !== columns.annotation && column !== correctionColumn,
  );
  const activeComparisonColumns = comparison.columns.filter((column) =>
    comparisonColumnOptions.includes(column),
  );
  const showCorrectionColumn = Boolean(correctionColumn);
  const availableCorrectionColumns =
    preview.sourceStringColumns?.filter(
      (column) => column !== columns.text && column !== columns.annotation,
    ) ?? null;
  const availableMetadataColumns = secondaryColumnOptions.filter(
    (column) => column !== correctionColumn,
  );
  const activeMetadataColumns = metadata.columns.filter((column) =>
    availableMetadataColumns.includes(column),
  );
  const revealedActiveComparisonColumns = activeComparisonColumns.filter((column) =>
    revealedComparisonColumns.has(column),
  );
  const supplementalColumns = [...activeComparisonColumns, ...activeMetadataColumns];
  const previewColumn = `${columns.annotation} (preview)`;
  const comparisonRows = new Map<string, ConfusionCount[]>();
  activeComparisonColumns.forEach((targetColumn) => {
    const counts = new Map<string, ConfusionCount>();
    page.rows.forEach((row, index) => {
      const reference = normalizeAnnotationLabel(predictions.labels[index], classOptions);
      const rowPosition = page.pagination.pageIndex * page.pagination.pageSize + index;
      const selectionKey = `${targetColumn}:${String(rowPosition)}`;
      const targetValue = Object.hasOwn(selections, selectionKey)
        ? selections[selectionKey]
        : row[targetColumn];
      const comparison = normalizeAnnotationLabel(targetValue, classOptions);
      if (reference === null || comparison === null) return;
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
  const tableColumns: ServerColumnDef<AnnotationPreviewRow>[] = [
    { id: columns.text, accessorFn: (row) => row[columns.text] },
    { id: 'annotation_preview', accessorFn: (row) => row[columns.annotation] },
    ...(showCorrectionColumn && correctionColumn
      ? [
          { id: 'correction_arrow', accessorFn: () => null },
          {
            id: correctionColumn,
            accessorFn: (row: AnnotationPreviewRow) => row[correctionColumn],
          },
        ]
      : []),
    ...supplementalColumns.map((column) => ({
      id: column,
      accessorFn: (row: AnnotationPreviewRow) => row[column],
    })),
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

  const comparisonLoading = predictions.query.isFetching || preview.comparison.query.isFetching;
  const comparisonError = predictions.query.isError || preview.comparison.query.isError;

  return (
    <section aria-label="AI Annotation Preview" className="mt-5 rounded-lg border bg-editor/60 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 data-guidance="annotation-ai-preview-results" className="text-body font-semibold">
          AI Preview
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <ColumnComparisonSelector
            availableColumns={comparisonColumnOptions}
            selectedColumns={activeComparisonColumns}
            onSelectedColumnsChange={(selected) => {
              const next = selected.filter((column) => column !== correctionColumn);
              setRevealedComparisonColumns(
                (current) => new Set([...current].filter((column) => next.includes(column))),
              );
              comparison.onColumnsChange(next);
            }}
            metric={comparison.metric}
            onMetricChange={comparison.onMetricChange}
            disabled={predictions.query.isFetching || preview.comparison.query.isFetching}
            disabledColumns={activeMetadataColumns}
          />
          <AnnotationCorrectionColumnControl
            value={correctionColumn}
            availableColumns={availableCorrectionColumns}
            onValueChange={(column) => {
              if (column) {
                comparison.onColumnsChange(
                  activeComparisonColumns.filter((selected) => selected !== column),
                );
                metadata.onColumnsChange(
                  activeMetadataColumns.filter((selected) => selected !== column),
                );
                setRevealedComparisonColumns((current) => {
                  const next = new Set(current);
                  next.delete(column);
                  return next;
                });
              }
              correction.onColumnChange(column);
            }}
            onCreate={correction.onCreate}
            onUseAsExample={correction.onUseAsExample}
            disabled={correction.disabled}
          />
          <MetadataColumnSelector
            availableColumns={availableMetadataColumns}
            selectedColumns={activeMetadataColumns}
            onSelectedColumnsChange={metadata.onColumnsChange}
            disabledColumns={activeComparisonColumns}
          />
        </div>
      </div>
      <AnnotationTableFrame
        height={tableHeight}
        onHeightChange={onTableHeightChange}
        contentClassName="min-w-full"
        belowTable={
          <>
            {predictions.query.isError ? (
              <div className="flex items-center justify-between gap-3 border-t border-error/30 bg-error/5 px-4 py-2 text-body text-error">
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
          <TableHeader className="sticky top-0 z-10 bg-surface">
            <TableRow className="[&>th]:align-bottom">
              <TableHead>{columns.text}</TableHead>
              <TableHead className="w-px whitespace-nowrap">
                {columns.annotation} (preview)
              </TableHead>
              {showCorrectionColumn ? (
                <>
                  <TableHead className="w-8 px-1 text-center" aria-label="changes to">
                    <ArrowRight aria-hidden="true" className="mx-auto size-4" />
                  </TableHead>
                  <TableHead className="w-px whitespace-nowrap">
                    <>Correction: {correction.column}</>
                  </TableHead>
                </>
              ) : null}
              {supplementalColumns.map((column) => (
                <TableHead key={column} className="w-px whitespace-nowrap">
                  {activeComparisonColumns.includes(column) ? (
                    <ColumnComparisonHeader
                      metric={comparison.metric}
                      referenceColumn={previewColumn}
                      comparisonColumn={column}
                      rows={comparisonRows.get(column)}
                      isLoading={comparisonLoading}
                      isError={comparisonError}
                      revealed={revealedComparisonColumns.has(column)}
                      onRevealedChange={(revealed) => {
                        setRevealedComparisonColumns((current) => {
                          const next = new Set(current);
                          if (revealed) next.add(column);
                          else next.delete(column);
                          return next;
                        });
                      }}
                    />
                  ) : (
                    column
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.query.isLoading ? (
              <PaginatedTableProcessingRow columnCount={tableColumns.length} />
            ) : page.query.isError ? (
              <TableRow>
                <TableCell className="h-24 text-center text-error" colSpan={tableColumns.length}>
                  Could not load annotations.
                </TableCell>
              </TableRow>
            ) : page.rows.length === 0 ? (
              <TableRow>
                <TableCell
                  className="h-24 text-center text-description"
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
                const comparisonValue = (column: string): unknown => {
                  if (column !== correction.column) return row[column];
                  return correctionValue || null;
                };
                const predictionDiffers = revealedActiveComparisonColumns.some((column) =>
                  annotationValuesDiffer(value, comparisonValue(column), classOptions),
                );
                const differenceColor = toBgColor(sourceColor);
                return (
                  <TableRow key={rowPosition} className="align-top hover:bg-transparent">
                    <TableCell className="break-words whitespace-pre-wrap">
                      {cellText(row[columns.text])}
                    </TableCell>
                    <TableCell
                      className="w-px whitespace-nowrap"
                      style={predictionDiffers ? { backgroundColor: differenceColor } : undefined}
                    >
                      {predictions.query.isFetching ? (
                        <span role="status" aria-label="Predicting annotation">
                          <Loader2
                            aria-hidden="true"
                            className="size-4 animate-spin text-description"
                          />
                        </span>
                      ) : (
                        <div className="flex items-center gap-2">
                          {existing ? (
                            <>
                              <span className="shrink-0 text-body text-description">
                                {existing}
                              </span>
                              <ArrowRight
                                role="img"
                                aria-label="changes to"
                                className="size-4 shrink-0 text-description"
                              />
                            </>
                          ) : null}
                          <span className="text-body">{value || '—'}</span>
                        </div>
                      )}
                    </TableCell>
                    {showCorrectionColumn ? (
                      <>
                        <TableCell className="w-8 px-1 text-center">
                          <ArrowRight
                            role="img"
                            aria-label="corrected to"
                            className="mx-auto size-4 text-description"
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
                              className="h-8 min-w-28 text-body"
                            >
                              <SelectValue placeholder="None" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_CORRECTION_VALUE} className="text-description">
                                None
                              </SelectItem>
                              <InvalidAnnotationClassItem
                                value={correctionValue || null}
                                classOptions={classOptions}
                              />
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
                    {supplementalColumns.map((column) => {
                      const isComparison = activeComparisonColumns.includes(column);
                      const comparisonRevealed =
                        isComparison && revealedComparisonColumns.has(column);
                      const comparisonDiffers =
                        comparisonRevealed &&
                        annotationValuesDiffer(value, row[column], classOptions);
                      const invalid =
                        comparisonRevealed && isInvalidAnnotationLabel(row[column], classOptions);
                      return (
                        <TableCell
                          key={column}
                          className={isComparison ? 'w-px whitespace-nowrap' : 'w-px'}
                          style={
                            comparisonDiffers ? { backgroundColor: differenceColor } : undefined
                          }
                        >
                          {isComparison && !comparisonRevealed ? (
                            <span aria-label="Comparison value hidden">•••</span>
                          ) : isComparison ? (
                            <span
                              className={invalid ? 'italic text-description' : undefined}
                              title={invalid ? 'Not a Codebook class; treated as empty' : undefined}
                            >
                              {cellText(row[column]) || '—'}
                            </span>
                          ) : (
                            <div className="w-max max-w-64 break-words whitespace-pre-wrap">
                              {cellText(row[column]) || '—'}
                            </div>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </AnnotationTableFrame>
    </section>
  );
}
