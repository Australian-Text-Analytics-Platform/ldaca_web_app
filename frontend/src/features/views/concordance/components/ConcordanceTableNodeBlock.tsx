import { useEffect, useRef } from 'react';
import type { ConcordanceNodeResult as ConcordanceResultEntry } from '@/api';
import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { AnalysisTableFrame } from '@/features/views/common/components/AnalysisTableScrollArea';
import { ServerPaginationFooter } from '@/features/views/common/components/ServerPaginationFooter';
import { useServerTable } from '@/features/views/common/hooks/useServerTable';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import { GroupedResultsPageSizeSummary } from '../../common/components/GroupedResultsPageSizeSummary';
import { PAGE_SIZE_OPTIONS_DEFAULT } from '../../common/constants';
import type { NodeColumnSelection } from '../../common/nodeSelectionTypes';
import { batchProcessedCount } from '../concordanceDispersionDomain';
import { findConcordanceSourceNode, getConcordanceSourceColor } from '../concordanceSourceDomain';
import { CONCORDANCE_COMBINED_NODE_KEY } from '../concordanceTableDomain';
import type { PaginationState } from '../hooks/useConcordanceTaskFlow';
import { concordanceHeaderMode } from '../concordanceTablePresentation';
import { GREY } from '../../common/vizPalette';
import { normalizeNodeAccentColor } from '@/lib/nodeColor';
import { ConcordancePlainHeader, ConcordanceRowsTable } from './ConcordanceRowsTable';
import {
  ConcordanceCombinedResultHeader,
  ConcordanceSourceResultHeader,
} from './ConcordanceResultCardHeader';
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
  reviewRowUnit: 'documents' | 'matches' | null;
  highlightL1R1: boolean;
  resultSummary?: ReactNode;

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
 * Preview pagination walks source documents. Review table pagination walks
 * matches, with one displayed row per matched span. The projected Result's
 * `total_source_rows` and page size therefore use the active mode's explicit
 * unit rather than inferring it from the rendered groups.
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
  reviewRowUnit,
  highlightL1R1,
  resultSummary,
}: ConcordanceTableNodeBlockProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
  }, [globalPageSize]);
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
        if (viewportRef.current) viewportRef.current.scrollTop = 0;
        onPageSizeChange(next.pageSize);
        return;
      }
      const newPage = next.pageIndex + 1;
      if (newPage !== combinedPage) {
        if (viewportRef.current) viewportRef.current.scrollTop = 0;
        setCombinedPage(newPage);
      }
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
      {reviewRowUnit === null ? (
        <div className="border-t border-surface-border bg-panel/40 px-4 pt-2 text-body text-description">
          {combinedPageSizeSummary}
        </div>
      ) : null}
      <ServerPaginationFooter
        table={table}
        pageIndex={combinedPage - 1}
        pageSize={globalPageSize}
        rowCount={nodeData.pagination.total_source_rows}
        pageSizeLabel={
          reviewRowUnit === null
            ? 'Documents per page'
            : panelSelectedNodes.length > 1
              ? 'Matches per source per page'
              : 'Matches per page'
        }
        pageSizeOptions={[...PAGE_SIZE_OPTIONS_DEFAULT]}
        loading={combinedLoading}
        showPageSize
      />
      {resultSummary ? <div className="border-t border-surface-border">{resultSummary}</div> : null}
    </>
  );

  return (
    <Card data-testid="concordance-table-combined-card" className="mb-6 overflow-hidden">
      <ConcordanceCombinedResultHeader
        nodes={panelSelectedNodes}
        sourceColorMap={sourceColorMap}
        defaultPalette={defaultPalette}
        testId="concordance-table-combined-header"
      />
      <CardContent className="bg-panel/20 p-3">
        <AnalysisTableFrame
          maxHeightClass="max-h-100"
          belowTable={combinedBelowTable}
          viewportRef={viewportRef}
        >
          <ConcordanceRowsTable
            table={table}
            rows={rows}
            tableColumns={tableColumns}
            searchWord={searchWord}
            loading={combinedLoading}
            highlightL1R1={highlightL1R1}
            getSourceColor={(row) => {
              if (!row.__source_node) return defaultPalette[0] ?? GREY;
              return getConcordanceSourceColor(row.__source_node, sourceColorMap, defaultPalette);
            }}
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
      </CardContent>
    </Card>
  );
}

/**
 * Rendered by: ConcordanceTableNodeBlock for a single data block's results.
 *
 * Preview pagination walks source documents while Review table pagination
 * walks matches. `total_source_rows` already carries the projection's unit.
 * Flow: derive display columns, apply the shared phase-aware header policy to
 * both rendering and click dispatch, tint direct match/L1/R1 cells with the
 * source colour, then render the server-paginated table and footer.
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
  reviewRowUnit,
  highlightL1R1,
  resultSummary,
}: ConcordanceTableNodeBlockProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
  }, [globalPageSize]);
  const { nodeId: actualNodeId, paginationKey, requestNodeId, column } = context;

  const { rows, tableColumns, columns } = buildConcordanceTableModel({
    nodeData,
    showMetadata,
    selectedMetadataColumns,
  });

  const currentNodePagination = nodePagination[paginationKey];
  const currentPage = currentNodePagination?.currentPage ?? 1;
  const nodeIsLoading = Boolean(nodeLoading[paginationKey]);
  const isReview = reviewRowUnit !== null;
  const headerMode = (columnKey: string) =>
    concordanceHeaderMode({
      columnKey,
      documentColumn: column,
      metadataColumns: nodeData.metadata.metadata_columns,
      isCombined: false,
      isReview,
    });
  const handleEligibleSort = (columnKey: string) => {
    if (headerMode(columnKey) !== 'sortable') return;
    handleSort(columnKey, paginationKey, requestNodeId);
  };

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
        if (viewportRef.current) viewportRef.current.scrollTop = 0;
        onPageSizeChange(next.pageSize);
        return;
      }
      const newPage = next.pageIndex + 1;
      if (newPage !== currentPage) {
        if (viewportRef.current) viewportRef.current.scrollTop = 0;
        handlePageChange(newPage, paginationKey, requestNodeId);
      }
    },
  });

  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty-string display name must fall back to the node key
  const dataBlockLabel = context.displayName || nodeKey;
  const sourceColor = normalizeNodeAccentColor(context.nodeColor) ?? GREY;
  const pageSizeSummary = (
    <GroupedResultsPageSizeSummary
      groups={nodeData.data}
      totalProcessed={batchProcessedCount(nodeData.pagination)}
    />
  );
  const belowTable = (
    <>
      {reviewRowUnit === null ? (
        <div className="border-t border-surface-border bg-panel/40 px-4 pt-2 text-body text-description">
          {pageSizeSummary}
        </div>
      ) : null}
      <ServerPaginationFooter
        table={table}
        pageIndex={currentPage - 1}
        pageSize={globalPageSize}
        rowCount={nodeData.pagination.total_source_rows}
        pageSizeLabel={
          reviewRowUnit === null
            ? 'Documents per page'
            : panelSelectedNodes.length > 1
              ? 'Matches per source per page'
              : 'Matches per page'
        }
        pageSizeOptions={[...PAGE_SIZE_OPTIONS_DEFAULT]}
        loading={nodeIsLoading}
        showPageSize
      />
      {resultSummary ? <div className="border-t border-surface-border">{resultSummary}</div> : null}
    </>
  );

  return (
    <Card data-testid="concordance-table-source-card" className="mb-6 overflow-hidden">
      <ConcordanceSourceResultHeader
        name={dataBlockLabel}
        color={sourceColor}
        testId="concordance-table-source-header"
      />
      <CardContent className="bg-panel/20 p-3">
        <AnalysisTableFrame
          maxHeightClass="max-h-100"
          belowTable={belowTable}
          viewportRef={viewportRef}
        >
          <ConcordanceRowsTable
            table={table}
            rows={rows}
            tableColumns={tableColumns}
            searchWord={searchWord}
            loading={nodeIsLoading}
            highlightL1R1={highlightL1R1}
            getSourceColor={() => sourceColor}
            renderHeader={(header) => {
              const mode = headerMode(header.column.id);
              return mode === 'sortable' ? (
                <SortableHeader
                  key={header.id}
                  columnKey={header.column.id}
                  label={header.column.id}
                  paginationKey={paginationKey}
                  requestNodeId={requestNodeId}
                  nodePagination={nodePagination}
                  onSort={handleEligibleSort}
                />
              ) : (
                <ConcordancePlainHeader
                  key={header.id}
                  header={header}
                  hint={mode === 'preview-review-hint' ? 'Run All to enable sorting' : undefined}
                />
              );
            }}
            getRowClassName={(_row, index) =>
              `cursor-pointer ${index % 2 === 0 ? 'bg-surface' : 'bg-panel'}`
            }
            onRowClick={(row) => {
              if (actualNodeId && column) handleRowClick(row, actualNodeId, column);
            }}
          />
        </AnalysisTableFrame>
      </CardContent>
    </Card>
  );
}
