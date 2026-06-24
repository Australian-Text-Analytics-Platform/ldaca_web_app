import type { Table as TanStackTable } from '@tanstack/react-table';
import { Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { MetadataColumnSelector } from '../../common/components/MetadataColumnSelector';
import { ServerPaginationFooter } from '../../common/components/ServerPaginationFooter';
import { stringifyAiAnnotationCell } from '../hooks/aiAnnotationReviewModel';

const AI_ANNOTATION_PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100];

interface AiAnnotationResultPanelProps {
  resultNodeId: string;
  rows: Record<string, unknown>[];
  visibleColumns: string[];
  availableMetadataColumns: string[];
  selectedMetadataColumns: string[];
  onSelectedMetadataColumnsChange: (columns: string[]) => void;
  table: TanStackTable<Record<string, unknown>>;
  pageIndex: number;
  pageSize: number;
  rowCount: number;
  loading: boolean;
  isDetaching: boolean;
  detachDisabled: boolean;
  onDetach: () => void;
}

/**
 * Renders the completed AI annotation result table and detach action.
 * Rendered by: AiAnnotatorFeature after useAiAnnotationResultControls has
 * normalized the backend response into visible rows, columns, and pagination.
 * Flow: expose metadata-column toggles, render the annotation rows in a sticky
 * header table, and delegate page changes through the shared server pagination
 * footer.
 */
export function AiAnnotationResultPanel({
  resultNodeId,
  rows,
  visibleColumns,
  availableMetadataColumns,
  selectedMetadataColumns,
  onSelectedMetadataColumnsChange,
  table,
  pageIndex,
  pageSize,
  rowCount,
  loading,
  isDetaching,
  detachDisabled,
  onDetach,
}: AiAnnotationResultPanelProps) {
  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Annotation Results</CardTitle>
            <CardDescription>
              Node: <span className="font-mono text-xs">{resultNodeId}</span>
            </CardDescription>
          </div>
          <Button type="button" size="sm" onClick={onDetach} disabled={detachDisabled}>
            {isDetaching ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding to Workspace...
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Add to Workspace
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <MetadataColumnSelector
            availableColumns={availableMetadataColumns}
            selectedColumns={selectedMetadataColumns}
            onSelectedColumnsChange={onSelectedMetadataColumnsChange}
          />
        </div>

        <div className="rounded-lg border border-border bg-card">
          <ScrollArea scrollbars="both" className="max-h-[70vh]">
            <div className="min-w-max">
              <Table className="min-w-180" disableContainer>
                <TableHeader className="bg-muted sticky top-0 z-10">
                  <TableRow>
                    {visibleColumns.map((columnName) => (
                      <TableHead key={columnName} className="whitespace-nowrap">
                        {columnName}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length > 0 ? (
                    rows.map((row, rowIndex) => (
                      <TableRow key={String(rowIndex)}>
                        {visibleColumns.map((columnName) => (
                          <TableCell key={columnName} className="align-top">
                            {stringifyAiAnnotationCell(row[columnName])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={Math.max(visibleColumns.length, 1)}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No annotation rows returned for this page.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </ScrollArea>
        </div>

        <ServerPaginationFooter
          table={table}
          pageIndex={pageIndex}
          pageSize={pageSize}
          rowCount={rowCount}
          pageSizeOptions={AI_ANNOTATION_PAGE_SIZE_OPTIONS}
          loading={loading}
        />
      </CardContent>
    </Card>
  );
}
