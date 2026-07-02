import { useState } from 'react';
import { toast } from 'sonner';
import { getAnnotationClassDescriptions, getNodeData, setAnnotationCell } from '@/api';
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
import { queryKeys } from '@/lib/queryKeys';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';

const ANNOTATION_RESULT_PAGE_SIZE = 50;
// Radix `Select` rejects an empty-string item value, so the "clear" option uses
// a sentinel that onValueChange maps back to '' (an unset/null annotation).
const NO_CLASS_VALUE = '__no_class__';
type AnnotationResultRow = Record<string, unknown>;

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
  /** New annotation columns have no data yet, so their cells start unselected. */
  isNew: boolean;
  /** Class-description node supplying the dropdown options; null disables them. */
  classNodeId: string | null;
  classColumn: string | null;
  descriptionColumn: string | null;
  getAuthHeaders: () => Record<string, string>;
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
 * Picking a class optimistically updates the dropdown and persists the cell to
 * the backend annotation column via PUT .../annotation-cell, reverting + toasting
 * on failure so the displayed value never drifts from what was actually saved.
 */
export function AnnotationResultsPanel({
  workspaceId,
  nodeId,
  textColumn,
  annotationColumn,
  isNew,
  classNodeId,
  classColumn,
  descriptionColumn,
  getAuthHeaders,
}: AnnotationResultsPanelProps) {
  // Per-row class overrides keyed by source row position; falls back to the source value.
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: ANNOTATION_RESULT_PAGE_SIZE,
  });
  const queryClient = useQueryClient();

  // Persist a single annotation cell to the backend column. row_index is the
  // ABSOLUTE 0-based position across the node (page offset + row), matching the
  // backend's int_range rewrite. On failure the dropdown rolls back to the value
  // it showed before the change so optimistic UI never diverges from storage.
  const setCellMutation = useMutation({
    mutationFn: async (vars: { rowPosition: number; value: string; previous: string }) => {
      const { data } = await setAnnotationCell({
        headers: getAuthHeaders(),
        path: { node_id: nodeId },
        body: {
          column_name: annotationColumn,
          row_index: vars.rowPosition,
          value: vars.value === '' ? null : vars.value,
        },
        throwOnError: true,
      });
      return data;
    },
    onError: (_error, vars) => {
      setSelections((current) => ({ ...current, [vars.rowPosition]: vars.previous }));
      toast.error('Could not save annotation.');
    },
    onSuccess: () => {
      // Refetch so other views of this node reflect the saved cell; the local
      // override already matches, so the visible dropdown does not flicker.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.nodeData(workspaceId ?? '', nodeId),
      });
    },
  });

  const resultsQuery = useQuery({
    queryKey: queryKeys.nodeData(
      workspaceId ?? '',
      nodeId,
      pagination.pageIndex + 1,
      pagination.pageSize,
    ),
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data } = await getNodeData({
        headers: getAuthHeaders(),
        path: { node_id: nodeId },
        query: { page: pagination.pageIndex + 1, page_size: pagination.pageSize },
        throwOnError: true,
      });
      return data;
    },
  });

  const canLoadClasses = Boolean(workspaceId && classNodeId && classColumn && descriptionColumn);
  const classesQuery = useQuery({
    queryKey:
      canLoadClasses && workspaceId && classNodeId && classColumn && descriptionColumn
        ? queryKeys.annotationClassDescriptions(
            workspaceId,
            classNodeId,
            classColumn,
            descriptionColumn,
          )
        : ['annotation', 'result-classes', 'disabled'],
    enabled: canLoadClasses,
    queryFn: async () => {
      const { data } = await getAnnotationClassDescriptions({
        headers: getAuthHeaders(),
        path: { node_id: classNodeId ?? '' },
        query: { class_column: classColumn ?? '', description_column: descriptionColumn ?? '' },
        throwOnError: true,
      });
      return data;
    },
  });

  const rows = (resultsQuery.data?.data ?? []) as AnnotationResultRow[];
  const rowCount = resultsQuery.data?.pagination.total_rows ?? rows.length;
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
  const classOptions = (classesQuery.data?.rows ?? [])
    .map((row) => cellText(row.class).trim())
    .filter((name, index, all) => name.length > 0 && all.indexOf(name) === index);

  return (
    <section aria-label="Annotation Results" className="mt-5 rounded-lg border bg-background/60 p-4">
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
                  const seeded = isNew ? '' : cellText(row[annotationColumn]);
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
                            const previous = value;
                            setSelections((current) => ({
                              ...current,
                              [rowPosition]: resolved,
                            }));
                            // New columns are created on Start before this panel
                            // shows, so persistence runs in resume mode against an
                            // existing column; skip the request in the unlikely
                            // new-mode render to avoid a guaranteed 400.
                            if (!isNew) {
                              setCellMutation.mutate({ rowPosition, value: resolved, previous });
                            }
                          }}
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
