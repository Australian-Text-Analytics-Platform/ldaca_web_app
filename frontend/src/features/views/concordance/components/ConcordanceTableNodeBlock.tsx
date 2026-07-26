import type { ConcordanceNodeResult as ConcordanceResultEntry } from '@/api';
import { AnalysisTableFrame } from '@/features/views/common/components/AnalysisTableScrollArea';
import { ServerPaginationFooter } from '@/features/views/common/components/ServerPaginationFooter';
import { useServerTable } from '@/features/views/common/hooks/useServerTable';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import { GroupedResultsPageSizeSummary } from '../../common/components/GroupedResultsPageSizeSummary';
import { PAGE_SIZE_OPTIONS_DEFAULT } from '../../common/constants';
import { CONCORDANCE_PRESENTATION_COLUMN_SET } from '../../common/generatedColumns';
import type { NodeColumnSelection } from '../../common/nodeSelectionTypes';
import { batchProcessedCount } from '../concordanceDispersionDomain';
import { findConcordanceSourceNode, getConcordanceSourceColor } from '../concordanceSourceDomain';
import { CONCORDANCE_COMBINED_NODE_KEY } from '../concordanceTableDomain';
import type { PaginationState } from '../hooks/useConcordanceTaskFlow';
import { ConcordancePlainHeader, ConcordanceRowsTable } from './ConcordanceRowsTable';
import {
  buildConcordanceTableModel,
  type ConcordanceGroupedRow,
  type ConcordanceRow,
} from './concordanceTableModel';
import { SortableHeader } from './SortableHeader';

export interface ConcordanceTableNodeBlockProps {
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
  panelSelectedNodes: WorkspaceNodeMetadata[];
  effectiveNodeColumnSelections: NodeColumnSelection[];

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

  // Handlers
  handleSort: (columnKey: string, paginationKey: string, requestNodeId: string) => void;
  handlePageChange: (newPage: number, paginationKey: string, requestNodeId: string) => void;
  handleRowClick: (
    row: Record<string, unknown>,
    nodeId: string,
    column: string,
    groupedHits?: ConcordanceGroupedRow,
  ) => void;
  setCombinedPage: (page: number) => void;
}

/**
 * Rendered by: ConcordanceResultsPanel for each table-oriented concordance result block.
 * Dispatches to the combined ("both blocks") view or the per-node view, each of
 * which owns its own server-paginated TanStack table instance. The split keeps
 * the `useServerTable` hook unconditional within each component (the two paths
 * have different row models, headers, and footer actions).
 */
export function ConcordanceTableNodeBlock(props: ConcordanceTableNodeBlockProps) {
  if (props.nodeKey === CONCORDANCE_COMBINED_NODE_KEY) {
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
 * the body still renders the variable number of flattened hit rows.
 * Flow: derive display columns, build the server table, then render the coloured
 * KWIC rows and the shared pagination footer.
 */
function CombinedConcordanceTable({
  nodeData,
  searchWord,
  showMetadata,
  selectedMetadataColumns,
  effectiveNodeColumnSelections,
  panelSelectedNodes,
  sourceColorMap,
  defaultPalette,
  combinedPage,
  globalPageSize,
  onPageSizeChange,
  combinedLoading,
  handleRowClick,
  setCombinedPage,
}: ConcordanceTableNodeBlockProps) {
  const { rows, tableColumns, columns } = buildConcordanceTableModel({
    nodeData,
    showMetadata,
    selectedMetadataColumns,
  });
  const table = useServerTable<ConcordanceRow>({
    data: rows,
    columns,
    rowCount: nodeData.pagination.total_source_rows,
    pageIndex: combinedPage - 1,
    pageSize: globalPageSize,
    // Bridges TanStack paging to the combined-view page + page-size handlers.
    // Invoked by useServerTable when combined-view pagination changes.
    onPaginationChange: (next) => {
      if (next.pageSize !== globalPageSize) {
        onPageSizeChange(next.pageSize);
        return;
      }
      const newPage = next.pageIndex + 1;
      if (newPage !== combinedPage) setCombinedPage(newPage);
    },
  });

  const combinedPageSizeSummary = (
    <GroupedResultsPageSizeSummary
      groups={nodeData.data}
      totalProcessed={batchProcessedCount(nodeData.pagination)}
    />
  );
  const combinedBelowTable = (
    <>
      <div className="border-t border-border bg-muted/40 px-4 pt-2 text-sm text-muted-foreground">
        {combinedPageSizeSummary}
      </div>
      <ServerPaginationFooter
        table={table}
        pageIndex={combinedPage - 1}
        pageSize={globalPageSize}
        rowCount={nodeData.pagination.total_source_rows}
        pageSizeLabel="Documents per batch"
        pageSizeOptions={[...PAGE_SIZE_OPTIONS_DEFAULT]}
        loading={combinedLoading}
        showPageSize
      />
    </>
  );

  return (
    <div className="mb-6">
      <div className="flex items-center mb-4">
        <h3 className="text-lg font-semibold text-gray-800">Combined Results</h3>
        <div className="ml-auto flex items-center">
          <span className="text-xs text-gray-500">Rows colored by source data block</span>
        </div>
      </div>
      <AnalysisTableFrame maxHeightClass="max-h-100" belowTable={combinedBelowTable}>
        <ConcordanceRowsTable
          table={table}
          rows={rows}
          tableColumns={tableColumns}
          searchWord={searchWord}
          loading={combinedLoading}
          renderHeader={(header) => <ConcordancePlainHeader key={header.id} header={header} />}
          getRowClassName={() => 'cursor-pointer'}
          getRowStyle={(row) => {
            const color = getConcordanceSourceColor(
              row.__source_node,
              sourceColorMap,
              defaultPalette,
            );
            return { backgroundColor: `${color}20` };
          }}
          onRowClick={(row) => {
            const rawSrc = row.__source_node;
            if (!rawSrc) return;
            const nodeObj = findConcordanceSourceNode(panelSelectedNodes, rawSrc);
            const sel =
              nodeObj && effectiveNodeColumnSelections.find((s) => s.nodeId === nodeObj.id);
            if (nodeObj && sel?.column) {
              handleRowClick(row, nodeObj.id, sel.column);
            }
          }}
        />
      </AnalysisTableFrame>
    </div>
  );
}

/**
 * Rendered by: ConcordanceTableNodeBlock for a single data block's results.
 *
 * Like the combined view, pagination walks SOURCE documents: `rowCount` is the
 * backend's `total_source_rows` so the footer's page math reflects documents per
 * batch even though the body shows a variable number of hit rows.
 * Flow: derive display columns, build the server table, render generated KWIC
 * headers plus sortable source metadata, then render the shared footer.
 */
function PerNodeConcordanceTable({
  nodeKey,
  nodeData,
  context,
  searchWord,
  showMetadata,
  selectedMetadataColumns,
  panelSelectedNodes,
  nodePagination,
  globalPageSize,
  onPageSizeChange,
  nodeLoading,
  handleSort,
  handlePageChange,
  handleRowClick,
}: ConcordanceTableNodeBlockProps) {
  const { nodeId: actualNodeId, paginationKey, requestNodeId, column } = context;

  const { rows, tableColumns, columns } = buildConcordanceTableModel({
    nodeData,
    showMetadata,
    selectedMetadataColumns,
    fallbackToAllColumns: true,
  });

  const currentNodePagination = nodePagination[paginationKey];
  const currentPage = currentNodePagination?.currentPage ?? 1;
  const nodeIsLoading = Boolean(nodeLoading[paginationKey]);

  const table = useServerTable<ConcordanceRow>({
    data: rows,
    columns,
    rowCount: nodeData.pagination.total_source_rows,
    pageIndex: currentPage - 1,
    pageSize: globalPageSize,
    // Bridges TanStack paging to the per-node page + page-size handlers.
    // Invoked by useServerTable when this node's pagination changes.
    onPaginationChange: (next) => {
      if (next.pageSize !== globalPageSize) {
        onPageSizeChange(next.pageSize);
        return;
      }
      const newPage = next.pageIndex + 1;
      if (newPage !== currentPage) handlePageChange(newPage, paginationKey, requestNodeId);
    },
  });

  const showNodeIndicator = panelSelectedNodes.length > 1 && context.nodeColor;
  const pageSizeSummary = (
    <GroupedResultsPageSizeSummary
      groups={nodeData.data}
      totalProcessed={batchProcessedCount(nodeData.pagination)}
    />
  );
  const belowTable = (
    <>
      <div className="border-t border-border bg-muted/40 px-4 pt-2 text-sm text-muted-foreground">
        {pageSizeSummary}
      </div>
      <ServerPaginationFooter
        table={table}
        pageIndex={currentPage - 1}
        pageSize={globalPageSize}
        rowCount={nodeData.pagination.total_source_rows}
        pageSizeLabel="Documents per batch"
        pageSizeOptions={[...PAGE_SIZE_OPTIONS_DEFAULT]}
        loading={nodeIsLoading}
        showPageSize
      />
    </>
  );

  return (
    <div className="mb-6">
      {showNodeIndicator && (
        <div className="mb-2 flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: context.nodeColor }}
          />
          <h3 className="text-sm font-medium text-foreground">
            {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty-string display name must fall back to the node key */}
            {context.displayName || nodeKey}
          </h3>
        </div>
      )}
      <AnalysisTableFrame
        maxHeightClass="max-h-100"
        belowTable={belowTable}
        style={
          showNodeIndicator
            ? { borderLeftWidth: '3px', borderLeftColor: context.nodeColor }
            : undefined
        }
      >
        <ConcordanceRowsTable
          table={table}
          rows={rows}
          tableColumns={tableColumns}
          searchWord={searchWord}
          loading={nodeIsLoading}
          renderHeader={(header) =>
            CONCORDANCE_PRESENTATION_COLUMN_SET.has(header.column.id) ? (
              <ConcordancePlainHeader key={header.id} header={header} />
            ) : (
              <SortableHeader
                key={header.id}
                columnKey={header.column.id}
                label={header.column.id}
                paginationKey={paginationKey}
                requestNodeId={requestNodeId}
                nodePagination={nodePagination}
                onSort={handleSort}
              />
            )
          }
          getRowClassName={(_row, index) =>
            `cursor-pointer ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`
          }
          onRowClick={(row) => {
            if (actualNodeId && column) handleRowClick(row, actualNodeId, column);
          }}
        />
      </AnalysisTableFrame>
    </div>
  );
}
