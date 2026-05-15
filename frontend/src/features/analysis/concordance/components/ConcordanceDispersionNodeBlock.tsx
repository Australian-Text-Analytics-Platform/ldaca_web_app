import React, { useCallback, useState } from 'react';
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
import { AnalysisTableScrollArea } from '@/features/analysis/common/components/AnalysisTableScrollArea';
import { AnalysisPagination } from '@/features/analysis/common/components/AnalysisPagination';
import { GroupedResultsPageSizeSummary } from '../../common/components/GroupedResultsPageSizeSummary';
import { takeMostRecent } from '@/utils/selectionUtils';
import { getNodeIdentifier } from '../../common';
import type { NodeColumnSelection } from '../../common';
import type { WorkspaceNodeLike } from '../../common/nodeSelectionTypes';
import type { PaginationState } from '../hooks/useConcordanceTaskFlow';
import { CONCORDANCE_DISPERSION_COLUMN } from '../../generatedColumns';
import {
  batchProcessedCount,
  buildDispersionRows,
  getDispersionBarWidthPercent,
  getDispersionHits,
  getDispersionTextLength,
  type ConcordanceDispersionRow,
  type DispersionDisplayBinCount,
  type TaggedBinRow,
} from '../concordanceViewModels';
import { ConcordanceDispersionCell } from './ConcordanceDispersionCell';
import { ConcordanceDispersionLegend } from './ConcordanceDispersionLegend';
import { ConcordanceDispersionSummary } from './ConcordanceDispersionSummary';
import type { MultiSeriesChartType } from '../../common/components/MultiSeriesChart';

const EMPTY_BIN_SELECTION: ReadonlySet<number> = new Set<number>();

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

// When metadata columns are visible, lock the dispersion bar column to 85 %
// of the viewport so the bars retain enough length to read. Metadata columns
// then claim the remaining 15 % and overflow horizontally — the ScrollArea
// wrapping the table exposes scrollbars in both directions, signalling the
// user to scroll right for any extra metadata that didn't fit.
const DISPERSION_COLUMN_WIDTH_RATIO = 0.85;
const METADATA_COLUMN_MIN_WIDTH_PX = 200;

const getDispersionColumnStyle = (
  isMetadataVisible: boolean,
  visibleWidth: number,
): React.CSSProperties | undefined => {
  if (!isMetadataVisible) {
    return undefined;
  }

  if (visibleWidth <= 0) {
    return undefined;
  }

  const columnWidth = `${Math.floor(visibleWidth * DISPERSION_COLUMN_WIDTH_RATIO)}px`;
  return {
    width: columnWidth,
    minWidth: columnWidth,
    maxWidth: columnWidth,
  };
};

// Force a sensible minimum width on each visible metadata column so the
// table extends beyond the viewport when needed, enabling horizontal scroll.
const getMetadataColumnStyle = (
  isMetadataVisible: boolean,
): React.CSSProperties | undefined =>
  isMetadataVisible
    ? { minWidth: `${METADATA_COLUMN_MIN_WIDTH_PX}px` }
    : undefined;

export type ConcordanceDispersionNodeBlockProps = {
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
  resultsViewportWidth: number;

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

  // Dispersion-specific state
  proportionalDispersionBars: boolean;
  colourMatches: boolean;
  lowercaseMatches: boolean;
  hiddenMatchedTexts: Set<string>;
  setHiddenMatchedTexts: React.Dispatch<React.SetStateAction<Set<string>>>;
  binCount: DispersionDisplayBinCount;
  onBinCountChange: (value: DispersionDisplayBinCount) => void;
  combinedSourceMode: 'aggregate' | 'split';
  dispersionChartType: MultiSeriesChartType;
  onDispersionChartTypeChange: (value: MultiSeriesChartType) => void;
  selectedBinIndices: Record<string, Set<number>>;
  onBinSelect: (blockKey: string, index: number, shiftHeld: boolean) => void;
  onClearBinSelection: (blockKey: string) => void;
  allMatchedTexts: string[];
  matchedTextColorMap: Record<string, string>;
  getMaterializedBinsForKey: (nodeKey: string) => TaggedBinRow[] | undefined;
  isBlockMaterialised: (nodeKey: string) => boolean;
  onDispersionDetach: (
    nodes: Array<{ nodeId: string; column: string; nodeLabel: string }>,
    selectedBins: ReadonlySet<number> | null,
    binCount: number,
    options?: {
      selectedMatchedTexts?: string[] | null;
      matchCaseInsensitive?: boolean;
    },
  ) => Promise<void> | void;

  // Handlers
  handlePageChange: (newPage: number, paginationKey: string, requestNodeId: string) => void;
  handleRowClick: (
    row: Record<string, unknown>,
    nodeId: string,
    column: string,
    groupedHits?: ConcordanceGroupedRow,
  ) => void;
  handleMaterialize: (nodeId: string, column: string) => Promise<void>;
  setCombinedPage: (page: number) => void;
};

export const ConcordanceDispersionNodeBlock: React.FC<ConcordanceDispersionNodeBlockProps> = ({
  nodeKey,
  nodeData,
  context,
  searchWord,
  showMetadata,
  selectedMetadataColumns,
  resultsViewportWidth,
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
  proportionalDispersionBars,
  colourMatches,
  lowercaseMatches,
  hiddenMatchedTexts,
  setHiddenMatchedTexts,
  binCount,
  onBinCountChange,
  combinedSourceMode,
  dispersionChartType,
  onDispersionChartTypeChange,
  selectedBinIndices,
  onBinSelect,
  onClearBinSelection,
  allMatchedTexts,
  matchedTextColorMap,
  getMaterializedBinsForKey,
  isBlockMaterialised,
  onDispersionDetach,
  handlePageChange,
  handleRowClick,
  handleMaterialize,
  setCombinedPage,
}) => {
  const { nodeId: actualNodeId, paginationKey, requestNodeId, column } = context;
  const detachNodeId = actualNodeId || (labelToNodeId?.[nodeKey] ?? requestNodeId);
  const canDetach = Boolean(detachNodeId) && detachNodeId !== '__COMBINED__';

  // Per-matched-text totals + selection-scoped sub-totals, published up
  // from the active ``ConcordanceDispersionSummary`` so the standalone
  // legend (kept above the chart for visual continuity with the
  // proportional-bars table) can show ``(n)`` or ``(m/n)`` next to each
  // label. A single state slot is enough because only one branch
  // (combined vs per-node) mounts a Summary per render.
  const [legendCounts, setLegendCounts] = useState<{
    totals: ReadonlyMap<string, number>;
    selectedTotals: ReadonlyMap<string, number> | null;
  }>(() => ({ totals: new Map<string, number>(), selectedTotals: null }));
  // Stable callback so React.memo'd children (and the publishing
  // useEffect inside Summary) don't re-fire on unrelated re-renders.
  const handleLegendCountsChange = useCallback(
    (counts: {
      totals: ReadonlyMap<string, number>;
      selectedTotals: ReadonlyMap<string, number> | null;
    }) => {
      setLegendCounts(counts);
    },
    [],
  );

  if (nodeKey === '__COMBINED__') {
    const groupedRows = nodeData.data;
    const rows = buildDispersionRows(groupedRows);
    const longestTextLength = proportionalDispersionBars
      ? rows.reduce((max, row) => Math.max(max, getDispersionTextLength(row, column)), 0)
      : 0;
    const combinedHasPrev = Boolean(nodeData.pagination?.has_prev);
    const combinedHasNext = Boolean(nodeData.pagination?.has_next);
    const metaCols = nodeData.metadata.metadata_columns;
    const visibleMetaCols = (selectedMetadataColumns ?? []).filter((columnName) => metaCols.includes(columnName));
    const rawDisplayColumns = showMetadata
      ? [CONCORDANCE_DISPERSION_COLUMN, ...visibleMetaCols]
      : [CONCORDANCE_DISPERSION_COLUMN];
    const displayColumns = dedupeColumns(rawDisplayColumns);
    const dispersionColumnStyle = getDispersionColumnStyle(showMetadata, resultsViewportWidth);
    const metadataColumnStyle = getMetadataColumnStyle(showMetadata);

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
            {(() => {
              const combinedSelection =
                (selectedBinIndices['__COMBINED__'] as ReadonlySet<number> | undefined) ??
                EMPTY_BIN_SELECTION;
              const combinedMaterialisedBins = getMaterializedBinsForKey('__COMBINED__');
              const combinedHasSelection = combinedSelection.size > 0;
              const combinedScopeMismatch =
                combinedHasSelection && !combinedMaterialisedBins;
              const visibleMatchedTexts = colourMatches
                ? allMatchedTexts.filter((t) => !hiddenMatchedTexts.has(t))
                : null;
              const allLegendHidden =
                visibleMatchedTexts !== null
                && allMatchedTexts.length > 0
                && visibleMatchedTexts.length === 0;
              const combinedDetachDisabled =
                combinedLoading
                || !searchWord.trim()
                || combinedNodeIds.length === 0
                || combinedScopeMismatch
                || allLegendHidden;
              const combinedDetachTitle = combinedScopeMismatch
                ? 'Materialise the corpus first (Process Both) to safely apply this bin selection across all source documents.'
                : allLegendHidden
                  ? 'All matched terms are hidden in the legend. Re-enable at least one to detach.'
                  : combinedHasSelection
                    ? 'Add a per-document aggregation of the selected bin hits to the workspace'
                    : 'Add a per-document aggregation of all hits to the workspace';
              return (
                <Button
                  onClick={() => {
                    if (combinedNodeIds.length === 0 || !searchWord.trim()) return;
                    const nodes = combinedNodeIds
                      .map((nid) => {
                        const col = effectiveNodeColumnSelections.find(
                          (s) => s.nodeId === nid,
                        )?.column;
                        if (!col) return null;
                        const sourceNode = panelSelectedNodes.find(
                          (node, idx) => getNodeIdentifier(node, idx) === nid,
                        );
                        const label =
                          (sourceNode?.name || sourceNode?.id || nid) as string;
                        return { nodeId: nid, column: col, nodeLabel: label };
                      })
                      .filter(
                        (
                          n,
                        ): n is { nodeId: string; column: string; nodeLabel: string } =>
                          n !== null,
                      );
                    void onDispersionDetach(nodes, combinedSelection, binCount, {
                      selectedMatchedTexts: visibleMatchedTexts,
                      matchCaseInsensitive: lowercaseMatches,
                    });
                  }}
                  disabled={combinedDetachDisabled}
                  size="sm"
                  className="h-auto max-w-full whitespace-normal wrap-break-word py-1.5 text-left"
                  title={combinedDetachTitle}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add to Workspace
                  {combinedHasSelection ? ` (${combinedSelection.size} bin${combinedSelection.size === 1 ? '' : 's'})` : ''}
                </Button>
              );
            })()}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card">
          <AnalysisTableScrollArea maxHeightClass="max-h-100">
            <Table className="w-full" disableContainer>
              <TableHeader className="bg-gray-50 sticky top-0 z-10">
                <TableRow>
                  {displayColumns.map((c: string) => (
                    <TableHead
                      key={c}
                      className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                      style={c === CONCORDANCE_DISPERSION_COLUMN ? dispersionColumnStyle : metadataColumnStyle}
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
                      const entry = Object.entries(sourceColorMap).find(([k]) => k.includes(normalized));
                      color = entry ? entry[1] : undefined;
                    }
                    if (!color) {
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
                          const hits = getDispersionHits(row);
                          const sourceHit = hits[0];
                          const sourceLabel = sourceHit?.__source_node ?? rawSrc;
                          if (sourceLabel) {
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
                              return candidates.includes(String(sourceLabel).toLowerCase());
                            });
                            const sel = nodeObj && effectiveNodeColumnSelections.find((s) => s.nodeId === nodeObj.id);
                            if (nodeObj && sel?.column) {
                              handleRowClick(row, String(nodeObj.id ?? ''), sel.column, hits);
                            }
                          }
                        }}
                      >
                        {displayColumns.map((c: string, i: number) => (
                          <TableCell key={i} style={c === CONCORDANCE_DISPERSION_COLUMN ? dispersionColumnStyle : metadataColumnStyle}>
                            {c === CONCORDANCE_DISPERSION_COLUMN ? (
                              <ConcordanceDispersionCell
                                hits={getDispersionHits(row)}
                                textLength={getDispersionTextLength(row, column)}
                                barWidthPercent={proportionalDispersionBars
                                  ? getDispersionBarWidthPercent(row, column, longestTextLength)
                                  : 100}
                                colourMatches={colourMatches}
                                matchedTextColors={matchedTextColorMap}
                                lowercaseMatches={lowercaseMatches}
                                hiddenMatchedTexts={hiddenMatchedTexts}
                              />
                            ) : row[c] !== undefined && row[c] !== null ? String(row[c]) : ''}
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
            // Page-size summary is rendered ABOVE the pagination row so the
            // "Found N instances in M documents..." line doesn't have to
            // compete for horizontal space with the page-size selector and
            // the page buttons.
            const summary = nodeData.materialized
              ? (Object.keys(materializeSummaries).length > 0
                ? <GroupedResultsPageSizeSummary
                    groups={[]}
                    totalInstances={Object.values(materializeSummaries).reduce((sum, s) => sum + s.recordCount, 0)}
                    totalDocuments={Object.values(materializeSummaries).reduce((sum, s) => sum + s.uniqueDocuments, 0)}
                    totalProcessed={Object.values(materializeSummaries).reduce((sum, s) => sum + s.totalDocuments, 0)}
                  />
                : null)
              : <GroupedResultsPageSizeSummary groups={nodeData.data} totalProcessed={batchProcessedCount(nodeData.pagination)} />;
            return summary ? (
              <div className="border-t border-border bg-muted/40 px-4 pt-2 text-sm text-muted-foreground">
                {summary}
              </div>
            ) : null;
          })()}
          <AnalysisPagination
            page={combinedPage}
            pageSize={globalPageSize}
            hasNext={combinedHasNext}
            hasPrev={combinedHasPrev}
            totalPages={nodeData.pagination?.total_source_pages}
            onPageChange={(newPage) => setCombinedPage(newPage)}
            loading={combinedLoading}
          />
          {colourMatches && allMatchedTexts.length > 0 && (
            <ConcordanceDispersionLegend
              matchedTexts={allMatchedTexts}
              matchedTextColors={matchedTextColorMap}
              hiddenMatchedTexts={hiddenMatchedTexts}
              onToggle={(text) => {
                setHiddenMatchedTexts((prev) => {
                  const next = new Set(prev);
                  if (next.has(text)) next.delete(text);
                  else next.add(text);
                  return next;
                });
              }}
              totals={legendCounts.totals}
              selectedTotals={legendCounts.selectedTotals}
            />
          )}
          {!proportionalDispersionBars && (() => {
            const dispersionRows = rows as ConcordanceDispersionRow[];
            const sourceNames = panelSelectedNodes.map((n) => n.name).filter(Boolean) as string[];
            const dataBlockLabel = sourceNames.length > 0 ? sourceNames.join(', ') : 'Combined';
            const materialisedBins = getMaterializedBinsForKey('__COMBINED__');
            const materialised = isBlockMaterialised('__COMBINED__');
            return (
              <ConcordanceDispersionSummary
                rows={dispersionRows}
                textColumn={column}
                binCount={binCount}
                lowercaseMatches={lowercaseMatches}
                splitBySource={combinedSourceMode === 'split'}
                allMatchedTexts={allMatchedTexts}
                matchedTextColors={matchedTextColorMap}
                hiddenMatchedTexts={hiddenMatchedTexts}
                dataBlockLabel={dataBlockLabel}
                searchWord={searchWord}
                materialisedBins={materialisedBins}
                materialised={materialised}
                aggregateAll={!colourMatches}
                chartType={dispersionChartType}
                onChartTypeChange={onDispersionChartTypeChange}
                onBinCountChange={onBinCountChange}
                selection={{
                  selectedIndices:
                    (selectedBinIndices['__COMBINED__'] as ReadonlySet<number> | undefined) ??
                    EMPTY_BIN_SELECTION,
                  onSelect: (index, shiftHeld) =>
                    onBinSelect('__COMBINED__', index, shiftHeld),
                  onClear: () => onClearBinSelection('__COMBINED__'),
                }}
                onLegendCountsChange={handleLegendCountsChange}
              />
            );
          })()}
        </div>
      </div>
    );
  }

  // Per-node dispersion rendering (document-aggregated rows).
  const groupedRows = nodeData.data;
  const rows = buildDispersionRows(groupedRows);
  const longestTextLength = proportionalDispersionBars
    ? rows.reduce((max, row) => Math.max(max, getDispersionTextLength(row, column)), 0)
    : 0;
  const allCols = nodeData.columns;
  const metaCols = nodeData.metadata.metadata_columns;
  const visibleMetaCols = (selectedMetadataColumns ?? []).filter((columnName) => metaCols.includes(columnName));
  const rawDisplayColumns = showMetadata
    ? [CONCORDANCE_DISPERSION_COLUMN, ...visibleMetaCols.filter((c) => allCols.includes(c))]
    : [CONCORDANCE_DISPERSION_COLUMN];
  const displayColumns = dedupeColumns(rawDisplayColumns);
  const tableColumns = displayColumns.length > 0 ? displayColumns : allCols;
  const dispersionColumnStyle = getDispersionColumnStyle(showMetadata, resultsViewportWidth);
  const metadataColumnStyle = getMetadataColumnStyle(showMetadata);

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
          <Table className="w-full" disableContainer>
            <TableHeader className="bg-gray-50 sticky top-0 z-10">
              <TableRow>
                {tableColumns.map((key) => (
                  <TableHead
                    key={key}
                    className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                    style={key === CONCORDANCE_DISPERSION_COLUMN ? dispersionColumnStyle : metadataColumnStyle}
                  >
                    {key}
                  </TableHead>
                ))}
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
                      handleRowClick(
                        row,
                        actualNodeId || requestNodeId,
                        column,
                        getDispersionHits(row),
                      );
                    }}
                  >
                    {tableColumns.map((colKey: string, cellIndex) => (
                      <TableCell key={cellIndex} style={colKey === CONCORDANCE_DISPERSION_COLUMN ? dispersionColumnStyle : metadataColumnStyle}>
                        {colKey === CONCORDANCE_DISPERSION_COLUMN ? (
                          <ConcordanceDispersionCell
                            hits={getDispersionHits(row)}
                            textLength={getDispersionTextLength(row, column)}
                            barWidthPercent={proportionalDispersionBars
                              ? getDispersionBarWidthPercent(row, column, longestTextLength)
                              : 100}
                            colourMatches={colourMatches}
                            matchedTextColors={matchedTextColorMap}
                            lowercaseMatches={lowercaseMatches}
                            hiddenMatchedTexts={hiddenMatchedTexts}
                          />
                        ) : row[colKey] !== null && row[colKey] !== undefined ? String(row[colKey]) : ''}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </AnalysisTableScrollArea>
      </div>

      {(() => {
        const summary = nodeData.materialized && detachNodeId && materializeSummaries[detachNodeId]
          ? <GroupedResultsPageSizeSummary
              groups={[]}
              totalInstances={materializeSummaries[detachNodeId].recordCount}
              totalDocuments={materializeSummaries[detachNodeId].uniqueDocuments}
              totalProcessed={materializeSummaries[detachNodeId].totalDocuments}
            />
          : (nodeData.materialized
            ? null
            : <GroupedResultsPageSizeSummary groups={nodeData.data} totalProcessed={batchProcessedCount(nodeData.pagination)} />);
        return summary ? (
          <div className="border-t border-border bg-muted/40 px-4 pt-2 text-sm text-muted-foreground">
            {summary}
          </div>
        ) : null;
      })()}
      <AnalysisPagination
        page={currentPage}
        pageSize={nodePagination[paginationKey]?.pageSize ?? globalPageSize}
        hasNext={hasNext}
        hasPrev={hasPrev}
        totalPages={nodeData.pagination?.total_source_pages}
        onPageChange={(newPage) => handlePageChange(newPage, paginationKey, requestNodeId)}
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
        {(() => {
          const nodeSelection =
            (selectedBinIndices[nodeKey] as ReadonlySet<number> | undefined) ??
            EMPTY_BIN_SELECTION;
          const nodeMaterialisedBins = getMaterializedBinsForKey(nodeKey);
          const nodeHasSelection = nodeSelection.size > 0;
          const nodeScopeMismatch =
            nodeHasSelection && !nodeMaterialisedBins;
          const visibleMatchedTexts = colourMatches
            ? allMatchedTexts.filter((t) => !hiddenMatchedTexts.has(t))
            : null;
          const allLegendHidden =
            visibleMatchedTexts !== null
            && allMatchedTexts.length > 0
            && visibleMatchedTexts.length === 0;
          const nodeDetachDisabled =
            nodeIsLoading
            || isDetaching
            || !searchWord.trim()
            || !canDetach
            || !detachNodeId
            || nodeScopeMismatch
            || allLegendHidden;
          const nodeDetachTitle = nodeScopeMismatch
            ? 'Materialise the corpus first (Process All) to safely apply this bin selection across all documents.'
            : allLegendHidden
              ? 'All matched terms are hidden in the legend. Re-enable at least one to detach.'
              : nodeHasSelection
                ? 'Add a per-document aggregation of the selected bin hits to the workspace'
                : 'Add a per-document aggregation of all hits to the workspace';
          return (
            <Button
              onClick={() => {
                if (!detachNodeId) return;
                const detachNode = panelSelectedNodes.find((n) => n.id === detachNodeId);
                const label = (detachNode?.name || nodeKey) as string;
                void onDispersionDetach(
                  [{ nodeId: detachNodeId, column, nodeLabel: label }],
                  nodeSelection,
                  binCount,
                  {
                    selectedMatchedTexts: visibleMatchedTexts,
                    matchCaseInsensitive: lowercaseMatches,
                  },
                );
              }}
              disabled={nodeDetachDisabled}
              size="sm"
              className="h-auto max-w-full whitespace-normal wrap-break-word py-1.5 text-left"
              title={nodeDetachTitle}
            >
              {isDetaching ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Adding to Workspace...</>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Add to Workspace
                  {nodeHasSelection ? ` (${nodeSelection.size} bin${nodeSelection.size === 1 ? '' : 's'})` : ''}
                </>
              )}
            </Button>
          );
        })()}
      </AnalysisPagination>
      {colourMatches && allMatchedTexts.length > 0 && (
        <ConcordanceDispersionLegend
          matchedTexts={allMatchedTexts}
          matchedTextColors={matchedTextColorMap}
          hiddenMatchedTexts={hiddenMatchedTexts}
          onToggle={(text) => {
            setHiddenMatchedTexts((prev) => {
              const next = new Set(prev);
              if (next.has(text)) next.delete(text);
              else next.add(text);
              return next;
            });
          }}
          totals={legendCounts.totals}
          selectedTotals={legendCounts.selectedTotals}
        />
      )}
      {!proportionalDispersionBars && (() => {
        const dispersionRows = rows as ConcordanceDispersionRow[];
        const dataBlockLabel = context.displayName || nodeKey;
        const materialisedBins = getMaterializedBinsForKey(nodeKey);
        const materialised = isBlockMaterialised(nodeKey);
        return (
          <ConcordanceDispersionSummary
            rows={dispersionRows}
            textColumn={column}
            binCount={binCount}
            lowercaseMatches={lowercaseMatches}
            splitBySource={false}
            allMatchedTexts={allMatchedTexts}
            matchedTextColors={matchedTextColorMap}
            hiddenMatchedTexts={hiddenMatchedTexts}
            dataBlockLabel={dataBlockLabel}
            searchWord={searchWord}
            materialisedBins={materialisedBins}
            materialised={materialised}
            aggregateAll={!colourMatches}
            chartType={dispersionChartType}
            onChartTypeChange={onDispersionChartTypeChange}
            onBinCountChange={onBinCountChange}
            selection={{
              selectedIndices:
                (selectedBinIndices[nodeKey] as ReadonlySet<number> | undefined) ??
                EMPTY_BIN_SELECTION,
              onSelect: (index, shiftHeld) => onBinSelect(nodeKey, index, shiftHeld),
              onClear: () => onClearBinSelection(nodeKey),
            }}
            onLegendCountsChange={handleLegendCountsChange}
          />
        );
      })()}
    </div>
  );
};
