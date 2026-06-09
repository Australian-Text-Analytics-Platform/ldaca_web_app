import type { ColumnDef } from '@tanstack/react-table';
import { flexRender } from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { Loader2, Plus } from 'lucide-react';
import type { ConcordanceNodeResult as ConcordanceResultEntry } from '@/api/generated/types.gen';
import { AnalysisTableScrollArea } from '@/features/views/common/components/AnalysisTableScrollArea';
import { ServerPaginationFooter } from '@/features/views/common/components/ServerPaginationFooter';
import { useServerTable } from '@/features/views/common/hooks/useServerTable';
import { GroupedResultsPageSizeSummary } from '../../common/components/GroupedResultsPageSizeSummary';
import { PAGE_SIZE_OPTIONS_DEFAULT } from '../../common/constants';
import { takeMostRecent } from '@/features/workspace/common/utils/selectionUtils';
import { getNodeIdentifier } from '../../common';
import type { NodeColumnSelection } from '../../common';
import type { WorkspaceNodeLike } from '../../common/nodeSelectionTypes';
import type { PaginationState } from '../hooks/useConcordanceTaskFlow';
import { SortableHeader } from './SortableHeader';
import {
  CONCORDANCE_COLUMN_KEYS,
  CONCORDANCE_CORE_COLUMNS,
  CONCORDANCE_FREQ_COLUMNS,
} from '../../common/generatedColumns';
import { batchProcessedCount, flattenConcordanceGroups } from '../concordanceViewModels';

type ConcordanceRow = Record<string, unknown>;
type ConcordanceGroupedRow = ConcordanceRow[];

/** Used by: the concordance tables for per-column alignment because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
 *
 * Classic KWIC ("key word in context") layout:
 *   - left-context: right-aligned so its rightmost character anchors to
 *     the matched-text column;
 *   - matched-text: centered so the keyword forms a vertical stripe the
 *     user can scan top-to-bottom;
 *   - right-context: left-aligned (table default) for the same anchoring
 *     on the other side.
 * Other columns stay left-aligned.
 */
function alignmentClassForColumn(columnKey: string): string {
  if (columnKey === CONCORDANCE_COLUMN_KEYS.leftContext) return 'text-right';
  if (columnKey === CONCORDANCE_COLUMN_KEYS.matchedText) return 'text-center';
  return '';
}

const CORE_COLS = [...CONCORDANCE_CORE_COLUMNS];
const FREQ_COLS = [...CONCORDANCE_FREQ_COLUMNS];
const ALL_CONC_COLS_SET = new Set<string>([...CORE_COLS, ...FREQ_COLS]);
const READ_ONLY_DISABLED_REASON = 'This action is unavailable while results are read-only.';

/** Used by: the concordance tables' display-column assembly to remove repeated concordance/metadata keys because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
const dedupeColumns = (cols: string[]): string[] => {
  const seen = new Set<string>();
  return cols.filter((col) => {
    if (seen.has(col)) {
      return false;
    }
    seen.add(col);
    return true;
  });
};

/**
 * Builds the TanStack column defs for a concordance table. Cells emit the plain
 * string value; the KWIC alignment is applied on the surrounding header/cell
 * wrappers via {@link alignmentClassForColumn}.
 * Used by: CombinedConcordanceTable and PerNodeConcordanceTable because both
 * paths need identical cell rendering driven off the display columns.
 */
function buildConcordanceColumns(displayColumns: string[]): ColumnDef<ConcordanceRow, unknown>[] {
  return displayColumns.map((columnKey) => ({
    id: columnKey,
    accessorFn: (row) => row[columnKey],
    cell: ({ getValue }) => {
      const value = getValue();
      return value !== undefined && value !== null ? String(value) : '';
    },
  }));
}

export type ConcordanceTableNodeBlockProps = {
  nodeKey: string;
  nodeData: ConcordanceResultEntry;
  context: {
    nodeId: string;
    paginationKey: string;
    requestNodeId: string;
    column: string;
    displayName?: string;
    nodeColor?: string;
  };

  // Search + display
  searchWord: string;
  showMetadata: boolean;
  selectedMetadataColumns: string[];

  // Workspace selection
  selectedNodes: WorkspaceNodeLike[];
  panelSelectedNodes: WorkspaceNodeLike[];
  effectiveNodeColumnSelections: NodeColumnSelection[];
  labelToNodeId: Record<string, string> | null;

  // Colors (combined view)
  sourceColorMap: Record<string, string>;
  defaultPalette: string[];

  // Pagination + per-node state
  nodePagination: PaginationState;
  globalPageSize: number;
  /** Changes the single shared page size for all result tables (footer selector). */
  onPageSizeChange: (pageSize: number) => void;
  combinedPage: number;
  combinedLoading: boolean;
  nodeLoading: Record<string, boolean>;
  nodeDetaching: Record<string, boolean>;
  nodeMaterializing: Record<string, boolean>;
  materializedPaths: Record<string, string>;
  materializeSummaries: Record<
    string,
    { recordCount: number; uniqueDocuments: number; totalDocuments: number }
  >;

  // Handlers
  handleSort: (columnKey: string, paginationKey: string, requestNodeId: string) => void;
  handlePageChange: (newPage: number, paginationKey: string, requestNodeId: string) => void;
  handleRowClick: (
    row: Record<string, unknown>,
    nodeId: string,
    column: string,
    groupedHits?: ConcordanceGroupedRow,
  ) => void;
  handleMaterialize: (nodeId: string, column: string) => Promise<void>;
  setCombinedPage: (page: number) => void;
  openDetachDialog: (nodes: { nodeId: string; column: string; nodeLabel: string }[]) => void;
  /** Read-only flag that disables Process All and Add to Workspace buttons while pagination, sort, and row details remain active. */
  readOnly?: boolean;
};

/**
 * Rendered by: ConcordanceResultsPanel for each table-oriented concordance result block.
 * Dispatches to the combined ("both blocks") view or the per-node view, each of
 * which owns its own server-paginated TanStack table instance. The split keeps
 * the `useServerTable` hook unconditional within each component (the two paths
 * have different row models, headers, and footer actions).
 */
export function ConcordanceTableNodeBlock(props: ConcordanceTableNodeBlockProps) {
  if (props.nodeKey === '__COMBINED__') {
    return <CombinedConcordanceTable {...props} />;
  }
  return <PerNodeConcordanceTable {...props} />;
}

/**
 * Rendered by: ConcordanceTableNodeBlock for the merged two-block view.
 *
 * Concordance pagination walks SOURCE documents, not displayed rows: each source
 * document yields zero or more KWIC hits and empty documents are dropped. The
 * TanStack instance is told `rowCount = total_source_rows` and
 * `pageSize = globalPageSize`, so the footer reflects "documents per batch" while
 * the body still renders the variable number of flattened hit rows. Once the
 * node is materialized each row is a single occurrence (`page_size == num_rows`),
 * so the footer label switches to "Occurrences per page".
 * Flow: derive display columns, build the server table, then render the coloured
 * KWIC rows and the shared pagination footer.
 */
function CombinedConcordanceTable({
  nodeData,
  searchWord,
  showMetadata,
  selectedMetadataColumns,
  selectedNodes,
  panelSelectedNodes,
  effectiveNodeColumnSelections,
  sourceColorMap,
  defaultPalette,
  combinedPage,
  globalPageSize,
  onPageSizeChange,
  combinedLoading,
  nodeMaterializing,
  materializedPaths,
  materializeSummaries,
  handleRowClick,
  handleMaterialize,
  setCombinedPage,
  openDetachDialog,
  readOnly = false,
}: ConcordanceTableNodeBlockProps) {
  const groupedRows = nodeData.data;
  const rows = flattenConcordanceGroups(groupedRows);
  const allColumns = nodeData.columns;
  const metaCols = nodeData.metadata.metadata_columns;
  const concCols = (
    nodeData.metadata.concordance_columns?.length
      ? nodeData.metadata.concordance_columns.filter((c: string) => ALL_CONC_COLS_SET.has(c))
      : CORE_COLS
  ) as string[];
  const visibleMetaCols = (selectedMetadataColumns ?? []).filter((columnName) =>
    metaCols.includes(columnName),
  );
  const rawDisplayColumns = showMetadata
    ? [...concCols.filter((c) => allColumns.includes(c)), ...visibleMetaCols]
    : concCols.filter((c) => allColumns.includes(c));
  const displayColumns = dedupeColumns(rawDisplayColumns);

  const columns = buildConcordanceColumns(displayColumns);
  const table = useServerTable<ConcordanceRow>({
    data: rows,
    columns,
    rowCount: nodeData.pagination?.total_source_rows ?? 0,
    pageIndex: combinedPage - 1,
    pageSize: globalPageSize,
    // Bridges TanStack paging to the combined-view page + page-size handlers.
    // Called by: useServerTable option object because consumers need this callback at the object boundary instead of recreating it inline.
    onPaginationChange: (next) => {
      if (next.pageSize !== globalPageSize) {
        if (!readOnly) onPageSizeChange(next.pageSize);
        return;
      }
      const newPage = next.pageIndex + 1;
      if (newPage !== combinedPage) setCombinedPage(newPage);
    },
  });

  const combinedNodeIds = takeMostRecent(selectedNodes, 2)
    .map((n) => n.id)
    .filter((id): id is string => Boolean(id));
  const isAnyCombinedMaterializing = combinedNodeIds.some((id) => Boolean(nodeMaterializing[id]));
  const allCombinedMaterialized =
    combinedNodeIds.length > 0 && combinedNodeIds.every((id) => Boolean(materializedPaths[id]));

  return (
    <div className="mb-6">
      <div className="flex items-center mb-4">
        <h3 className="text-lg font-semibold text-gray-800">Combined Results</h3>
        <div className="ml-auto flex items-center space-x-2">
          <span className="text-xs text-gray-500">Rows colored by source data block</span>
          <DisabledReasonTooltip reason={readOnly ? READ_ONLY_DISABLED_REASON : undefined}>
            <Button
              onClick={() => {
                if (combinedNodeIds.length === 0 || !searchWord.trim()) return;
                for (const nid of combinedNodeIds) {
                  if (materializedPaths[nid]) continue;
                  const col =
                    effectiveNodeColumnSelections.find((s) => s.nodeId === nid)?.column || '';
                  if (!col) continue;
                  void handleMaterialize(nid, col);
                }
              }}
              disabled={
                readOnly ||
                isAnyCombinedMaterializing ||
                allCombinedMaterialized ||
                !searchWord.trim() ||
                combinedNodeIds.length === 0
              }
              size="sm"
              variant="outline"
              className="h-auto max-w-full whitespace-normal wrap-break-word py-1.5 text-left"
              title={
                readOnly
                  ? undefined
                  : 'Cache all occurrence rows for both data blocks so subsequent pagination and Add-to-Workspace reuse them'
              }
            >
              {isAnyCombinedMaterializing ? (
                <>
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                  Processing...
                </>
              ) : allCombinedMaterialized ? (
                <>Processed</>
              ) : (
                <>Process Both</>
              )}
            </Button>
          </DisabledReasonTooltip>
          <DisabledReasonTooltip reason={readOnly ? READ_ONLY_DISABLED_REASON : undefined}>
            <Button
              onClick={() => {
                if (combinedNodeIds.length === 0 || !searchWord.trim()) return;
                const nodes = combinedNodeIds
                  .map((nid) => {
                    const col =
                      effectiveNodeColumnSelections.find((s) => s.nodeId === nid)?.column || '';
                    const sourceNode = panelSelectedNodes.find(
                      (node, idx) => getNodeIdentifier(node, idx) === nid,
                    );
                    const sourceLabel = (sourceNode?.name || sourceNode?.id || nid) as string;
                    return { nodeId: nid, column: col, nodeLabel: sourceLabel };
                  })
                  .filter((n) => n.column);
                openDetachDialog(nodes);
              }}
              disabled={
                readOnly || combinedLoading || !searchWord.trim() || combinedNodeIds.length === 0
              }
              size="sm"
              className="h-auto max-w-full whitespace-normal wrap-break-word py-1.5 text-left"
              title={
                readOnly
                  ? undefined
                  : 'Create new data blocks with concordance results for both sources joined to their original tables'
              }
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Both to Workspace
            </Button>
          </DisabledReasonTooltip>
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card">
        <AnalysisTableScrollArea maxHeightClass="max-h-100">
          <Table className="min-w-180" disableContainer>
            <TableHeader className="bg-gray-50 sticky top-0 z-10">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className={`px-3 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 ${alignmentClassForColumn(header.column.id) || 'text-left'}`}
                    >
                      {header.column.id}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    className="h-24 text-center text-muted-foreground"
                    colSpan={displayColumns.length || 1}
                  >
                    No matching rows on this page for &quot;{searchWord}&quot;. Source rows without
                    matches are omitted.
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((tableRow) => {
                  const row = tableRow.original;
                  const rawSrc = row.__source_node;
                  const normalized = rawSrc ? rawSrc.toString().toLowerCase() : undefined;
                  let color = normalized ? sourceColorMap[normalized] : undefined;
                  if (!color && rawSrc && normalized) {
                    // Fallback: loose match (substring) when exact lookup fails.
                    const entry = Object.entries(sourceColorMap).find(([k]) =>
                      k.includes(normalized),
                    );
                    color = entry ? entry[1] : undefined;
                  }
                  if (!color) {
                    // Final fallback: deterministic by hashing the source string.
                    if (rawSrc) {
                      const chars = Array.from(rawSrc.toString()) as string[];
                      const hash = chars.reduce((a, c) => a + c.charCodeAt(0), 0);
                      color = defaultPalette[hash % defaultPalette.length];
                    } else {
                      color = '#ffffff';
                    }
                  }
                  const bg = `${color}20`;
                  return (
                    <TableRow
                      key={tableRow.id}
                      className="cursor-pointer"
                      style={{ backgroundColor: bg }}
                      onClick={() => {
                        if (rawSrc) {
                          const nodeObj = panelSelectedNodes.find((n: WorkspaceNodeLike) => {
                            const candidates = [
                              n.id,
                              n.name,
                              (n as Record<string, unknown>).data &&
                              typeof (n as Record<string, unknown>).data === 'object'
                                ? ((n as Record<string, unknown>).data as Record<string, unknown>)
                                    ?.name
                                : undefined,
                              n.label,
                              (n as Record<string, unknown>).data &&
                              typeof (n as Record<string, unknown>).data === 'object'
                                ? ((n as Record<string, unknown>).data as Record<string, unknown>)
                                    ?.label
                                : undefined,
                            ]
                              .filter(Boolean)
                              .map((v) => String(v).toLowerCase());
                            return candidates.includes(rawSrc.toString().toLowerCase());
                          });
                          const sel =
                            nodeObj &&
                            effectiveNodeColumnSelections.find((s) => s.nodeId === nodeObj.id);
                          if (nodeObj && sel?.column) {
                            handleRowClick(row, String(nodeObj.id ?? ''), sel.column);
                          }
                        }
                      }}
                    >
                      {tableRow.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className={alignmentClassForColumn(cell.column.id)}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </AnalysisTableScrollArea>
        {(() => {
          const summary = nodeData.materialized ? (
            Object.keys(materializeSummaries).length > 0 ? (
              <GroupedResultsPageSizeSummary
                groups={[]}
                totalInstances={Object.values(materializeSummaries).reduce(
                  (sum, s) => sum + s.recordCount,
                  0,
                )}
                totalDocuments={Object.values(materializeSummaries).reduce(
                  (sum, s) => sum + s.uniqueDocuments,
                  0,
                )}
                totalProcessed={Object.values(materializeSummaries).reduce(
                  (sum, s) => sum + s.totalDocuments,
                  0,
                )}
              />
            ) : null
          ) : (
            <GroupedResultsPageSizeSummary
              groups={nodeData.data}
              totalProcessed={batchProcessedCount(nodeData.pagination)}
            />
          );
          return summary ? (
            <div className="border-t border-border bg-muted/40 px-4 pt-2 text-sm text-muted-foreground">
              {summary}
            </div>
          ) : null;
        })()}
        <ServerPaginationFooter
          table={table}
          pageIndex={combinedPage - 1}
          pageSize={globalPageSize}
          rowCount={nodeData.pagination?.total_source_rows ?? 0}
          pageSizeLabel={nodeData.materialized ? 'Occurrences per page' : 'Documents per batch'}
          pageSizeOptions={[...PAGE_SIZE_OPTIONS_DEFAULT]}
          loading={combinedLoading}
          showPageSize={!readOnly}
        />
      </div>
    </div>
  );
}

/**
 * Rendered by: ConcordanceTableNodeBlock for a single data block's results.
 *
 * Like the combined view, pagination walks SOURCE documents: `rowCount` is the
 * backend's `total_source_rows` so the footer's page math reflects documents per
 * batch even though the body shows a variable number of hit rows. Once the node
 * is materialized each row is a single occurrence (`page_size == num_rows`), so
 * the footer label switches to "Occurrences per page".
 * Flow: derive display columns, build the server table, render sortable KWIC
 * rows, then render the shared footer with the Process / Add-to-Workspace
 * actions.
 */
function PerNodeConcordanceTable({
  nodeKey,
  nodeData,
  context,
  searchWord,
  showMetadata,
  selectedMetadataColumns,
  selectedNodes,
  panelSelectedNodes,
  effectiveNodeColumnSelections,
  labelToNodeId,
  nodePagination,
  globalPageSize,
  onPageSizeChange,
  nodeLoading,
  nodeDetaching,
  nodeMaterializing,
  materializedPaths,
  materializeSummaries,
  handleSort,
  handlePageChange,
  handleRowClick,
  handleMaterialize,
  openDetachDialog,
  readOnly = false,
}: ConcordanceTableNodeBlockProps) {
  const { nodeId: actualNodeId, paginationKey, requestNodeId, column } = context;
  const effectiveNodeId = actualNodeId || requestNodeId;
  const detachNodeId = actualNodeId || (labelToNodeId?.[nodeKey] ?? requestNodeId);
  const canDetach = Boolean(detachNodeId) && detachNodeId !== '__COMBINED__';

  const groupedRows = nodeData.data;
  const rows = flattenConcordanceGroups(groupedRows);
  const allCols = nodeData.columns;
  const metaCols = nodeData.metadata.metadata_columns;
  const concCols = (
    nodeData.metadata.concordance_columns?.length
      ? nodeData.metadata.concordance_columns.filter((c: string) => ALL_CONC_COLS_SET.has(c))
      : CORE_COLS
  ) as string[];
  const visibleMetaCols = (selectedMetadataColumns ?? []).filter((columnName) =>
    metaCols.includes(columnName),
  );
  const rawDisplayColumns = showMetadata
    ? [
        ...concCols.filter((c) => allCols.includes(c)),
        ...visibleMetaCols.filter((c) => allCols.includes(c)),
      ]
    : concCols.filter((c) => allCols.includes(c));
  const displayColumns = dedupeColumns(rawDisplayColumns);
  const tableColumns = displayColumns.length > 0 ? displayColumns : allCols;

  const currentNodePagination = nodePagination[paginationKey];
  const currentPage = currentNodePagination?.currentPage ?? 1;
  const nodeIsLoading = Boolean(nodeLoading[paginationKey]);

  const columns = buildConcordanceColumns(tableColumns);
  const table = useServerTable<ConcordanceRow>({
    data: rows,
    columns,
    rowCount: nodeData.pagination?.total_source_rows ?? 0,
    pageIndex: currentPage - 1,
    pageSize: globalPageSize,
    // Bridges TanStack paging to the per-node page + page-size handlers.
    // Called by: useServerTable option object because consumers need this callback at the object boundary instead of recreating it inline.
    onPaginationChange: (next) => {
      if (next.pageSize !== globalPageSize) {
        if (!readOnly) onPageSizeChange(next.pageSize);
        return;
      }
      const newPage = next.pageIndex + 1;
      if (newPage !== currentPage) handlePageChange(newPage, paginationKey, requestNodeId);
    },
  });

  const detachingKey = detachNodeId ?? '';
  const isDetaching = detachingKey ? Boolean(nodeDetaching[detachingKey]) : false;

  // Two side-by-side data blocks share one synced page size, so processing only
  // one would leave the tables on mismatched units (instances/page vs
  // documents/page). The Process button therefore materialises every selected
  // block together; with a single block it processes just that node.
  // Used by: the per-node footer below.
  const processTogetherNodeIds = takeMostRecent(selectedNodes, 2)
    .map((n) => n.id)
    .filter((id): id is string => Boolean(id));
  const isMultiBlock = processTogetherNodeIds.length > 1;
  const processTargetIds = isMultiBlock
    ? processTogetherNodeIds
    : detachNodeId
      ? [detachNodeId]
      : [];
  const isAnyProcessTargetMaterializing = processTargetIds.some((id) =>
    Boolean(nodeMaterializing[id]),
  );
  const allProcessTargetsMaterialized =
    processTargetIds.length > 0 && processTargetIds.every((id) => Boolean(materializedPaths[id]));

  const showNodeIndicator = panelSelectedNodes.length > 1 && context.nodeColor;

  return (
    <div className="mb-6">
      {showNodeIndicator && (
        <div className="mb-2 flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: context.nodeColor }}
          />
          <h3 className="text-sm font-medium text-foreground">{context.displayName || nodeKey}</h3>
        </div>
      )}
      <div
        className="rounded-lg border border-border bg-card"
        style={
          showNodeIndicator
            ? { borderLeftWidth: '3px', borderLeftColor: context.nodeColor }
            : undefined
        }
      >
        <AnalysisTableScrollArea maxHeightClass="max-h-100">
          <Table className="min-w-180" disableContainer>
            <TableHeader className="bg-gray-50 sticky top-0 z-10">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    // Every displayed column is sortable: the backend's
                    // materialised path honours sort_by for any column in the
                    // parquet schema (including CONC_*). The non-materialised
                    // path silently drops CONC_* sorts (those columns are
                    // computed post-slice), but metadata-column sorts still
                    // apply — and pre-materialise the user typically only sees
                    // metadata values to sort by anyway.
                    <SortableHeader
                      key={header.id}
                      columnKey={header.column.id}
                      label={header.column.id}
                      paginationKey={paginationKey}
                      requestNodeId={requestNodeId}
                      nodePagination={nodePagination}
                      onSort={handleSort}
                    />
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    className="h-24 text-center text-muted-foreground"
                    colSpan={tableColumns.length || 1}
                  >
                    No matching rows on this page for &quot;{searchWord}&quot;. Source rows without
                    matches are omitted.
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((tableRow, index) => {
                  const row = tableRow.original;
                  return (
                    <TableRow
                      key={tableRow.id}
                      className={`cursor-pointer ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                      onClick={() => {
                        handleRowClick(row, effectiveNodeId, column);
                      }}
                    >
                      {tableRow.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className={alignmentClassForColumn(cell.column.id)}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </AnalysisTableScrollArea>
      </div>

      {(() => {
        // Prefer the per-node materialised summary when it's available.
        // Before the SSE materialization event arrives, fall back to counting
        // from ``nodeData.data`` + pagination, matching the combined branch.
        const summary =
          nodeData.materialized && detachNodeId && materializeSummaries[detachNodeId] ? (
            <GroupedResultsPageSizeSummary
              groups={[]}
              totalInstances={materializeSummaries[detachNodeId].recordCount}
              totalDocuments={materializeSummaries[detachNodeId].uniqueDocuments}
              totalProcessed={materializeSummaries[detachNodeId].totalDocuments}
            />
          ) : (
            <GroupedResultsPageSizeSummary
              groups={nodeData.data}
              totalProcessed={batchProcessedCount(nodeData.pagination)}
            />
          );
        return summary ? (
          <div className="border-t border-border bg-muted/40 px-4 pt-2 text-sm text-muted-foreground">
            {summary}
          </div>
        ) : null;
      })()}
      <ServerPaginationFooter
        table={table}
        pageIndex={currentPage - 1}
        pageSize={globalPageSize}
        rowCount={nodeData.pagination?.total_source_rows ?? 0}
        pageSizeLabel={nodeData.materialized ? 'Occurrences per page' : 'Documents per batch'}
        pageSizeOptions={[...PAGE_SIZE_OPTIONS_DEFAULT]}
        loading={nodeIsLoading}
        showPageSize={!readOnly}
      >
        <DisabledReasonTooltip reason={readOnly ? READ_ONLY_DISABLED_REASON : undefined}>
          <Button
            onClick={() => {
              if (!searchWord.trim()) return;
              for (const nid of processTargetIds) {
                if (materializedPaths[nid]) continue;
                const col = isMultiBlock
                  ? effectiveNodeColumnSelections.find((s) => s.nodeId === nid)?.column || ''
                  : column;
                if (!col) continue;
                void handleMaterialize(nid, col);
              }
            }}
            disabled={
              readOnly ||
              nodeIsLoading ||
              isAnyProcessTargetMaterializing ||
              allProcessTargetsMaterialized ||
              !searchWord.trim() ||
              !canDetach ||
              processTargetIds.length === 0
            }
            size="sm"
            variant="outline"
            className="h-auto max-w-full whitespace-normal wrap-break-word py-1.5 text-left"
            title={
              readOnly
                ? undefined
                : isMultiBlock
                  ? 'Cache all occurrence rows for both data blocks so subsequent pagination and Add-to-Workspace reuse them'
                  : 'Cache all occurrence rows to disk so subsequent pagination and Add-to-Workspace reuse them'
            }
          >
            {isAnyProcessTargetMaterializing ? (
              <>
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                Processing...
              </>
            ) : allProcessTargetsMaterialized ? (
              <>Processed</>
            ) : isMultiBlock ? (
              <>Process Both Blocks</>
            ) : (
              <>Process All</>
            )}
          </Button>
        </DisabledReasonTooltip>
        <DisabledReasonTooltip reason={readOnly ? READ_ONLY_DISABLED_REASON : undefined}>
          <Button
            onClick={() => {
              if (detachNodeId) {
                const detachNode = panelSelectedNodes.find((n) => n.id === detachNodeId);
                const detachLabel = (detachNode?.name || nodeKey) as string;
                openDetachDialog([{ nodeId: detachNodeId, column, nodeLabel: detachLabel }]);
              }
            }}
            disabled={
              readOnly ||
              nodeIsLoading ||
              isDetaching ||
              !searchWord.trim() ||
              !canDetach ||
              !detachNodeId
            }
            size="sm"
            className="h-auto max-w-full whitespace-normal wrap-break-word py-1.5 text-left"
            title={
              readOnly
                ? undefined
                : 'Create a new data block with concordance results joined to the original table'
            }
          >
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
        </DisabledReasonTooltip>
      </ServerPaginationFooter>
    </div>
  );
}
