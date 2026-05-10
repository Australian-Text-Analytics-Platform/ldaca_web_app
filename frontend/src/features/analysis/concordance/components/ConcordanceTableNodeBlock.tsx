import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Loader2, Plus } from 'lucide-react';
import type { ConcordanceGroupedRow, ConcordanceResultEntry } from '@/api/text';
import { AnalysisTableScrollArea } from '@/components/AnalysisTableScrollArea';
import { AnalysisPagination } from '@/components/AnalysisPagination';
import { GroupedResultsPageSizeSummary } from '../../common/components/GroupedResultsPageSizeSummary';
import { takeMostRecent } from '@/utils/selectionUtils';
import { getNodeIdentifier } from '../../common';
import type { NodeColumnSelection } from '../../common';
import type { WorkspaceNodeLike } from '../../common/nodeSelectionTypes';
import type { PaginationState } from '../hooks/useConcordanceTaskFlow';
import { SortableHeader } from './SortableHeader';
import { CONCORDANCE_CORE_COLUMNS, CONCORDANCE_FREQ_COLUMNS } from '../../generatedColumns';
import { flattenConcordanceGroups } from '../concordanceViewModels';

const CORE_COLS = [...CONCORDANCE_CORE_COLUMNS];
const FREQ_COLS = [...CONCORDANCE_FREQ_COLUMNS];
const ALL_CONC_COLS_SET = new Set<string>([...CORE_COLS, ...FREQ_COLS]);

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
  combinedPage: number;
  combinedLoading: boolean;
  nodeLoading: Record<string, boolean>;
  nodeDetaching: Record<string, boolean>;
  nodeMaterializing: Record<string, boolean>;
  materializedPaths: Record<string, string>;
  materializeSummaries: Record<string, { recordCount: number; uniqueDocuments: number; totalDocuments: number }>;

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
};

export const ConcordanceTableNodeBlock: React.FC<ConcordanceTableNodeBlockProps> = ({
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
  sourceColorMap,
  defaultPalette,
  nodePagination,
  globalPageSize,
  combinedPage,
  combinedLoading,
  nodeLoading,
  nodeDetaching,
  nodeMaterializing,
  materializedPaths,
  materializeSummaries,
  handleSort,
  handlePageChange,
  handleRowClick,
  handleMaterialize,
  setCombinedPage,
  openDetachDialog,
}) => {
  const { nodeId: actualNodeId, paginationKey, requestNodeId, column } = context;
  const effectiveNodeId = actualNodeId || requestNodeId;
  const detachNodeId = actualNodeId || (labelToNodeId?.[nodeKey] ?? requestNodeId);
  const canDetach = Boolean(detachNodeId) && detachNodeId !== '__COMBINED__';

  if (nodeKey === '__COMBINED__') {
    const groupedRows = nodeData.data;
    const rows = flattenConcordanceGroups(groupedRows);
    const columns = nodeData.columns;
    const combinedHasPrev = Boolean(nodeData.pagination?.has_prev);
    const combinedHasNext = Boolean(nodeData.pagination?.has_next);
    const metaCols = nodeData.metadata.metadata_columns;
    const concCols = (nodeData.metadata.concordance_columns?.length
      ? nodeData.metadata.concordance_columns.filter((c: string) => ALL_CONC_COLS_SET.has(c))
      : CORE_COLS) as string[];
    const visibleMetaCols = (selectedMetadataColumns ?? []).filter((columnName) => metaCols.includes(columnName));
    const rawDisplayColumns = showMetadata
      ? [...concCols.filter((c) => columns.includes(c)), ...visibleMetaCols]
      : concCols.filter((c) => columns.includes(c));
    const displayColumns = dedupeColumns(rawDisplayColumns);

    const combinedNodeIds = takeMostRecent(selectedNodes, 2)
      .map((n) => n.id)
      .filter((id): id is string => Boolean(id));
    const isAnyCombinedMaterializing = combinedNodeIds.some((id) => Boolean(nodeMaterializing[id]));
    const allCombinedMaterialized = combinedNodeIds.length > 0
      && combinedNodeIds.every((id) => Boolean(materializedPaths[id]));

    return (
      <div key="__COMBINED__" className="mb-6">
        <div className="flex items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Combined Results</h3>
          <div className="ml-auto flex items-center space-x-2">
            <span className="text-xs text-gray-500">Rows colored by source data block</span>
            <Button
              onClick={() => {
                if (combinedNodeIds.length === 0 || !searchWord.trim()) return;
                for (const nid of combinedNodeIds) {
                  if (materializedPaths[nid]) continue;
                  const col = effectiveNodeColumnSelections.find((s) => s.nodeId === nid)?.column || '';
                  if (!col) continue;
                  void handleMaterialize(nid, col);
                }
              }}
              disabled={
                isAnyCombinedMaterializing
                || allCombinedMaterialized
                || !searchWord.trim()
                || combinedNodeIds.length === 0
              }
              size="sm"
              variant="outline"
              className="h-auto max-w-full whitespace-normal wrap-break-word py-1.5 text-left"
              title="Cache all occurrence rows for both data blocks so subsequent pagination and Add-to-Workspace reuse them"
            >
              {isAnyCombinedMaterializing ? (
                <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Processing...</>
              ) : allCombinedMaterialized ? (
                <>Processed</>
              ) : (
                <>Process Both</>
              )}
            </Button>
            <Button
              onClick={() => {
                if (combinedNodeIds.length === 0 || !searchWord.trim()) return;
                const nodes = combinedNodeIds.map((nid) => {
                  const col = effectiveNodeColumnSelections.find((s) => s.nodeId === nid)?.column || '';
                  const sourceNode = panelSelectedNodes.find((node, idx) => getNodeIdentifier(node, idx) === nid);
                  const sourceLabel = (sourceNode?.name || sourceNode?.id || nid) as string;
                  return { nodeId: nid, column: col, nodeLabel: sourceLabel };
                }).filter((n) => n.column);
                openDetachDialog(nodes);
              }}
              disabled={combinedLoading || !searchWord.trim() || combinedNodeIds.length === 0}
              size="sm"
              className="h-auto max-w-full whitespace-normal wrap-break-word py-1.5 text-left"
              title="Create new data blocks with concordance results for both sources joined to their original tables"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Both to Workspace
            </Button>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card">
          <AnalysisTableScrollArea maxHeightClass="max-h-100">
            <Table className="min-w-180" disableContainer>
              <TableHeader className="bg-gray-50 sticky top-0 z-10">
                <TableRow>
                  {displayColumns.map((c: string) => (
                    <TableHead
                      key={c}
                      className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                    >
                      {c}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell className="h-24 text-center text-muted-foreground" colSpan={displayColumns.length || 1}>
                      No matching rows on this page for &quot;{searchWord}&quot;. Source rows without matches are omitted.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row: Record<string, unknown>, idx: number) => {
                    const rawSrc = row.__source_node;
                    const normalized = rawSrc ? rawSrc.toString().toLowerCase() : undefined;
                    let color = normalized ? sourceColorMap[normalized] : undefined;
                    if (!color && rawSrc && normalized) {
                      // Fallback: loose match (substring) when exact lookup fails.
                      const entry = Object.entries(sourceColorMap).find(([k]) => k.includes(normalized));
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
                        key={idx}
                        className="cursor-pointer"
                        style={{ backgroundColor: bg }}
                        onClick={() => {
                          if (rawSrc) {
                            const nodeObj = panelSelectedNodes.find((n: WorkspaceNodeLike) => {
                              const candidates = [
                                n.id,
                                n.name,
                                (n as Record<string, unknown>).data
                                  && typeof (n as Record<string, unknown>).data === 'object'
                                  ? ((n as Record<string, unknown>).data as Record<string, unknown>)?.name
                                  : undefined,
                                n.label,
                                (n as Record<string, unknown>).data
                                  && typeof (n as Record<string, unknown>).data === 'object'
                                  ? ((n as Record<string, unknown>).data as Record<string, unknown>)?.label
                                  : undefined,
                              ].filter(Boolean).map((v) => String(v).toLowerCase());
                              return candidates.includes(rawSrc.toString().toLowerCase());
                            });
                            const sel = nodeObj && effectiveNodeColumnSelections.find((s) => s.nodeId === nodeObj.id);
                            if (nodeObj && sel?.column) {
                              handleRowClick(row, String(nodeObj.id ?? ''), sel.column);
                            }
                          }
                        }}
                      >
                        {displayColumns.map((c: string, i: number) => (
                          <TableCell key={i}>
                            {row[c] !== undefined && row[c] !== null ? String(row[c]) : ''}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </AnalysisTableScrollArea>
          <AnalysisPagination
            page={combinedPage}
            pageSize={globalPageSize}
            hasNext={combinedHasNext}
            hasPrev={combinedHasPrev}
            totalPages={nodeData.pagination?.total_source_pages}
            onPageChange={(newPage) => setCombinedPage(newPage)}
            pageSizeSummary={nodeData.materialized
              ? (Object.keys(materializeSummaries).length > 0
                ? <GroupedResultsPageSizeSummary
                    groups={[]}
                    totalInstances={Object.values(materializeSummaries).reduce((sum, s) => sum + s.recordCount, 0)}
                    totalDocuments={Object.values(materializeSummaries).reduce((sum, s) => sum + s.uniqueDocuments, 0)}
                    totalProcessed={Object.values(materializeSummaries).reduce((sum, s) => sum + s.totalDocuments, 0)}
                  />
                : undefined)
              : <GroupedResultsPageSizeSummary groups={nodeData.data} totalProcessed={nodeData.pagination?.page_size} />
            }
            loading={combinedLoading}
          />
        </div>
      </div>
    );
  }

  // Per-node table rendering (instance rows).
  const groupedRows = nodeData.data;
  const rows = flattenConcordanceGroups(groupedRows);
  const allCols = nodeData.columns;
  const metaCols = nodeData.metadata.metadata_columns;
  const concCols = (nodeData.metadata.concordance_columns?.length
    ? nodeData.metadata.concordance_columns.filter((c: string) => ALL_CONC_COLS_SET.has(c))
    : CORE_COLS) as string[];
  const visibleMetaCols = (selectedMetadataColumns ?? []).filter((columnName) => metaCols.includes(columnName));
  const rawDisplayColumns = showMetadata
    ? [...concCols.filter((c) => allCols.includes(c)), ...visibleMetaCols.filter((c) => allCols.includes(c))]
    : concCols.filter((c) => allCols.includes(c));
  const displayColumns = dedupeColumns(rawDisplayColumns);
  const tableColumns = displayColumns.length > 0 ? displayColumns : allCols;
  const sortableColumns = new Set(metaCols);

  const currentNodePagination = nodePagination[paginationKey];
  const currentPage = currentNodePagination?.currentPage ?? 1;
  const nodeIsLoading = Boolean(nodeLoading[paginationKey]);
  const hasPrev = Boolean(nodeData.pagination?.has_prev) || currentPage > 1;
  const hasNext = Boolean(nodeData.pagination?.has_next);

  const detachingKey = detachNodeId ?? '';
  const isDetaching = detachingKey ? Boolean(nodeDetaching[detachingKey]) : false;
  const isMaterializing = detachingKey ? Boolean(nodeMaterializing[detachingKey]) : false;
  const hasMaterializedPath = detachingKey ? Boolean(materializedPaths[detachingKey]) : false;

  const showNodeIndicator = panelSelectedNodes.length > 1 && context.nodeColor;

  return (
    <div key={nodeKey} className="mb-6">
      {showNodeIndicator && (
        <div className="mb-2 flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: context.nodeColor }}
          />
          <h3 className="text-sm font-medium text-foreground">
            {context.displayName || nodeKey}
          </h3>
        </div>
      )}
      <div
        className="rounded-lg border border-border bg-card"
        style={showNodeIndicator ? { borderLeftWidth: '3px', borderLeftColor: context.nodeColor } : undefined}
      >
        <AnalysisTableScrollArea maxHeightClass="max-h-100">
          <Table className="min-w-180" disableContainer>
            <TableHeader className="bg-gray-50 sticky top-0 z-10">
              <TableRow>
                {tableColumns.map((key) => {
                  const isSortable = showMetadata && sortableColumns.has(key);
                  return isSortable ? (
                    <SortableHeader
                      key={key}
                      columnKey={key}
                      label={key}
                      paginationKey={paginationKey}
                      requestNodeId={requestNodeId}
                      nodePagination={nodePagination}
                      onSort={handleSort}
                    />
                  ) : (
                    <TableHead
                      key={key}
                      className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                    >
                      {key}
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell className="h-24 text-center text-muted-foreground" colSpan={tableColumns.length || 1}>
                    No matching rows on this page for &quot;{searchWord}&quot;. Source rows without matches are omitted.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row: Record<string, unknown>, index: number) => (
                  <TableRow
                    key={index}
                    className={`cursor-pointer ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                    onClick={() => {
                      handleRowClick(row, effectiveNodeId, column);
                    }}
                  >
                    {tableColumns.map((colKey: string, cellIndex) => (
                      <TableCell key={cellIndex}>
                        {row[colKey] !== null && row[colKey] !== undefined ? String(row[colKey]) : ''}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </AnalysisTableScrollArea>
      </div>

      <AnalysisPagination
        page={currentPage}
        pageSize={nodePagination[paginationKey]?.pageSize ?? globalPageSize}
        hasNext={hasNext}
        hasPrev={hasPrev}
        totalPages={nodeData.pagination?.total_source_pages}
        onPageChange={(newPage) => handlePageChange(newPage, paginationKey, requestNodeId)}
        pageSizeSummary={nodeData.materialized && detachNodeId && materializeSummaries[detachNodeId]
          ? <GroupedResultsPageSizeSummary
              groups={[]}
              totalInstances={materializeSummaries[detachNodeId].recordCount}
              totalDocuments={materializeSummaries[detachNodeId].uniqueDocuments}
              totalProcessed={materializeSummaries[detachNodeId].totalDocuments}
            />
          : (nodeData.materialized
            ? undefined
            : <GroupedResultsPageSizeSummary groups={nodeData.data} totalProcessed={nodeData.pagination?.page_size} />)
        }
        loading={nodeIsLoading}
      >
        <Button
          onClick={() => {
            if (detachNodeId) {
              void handleMaterialize(detachNodeId, column);
            }
          }}
          disabled={
            nodeIsLoading
            || isMaterializing
            || hasMaterializedPath
            || !searchWord.trim()
            || !canDetach
            || !detachNodeId
          }
          size="sm"
          variant="outline"
          className="h-auto max-w-full whitespace-normal wrap-break-word py-1.5 text-left"
          title="Cache all occurrence rows to disk so subsequent pagination and Add-to-Workspace reuse them"
        >
          {isMaterializing ? (
            <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Processing...</>
          ) : hasMaterializedPath ? (
            <>Processed</>
          ) : (
            <>Process All</>
          )}
        </Button>
        <Button
          onClick={() => {
            if (detachNodeId) {
              const detachNode = panelSelectedNodes.find((n) => n.id === detachNodeId);
              const detachLabel = (detachNode?.name || nodeKey) as string;
              openDetachDialog([{ nodeId: detachNodeId, column, nodeLabel: detachLabel }]);
            }
          }}
          disabled={nodeIsLoading || isDetaching || !searchWord.trim() || !canDetach || !detachNodeId}
          size="sm"
          className="h-auto max-w-full whitespace-normal wrap-break-word py-1.5 text-left"
          title="Create a new data block with concordance results joined to the original table"
        >
          {isDetaching ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Adding to Workspace...</>
          ) : (
            <><Plus className="mr-2 h-4 w-4" />Add to Workspace</>
          )}
        </Button>
      </AnalysisPagination>
    </div>
  );
};
