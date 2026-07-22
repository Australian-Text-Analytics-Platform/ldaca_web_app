import { useState } from 'react';
import { toast } from 'sonner';
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
import type { ColumnDef } from '@tanstack/react-table';
import { useAnnotationClassDescriptions } from '../hooks/useAnnotationClassDescriptions';
import { useAnnotationNodePage, type AnnotationNodePageRow } from '../hooks/useAnnotationNodePage';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';

const ANNOTATION_RESULT_PAGE_SIZE = 50;
// Radix `Select` rejects an empty-string item value, so the "clear" option uses
// a sentinel that onValueChange maps back to '' (an unset/null annotation).
const NO_CLASS_VALUE = '__no_class__';
type AnnotationResultRow = AnnotationNodePageRow;

/** Coerce an unknown cell value to display text without object stringification. */
const cellText = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

interface AnnotationResultsPanelProps {
  workspaceId: string | null;
  nodeId: string;
  textColumn: string;
  annotationColumn: string;
  /** Class-description node supplying the dropdown options; null disables them. */
  classNodeId: string | null;
  classColumn: string | null;
  descriptionColumn: string | null;
}

/**
 * Read-only text + editable-annotation result table shown below the Annotation
 * parameter panel once Start/Resume is pressed, mirroring how other analysis
 * tabs surface a result table under their controls.
 *
 * Used by: AnnotationFeature after a run is triggered because reviewers want to
 * see the source text paired with the existing/new annotation column and assign
 * a class per row.
 *
 * Flow: fetch the current source-node page plus the class list, then render two
 * fixed-width columns with server pagination for the complete source node. The
 * text column is plain; each annotation cell is a dropdown of class names plus a
 * leading "None" option that clears the cell back to an unset value. Resume
 * seeds each dropdown from the existing value; a new annotation starts blank.
 * Picking a class optimistically updates the dropdown and persists the cell as
 * a canonical set_cell Data Block edit, reverting + toasting
 * on failure so the displayed value never drifts from what was actually saved.
 */
export function AnnotationResultsPanel({
  workspaceId,
  nodeId,
  textColumn,
  annotationColumn,
  classNodeId,
  classColumn,
  descriptionColumn,
}: AnnotationResultsPanelProps) {
  const { setCell } = useWorkspaceActions();
  // Per-row class overrides keyed by source row position; falls back to the source value.
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [savingRows, setSavingRows] = useState<Set<number>>(new Set());
  const nodePage = useAnnotationNodePage({
    workspaceId,
    nodeId,
    pageSize: ANNOTATION_RESULT_PAGE_SIZE,
  });
  const { pagination, setPagination, query: resultsQuery, rows, rowCount } = nodePage;
  const classDescriptions = useAnnotationClassDescriptions({
    workspaceId,
    nodeId: classNodeId,
    classColumn,
    descriptionColumn,
  });

  const tableColumns: ColumnDef<AnnotationResultRow>[] = [
    { id: textColumn, accessorFn: (row) => row[textColumn] },
    { id: annotationColumn, accessorFn: (row) => row[annotationColumn] },
  ];
  const table = useServerTable({
    data: rows,
    columns: tableColumns,
    rowCount,
    pageIndex: pagination.pageIndex,
    pageSize: pagination.pageSize,
    onPaginationChange: setPagination,
  });
  const classOptions = classDescriptions.rows
    .map((row) => cellText(row.class).trim())
    .filter((name, index, all) => name.length > 0 && all.indexOf(name) === index);

  return (
    <section
      aria-label="Annotation Results"
      className="mt-5 rounded-lg border bg-background/60 p-4"
    >
      <h3 className="mb-3 text-base font-semibold">Annotations</h3>
      {resultsQuery.isLoading ? (
        <div className="rounded-md border border-border px-4 py-3 text-sm text-muted-foreground">
          Loading annotations...
        </div>
      ) : resultsQuery.isError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Could not load annotations.
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          No rows to annotate.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="max-h-96 overflow-y-auto overflow-x-hidden">
            <Table className="w-full table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-1/2">{textColumn}</TableHead>
                  <TableHead className="w-1/2">{annotationColumn}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => {
                  const rowPosition = pagination.pageIndex * pagination.pageSize + index;
                  const seeded = cellText(row[annotationColumn]);
                  const value = selections[rowPosition] ?? seeded;
                  return (
                    <TableRow key={rowPosition} className="align-top hover:bg-transparent">
                      <TableCell className="break-words whitespace-pre-wrap">
                        {cellText(row[textColumn])}
                      </TableCell>
                      <TableCell>
                        <Select
                          // `value` is always a string ('' when unset); passing it
                          // directly keeps the Select controlled for its lifetime.
                          // Radix shows the placeholder for '' as well as undefined.
                          value={value}
                          onValueChange={(next) => {
                            // The sentinel clears the cell back to an unset value.
                            const resolved = next === NO_CLASS_VALUE ? '' : next;
                            setSelections((current) => ({
                              ...current,
                              [rowPosition]: resolved,
                            }));
                            setSavingRows((current) => new Set(current).add(rowPosition));
                            void setCell(nodeId, annotationColumn, rowPosition, resolved || null)
                              .catch((error: unknown) => {
                                setSelections((current) => {
                                  const nextSelections = { ...current };
                                  if (seeded) nextSelections[rowPosition] = seeded;
                                  else Reflect.deleteProperty(nextSelections, rowPosition);
                                  return nextSelections;
                                });
                                toast.error(
                                  error instanceof Error
                                    ? error.message
                                    : 'Could not save the annotation.',
                                );
                              })
                              .finally(() => {
                                setSavingRows((current) => {
                                  const nextSaving = new Set(current);
                                  nextSaving.delete(rowPosition);
                                  return nextSaving;
                                });
                              });
                          }}
                          disabled={savingRows.has(rowPosition)}
                        >
                          <SelectTrigger
                            aria-label={`Class for row ${String(rowPosition + 1)}`}
                            className="w-full text-sm"
                          >
                            <SelectValue placeholder="Select class" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_CLASS_VALUE} className="text-muted-foreground">
                              None
                            </SelectItem>
                            {classOptions.map((name) => (
                              <SelectItem key={name} value={name}>
                                {name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <ServerPaginationFooter
            table={table}
            pageIndex={pagination.pageIndex}
            pageSize={pagination.pageSize}
            rowCount={rowCount}
            loading={resultsQuery.isFetching}
          />
        </div>
      )}
    </section>
  );
}
