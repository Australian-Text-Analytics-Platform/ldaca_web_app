import { Button } from '@/components/ui/button';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { Loader2, Plus } from 'lucide-react';
import type { ConcordanceNodeResult as ConcordanceResultEntry } from '@/api';
import { AnalysisTableFrame } from '@/features/views/common/components/AnalysisTableScrollArea';
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
  CONCORDANCE_COMBINED_NODE_KEY,
  batchProcessedCount,
  findConcordanceSourceNode,
  getConcordanceSourceColor,
} from '../concordanceViewModels';
import { ConcordancePlainHeader, ConcordanceRowsTable } from './ConcordanceRowsTable';
import {
  buildConcordanceTableModel,
  type ConcordanceGroupedRow,
  type ConcordanceRow,
} from './concordanceTableModel';

const READ_ONLY_DISABLED_REASON = 'This action is unavailable while results are read-only.';

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
  const combinedPageSizeSummary = nodeData.materialized ? (
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
  const combinedBelowTable = (
    <>
      {combinedPageSizeSummary ? (
        <div className="border-t border-border bg-muted/40 px-4 pt-2 text-sm text-muted-foreground">
          {combinedPageSizeSummary}
        </div>
      ) : null}
      <ServerPaginationFooter
        table={table}
        pageIndex={combinedPage - 1}
        pageSize={globalPageSize}
        rowCount={nodeData.pagination.total_source_rows}
        pageSizeLabel={nodeData.materialized ? 'Occurrences per page' : 'Documents per batch'}
        pageSizeOptions={[...PAGE_SIZE_OPTIONS_DEFAULT]}
        loading={combinedLoading}
        showPageSize={!readOnly}
      />
    </>
  );

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
                    effectiveNodeColumnSelections.find((s) => s.nodeId === nid)?.column ?? '';
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
                      effectiveNodeColumnSelections.find((s) => s.nodeId === nid)?.column ?? '';
                    const sourceNode = panelSelectedNodes.find(
                      (node, idx) => getNodeIdentifier(node, idx) === nid,
                    );
                    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty-string name/id must fall back to the next identifier
                    const sourceLabel = sourceNode?.name || sourceNode?.id || nid;
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
      <AnalysisTableFrame maxHeightClass="max-h-100" belowTable={combinedBelowTable}>
        <ConcordanceRowsTable
          table={table}
          rows={rows}
          tableColumns={tableColumns}
          searchWord={searchWord}
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
              handleRowClick(row, nodeObj.id ?? '', sel.column);
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
  const canDetach = Boolean(detachNodeId) && detachNodeId !== CONCORDANCE_COMBINED_NODE_KEY;

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

  const detachingKey = detachNodeId;
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
  // Prefer the per-node materialised summary when it's available. Before the
  // SSE materialization event arrives, fall back to counting from
  // ``nodeData.data`` + pagination, matching the combined branch.
  const pageSizeSummary =
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
                  ? (effectiveNodeColumnSelections.find((s) => s.nodeId === nid)?.column ?? '')
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
                // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty-string node name must fall back to the node key
                const detachLabel = detachNode?.name || nodeKey;
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
          renderHeader={(header) => (
            // Every displayed column is sortable: the backend's materialised
            // path honours sort_by for any column in the parquet schema
            // (including CONC_*). The non-materialised path silently drops
            // CONC_* sorts because those columns are computed post-slice, but
            // metadata-column sorts still apply.
            <SortableHeader
              key={header.id}
              columnKey={header.column.id}
              label={header.column.id}
              paginationKey={paginationKey}
              requestNodeId={requestNodeId}
              nodePagination={nodePagination}
              onSort={handleSort}
            />
          )}
          getRowClassName={(_row, index) =>
            `cursor-pointer ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`
          }
          onRowClick={(row) => {
            handleRowClick(row, effectiveNodeId, column);
          }}
        />
      </AnalysisTableFrame>
    </div>
  );
}
