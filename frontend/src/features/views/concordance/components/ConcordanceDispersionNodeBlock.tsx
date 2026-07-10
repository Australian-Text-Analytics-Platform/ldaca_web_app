import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { Loader2, Plus } from 'lucide-react';
import type { ConcordanceNodeResult as ConcordanceResultEntry, WorkspaceGraphNode } from '@/api';
import type { ColumnDef } from '@tanstack/react-table';
import { AnalysisTableFrame } from '@/features/views/common/components/AnalysisTableScrollArea';
import { ServerPaginationFooter } from '@/features/views/common/components/ServerPaginationFooter';
import { useServerTable } from '@/features/views/common/hooks/useServerTable';
import { GroupedResultsPageSizeSummary } from '../../common/components/GroupedResultsPageSizeSummary';
import { PAGE_SIZE_OPTIONS_DEFAULT } from '../../common/constants';
import { takeMostRecent } from '@/features/workspace/common/utils/selectionUtils';
import type { NodeColumnSelection } from '../../common';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import type { PaginationState } from '../hooks/useConcordanceTaskFlow';
import {
  CONCORDANCE_COMBINED_NODE_KEY,
  batchProcessedCount,
  findConcordanceSourceNode,
  getDispersionHits,
  getConcordanceSourceColor,
  type ConcordanceDispersionChartMode,
  type DispersionDisplayBinCount,
  type TaggedBinRow,
} from '../concordanceViewModels';
import { ConcordanceDispersionLegend } from './ConcordanceDispersionLegend';
import { ConcordanceDispersionSummary } from './ConcordanceDispersionSummary';
import { ConcordanceDispersionRowsTable } from './ConcordanceDispersionRowsTable';
import { buildConcordanceDispersionTableModel } from './concordanceDispersionTableModel';
import {
  buildDispersionDetachActionState,
  toggleHiddenMatchedText,
} from './concordanceDispersionActions';

type ConcordanceGroupedRow = Record<string, unknown>[];

const EMPTY_BIN_SELECTION: ReadonlySet<number> = new Set<number>();

// Stable empty references so the footer-only TanStack table never rebuilds its
// row model: the dispersion bins body renders manually; this table instance
// exists purely to drive ServerPaginationFooter's page math from rowCount
// (which walks SOURCE documents, not displayed bin rows).
const EMPTY_DISPERSION_ROWS: Record<string, unknown>[] = [];
const EMPTY_DISPERSION_COLUMNS: ColumnDef<Record<string, unknown>>[] = [];

export interface ConcordanceDispersionNodeBlockProps {
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
  selectedNodes: WorkspaceGraphNode[];
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
  nodeDetaching: Record<string, boolean>;
  nodeMaterializing: Record<string, boolean>;
  materializedPaths: Record<string, string>;
  materializeSummaries: Record<
    string,
    { recordCount: number; uniqueDocuments: number; totalDocuments: number }
  >;

  // Dispersion-specific state
  proportionalDispersionBars: boolean;
  colourMatches: boolean;
  lowercaseMatches: boolean;
  hiddenMatchedTexts: Set<string>;
  setHiddenMatchedTexts: React.Dispatch<React.SetStateAction<Set<string>>>;
  binCount: DispersionDisplayBinCount;
  onBinCountChange: (value: DispersionDisplayBinCount) => void;
  combinedSourceMode: 'aggregate' | 'split';
  dispersionChartMode: ConcordanceDispersionChartMode;
  onDispersionChartModeChange: (value: ConcordanceDispersionChartMode) => void;
  selectedBinIndices: Record<string, Set<number>>;
  onBinSelect: (blockKey: string, index: number, shiftHeld: boolean) => void;
  onBinRangeSelect: (
    blockKey: string,
    startIndex: number,
    endIndex: number,
    shiftHeld: boolean,
  ) => void;
  onClearBinSelection: (blockKey: string) => void;
  allMatchedTexts: string[];
  matchedTextColorMap: Record<string, string>;
  getMaterializedBinsForKey: (nodeKey: string) => TaggedBinRow[] | undefined;
  isBlockMaterialised: (nodeKey: string) => boolean;
  onDispersionDetach: (
    nodes: { nodeId: string; column: string; nodeLabel: string }[],
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
}

/**
 * Rendered by: ConcordanceResultsPanel for each concordance dispersion result block because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * Flow: derive display state, bind user actions, then render the analysis UI.
 */
export function ConcordanceDispersionNodeBlock({
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
  sourceColorMap,
  defaultPalette,
  nodePagination,
  globalPageSize,
  onPageSizeChange,
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
  dispersionChartMode,
  onDispersionChartModeChange,
  selectedBinIndices,
  onBinSelect,
  onBinRangeSelect,
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
}: ConcordanceDispersionNodeBlockProps) {
  const { nodeId: actualNodeId, paginationKey, requestNodeId, column } = context;
  const detachNodeId = actualNodeId;
  const canDetach = Boolean(detachNodeId) && detachNodeId !== CONCORDANCE_COMBINED_NODE_KEY;

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

  // Footer-only TanStack instance shared by both branches (only one mounts per
  // keyed instance). Called unconditionally to respect the rules of hooks; the
  // bins body still renders manually below. rowCount = total source documents.
  const isCombinedView = nodeKey === CONCORDANCE_COMBINED_NODE_KEY;
  const activePage = isCombinedView
    ? combinedPage
    : (nodePagination[paginationKey]?.currentPage ?? 1);
  const paginationTable = useServerTable<Record<string, unknown>>({
    data: EMPTY_DISPERSION_ROWS,
    columns: EMPTY_DISPERSION_COLUMNS,
    rowCount: nodeData.pagination.total_source_rows,
    pageIndex: activePage - 1,
    pageSize: globalPageSize,
    onPaginationChange: (next) => {
      if (next.pageSize !== globalPageSize) {
        onPageSizeChange(next.pageSize);
        return;
      }
      const newPage = next.pageIndex + 1;
      if (newPage === activePage) return;
      if (isCombinedView) setCombinedPage(newPage);
      else handlePageChange(newPage, paginationKey, requestNodeId);
    },
  });

  if (nodeKey === CONCORDANCE_COMBINED_NODE_KEY) {
    const { rows, longestTextLength, tableColumns, dispersionColumnStyle, metadataColumnStyle } =
      buildConcordanceDispersionTableModel({
        nodeData,
        textColumn: column,
        showMetadata,
        selectedMetadataColumns,
        resultsViewportWidth,
        proportionalDispersionBars,
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
          table={paginationTable}
          pageIndex={activePage - 1}
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
      <div key={CONCORDANCE_COMBINED_NODE_KEY} className="mb-6">
        <div className="flex items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Combined Results</h3>
          <div className="ml-auto flex items-center space-x-2">
            <span className="text-xs text-gray-500">Rows colored by source data block</span>
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
                isAnyCombinedMaterializing ||
                allCombinedMaterialized ||
                !searchWord.trim() ||
                combinedNodeIds.length === 0
              }
              size="sm"
              variant="outline"
              className="h-auto max-w-full whitespace-normal wrap-break-word py-1.5 text-left"
              title="Cache all occurrence rows for both data blocks so subsequent pagination and Add-to-Workspace reuse them"
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
            {(() => {
              const combinedSelection =
                (selectedBinIndices[CONCORDANCE_COMBINED_NODE_KEY] as
                  | ReadonlySet<number>
                  | undefined) ?? EMPTY_BIN_SELECTION;
              const combinedMaterialisedBins = getMaterializedBinsForKey(
                CONCORDANCE_COMBINED_NODE_KEY,
              );
              const combinedHasSelection = combinedSelection.size > 0;
              const detachAction = buildDispersionDetachActionState({
                isBusy: combinedLoading,
                hasSearchWord: Boolean(searchWord.trim()),
                hasDetachTarget: combinedNodeIds.length > 0,
                hasSelection: combinedHasSelection,
                hasMaterializedBins: Boolean(combinedMaterialisedBins),
                colourMatches,
                allMatchedTexts,
                hiddenMatchedTexts,
                materializeSelectionHint:
                  'Materialise the corpus first (Process Both) to safely apply this bin selection across all source documents.',
                selectedBinsHint:
                  'Add a per-document aggregation of the selected bin hits to the workspace',
                allHitsHint: 'Add a per-document aggregation of all hits to the workspace',
              });
              return (
                <DisabledReasonTooltip
                  reason={detachAction.disabled ? detachAction.title : undefined}
                >
                  <Button
                    onClick={() => {
                      if (combinedNodeIds.length === 0 || !searchWord.trim()) return;
                      const nodes = combinedNodeIds
                        .map((nid) => {
                          const col = effectiveNodeColumnSelections.find(
                            (s) => s.nodeId === nid,
                          )?.column;
                          if (!col) return null;
                          const sourceNode = panelSelectedNodes.find((node) => node.id === nid);
                          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty-string name/id must fall back to the next identifier
                          const label = sourceNode?.name || sourceNode?.id || nid;
                          return { nodeId: nid, column: col, nodeLabel: label };
                        })
                        .filter(
                          (n): n is { nodeId: string; column: string; nodeLabel: string } =>
                            n !== null,
                        );
                      void onDispersionDetach(nodes, combinedSelection, binCount, {
                        selectedMatchedTexts: detachAction.visibleMatchedTexts,
                        matchCaseInsensitive: lowercaseMatches,
                      });
                    }}
                    disabled={detachAction.disabled}
                    size="sm"
                    className="h-auto max-w-full whitespace-normal wrap-break-word py-1.5 text-left"
                    title={detachAction.disabled ? undefined : detachAction.title}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add to Workspace
                    {combinedHasSelection
                      ? ` (${String(combinedSelection.size)} bin${combinedSelection.size === 1 ? '' : 's'})`
                      : ''}
                  </Button>
                </DisabledReasonTooltip>
              );
            })()}
          </div>
        </div>
        <AnalysisTableFrame maxHeightClass="max-h-100" belowTable={combinedBelowTable}>
          <ConcordanceDispersionRowsTable
            rows={rows}
            tableColumns={tableColumns}
            searchWord={searchWord}
            textColumn={column}
            longestTextLength={longestTextLength}
            dispersionColumnStyle={dispersionColumnStyle}
            metadataColumnStyle={metadataColumnStyle}
            proportionalDispersionBars={proportionalDispersionBars}
            colourMatches={colourMatches}
            matchedTextColorMap={matchedTextColorMap}
            lowercaseMatches={lowercaseMatches}
            hiddenMatchedTexts={hiddenMatchedTexts}
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
              const hits = getDispersionHits(row);
              const sourceHit = hits[0];
              const sourceLabel = sourceHit?.__source_node ?? row.__source_node;
              if (!sourceLabel) return;
              const nodeObj = findConcordanceSourceNode(panelSelectedNodes, sourceLabel);
              const sel =
                nodeObj && effectiveNodeColumnSelections.find((s) => s.nodeId === nodeObj.id);
              if (nodeObj && sel?.column) {
                handleRowClick(row, nodeObj.id, sel.column, hits);
              }
            }}
          />
        </AnalysisTableFrame>
        {colourMatches && allMatchedTexts.length > 0 && (
          <ConcordanceDispersionLegend
            matchedTexts={allMatchedTexts}
            matchedTextColors={matchedTextColorMap}
            hiddenMatchedTexts={hiddenMatchedTexts}
            onToggle={(text) => {
              setHiddenMatchedTexts((prev) => toggleHiddenMatchedText(prev, text));
            }}
            totals={legendCounts.totals}
            selectedTotals={legendCounts.selectedTotals}
          />
        )}
        {!proportionalDispersionBars &&
          (() => {
            const dispersionRows = rows;
            const sourceNames = panelSelectedNodes.map((n) => n.name).filter(Boolean);
            const dataBlockLabel = sourceNames.length > 0 ? sourceNames.join(', ') : 'Combined';
            const materialisedBins = getMaterializedBinsForKey(CONCORDANCE_COMBINED_NODE_KEY);
            const materialised = isBlockMaterialised(CONCORDANCE_COMBINED_NODE_KEY);
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
                sourceColors={sourceColorMap}
                chartMode={dispersionChartMode}
                onChartModeChange={onDispersionChartModeChange}
                onBinCountChange={onBinCountChange}
                selection={{
                  selectedIndices:
                    (selectedBinIndices[CONCORDANCE_COMBINED_NODE_KEY] as
                      | ReadonlySet<number>
                      | undefined) ?? EMPTY_BIN_SELECTION,
                  /** Used by: ConcordanceDispersionSummary selection prop to route combined chart bin selection. */
                  onSelect: (index, shiftHeld) => {
                    onBinSelect(CONCORDANCE_COMBINED_NODE_KEY, index, shiftHeld);
                  },
                  /** Used by: ConcordanceDispersionSummary selection prop to route combined chart drag ranges because callers need one state update for the full selected bin span. */
                  onSelectRange: (startIndex, endIndex, shiftHeld) => {
                    onBinRangeSelect(
                      CONCORDANCE_COMBINED_NODE_KEY,
                      startIndex,
                      endIndex,
                      shiftHeld,
                    );
                  },
                  /** Used by: ConcordanceDispersionSummary selection prop to clear combined transient bin selection. */
                  onClear: () => {
                    onClearBinSelection(CONCORDANCE_COMBINED_NODE_KEY);
                  },
                }}
                onLegendCountsChange={setLegendCounts}
              />
            );
          })()}
      </div>
    );
  }

  // Per-node dispersion rendering (document-aggregated rows).
  const { rows, longestTextLength, tableColumns, dispersionColumnStyle, metadataColumnStyle } =
    buildConcordanceDispersionTableModel({
      nodeData,
      textColumn: column,
      showMetadata,
      selectedMetadataColumns,
      resultsViewportWidth,
      proportionalDispersionBars,
      fallbackToAllColumns: true,
    });

  const nodeIsLoading = Boolean(nodeLoading[paginationKey]);

  const detachingKey = detachNodeId;
  const isDetaching = detachingKey ? Boolean(nodeDetaching[detachingKey]) : false;

  // Two side-by-side data blocks share one synced page size, so processing only
  // one would leave the tables on mismatched units (instances/page vs
  // documents/page). The Process button therefore materialises every selected
  // block together; with a single block it processes just that node.
  // Used by: the per-node ServerPaginationFooter below.
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
  // Mirror the table block's fallback: prefer the per-node materialised
  // summary when available, otherwise count from ``nodeData.data`` +
  // pagination so separated dispersion view count lines still render before
  // materialization completes.
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
        table={paginationTable}
        pageIndex={activePage - 1}
        pageSize={globalPageSize}
        rowCount={nodeData.pagination.total_source_rows}
        pageSizeLabel="Documents per batch"
        pageSizeOptions={[...PAGE_SIZE_OPTIONS_DEFAULT]}
        loading={nodeIsLoading}
        showPageSize
      >
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
            isMultiBlock
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
        {(() => {
          const nodeSelection =
            (selectedBinIndices[nodeKey] as ReadonlySet<number> | undefined) ?? EMPTY_BIN_SELECTION;
          const nodeMaterialisedBins = getMaterializedBinsForKey(nodeKey);
          const nodeHasSelection = nodeSelection.size > 0;
          const detachAction = buildDispersionDetachActionState({
            isBusy: nodeIsLoading || isDetaching,
            hasSearchWord: Boolean(searchWord.trim()),
            hasDetachTarget: canDetach && Boolean(detachNodeId),
            hasSelection: nodeHasSelection,
            hasMaterializedBins: Boolean(nodeMaterialisedBins),
            colourMatches,
            allMatchedTexts,
            hiddenMatchedTexts,
            materializeSelectionHint: `Materialise the corpus first (${isMultiBlock ? 'Process Both Blocks' : 'Process All'}) to safely apply this bin selection across all documents.`,
            selectedBinsHint:
              'Add a per-document aggregation of the selected bin hits to the workspace',
            allHitsHint: 'Add a per-document aggregation of all hits to the workspace',
          });
          return (
            <DisabledReasonTooltip reason={detachAction.disabled ? detachAction.title : undefined}>
              <Button
                onClick={() => {
                  if (!detachNodeId) return;
                  const detachNode = panelSelectedNodes.find((n) => n.id === detachNodeId);
                  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty-string node name must fall back to the node key
                  const label = detachNode?.name || nodeKey;
                  void onDispersionDetach(
                    [{ nodeId: detachNodeId, column, nodeLabel: label }],
                    nodeSelection,
                    binCount,
                    {
                      selectedMatchedTexts: detachAction.visibleMatchedTexts,
                      matchCaseInsensitive: lowercaseMatches,
                    },
                  );
                }}
                disabled={detachAction.disabled}
                size="sm"
                className="h-auto max-w-full whitespace-normal wrap-break-word py-1.5 text-left"
                title={detachAction.disabled ? undefined : detachAction.title}
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
                    {nodeHasSelection
                      ? ` (${String(nodeSelection.size)} bin${nodeSelection.size === 1 ? '' : 's'})`
                      : ''}
                  </>
                )}
              </Button>
            </DisabledReasonTooltip>
          );
        })()}
      </ServerPaginationFooter>
    </>
  );

  return (
    <div key={nodeKey} className="mb-6">
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
        <ConcordanceDispersionRowsTable
          rows={rows}
          tableColumns={tableColumns}
          searchWord={searchWord}
          textColumn={column}
          longestTextLength={longestTextLength}
          dispersionColumnStyle={dispersionColumnStyle}
          metadataColumnStyle={metadataColumnStyle}
          proportionalDispersionBars={proportionalDispersionBars}
          colourMatches={colourMatches}
          matchedTextColorMap={matchedTextColorMap}
          lowercaseMatches={lowercaseMatches}
          hiddenMatchedTexts={hiddenMatchedTexts}
          getRowClassName={(_row, index) =>
            `cursor-pointer ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`
          }
          onRowClick={(row) => {
            if (actualNodeId && column) {
              handleRowClick(row, actualNodeId, column, getDispersionHits(row));
            }
          }}
        />
      </AnalysisTableFrame>
      {colourMatches && allMatchedTexts.length > 0 && (
        <ConcordanceDispersionLegend
          matchedTexts={allMatchedTexts}
          matchedTextColors={matchedTextColorMap}
          hiddenMatchedTexts={hiddenMatchedTexts}
          onToggle={(text) => {
            setHiddenMatchedTexts((prev) => toggleHiddenMatchedText(prev, text));
          }}
          totals={legendCounts.totals}
          selectedTotals={legendCounts.selectedTotals}
        />
      )}
      {!proportionalDispersionBars &&
        (() => {
          const dispersionRows = rows;
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty-string display name must fall back to the node key
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
              sourceColor={context.nodeColor}
              chartMode={dispersionChartMode}
              onChartModeChange={onDispersionChartModeChange}
              onBinCountChange={onBinCountChange}
              selection={{
                selectedIndices:
                  (selectedBinIndices[nodeKey] as ReadonlySet<number> | undefined) ??
                  EMPTY_BIN_SELECTION,
                /** Used by: ConcordanceDispersionSummary selection prop to route per-node chart bin selection. */
                onSelect: (index, shiftHeld) => {
                  onBinSelect(nodeKey, index, shiftHeld);
                },
                /** Used by: ConcordanceDispersionSummary selection prop to route per-node chart drag ranges because callers need one state update for the full selected bin span. */
                onSelectRange: (startIndex, endIndex, shiftHeld) => {
                  onBinRangeSelect(nodeKey, startIndex, endIndex, shiftHeld);
                },
                /** Used by: ConcordanceDispersionSummary selection prop to clear the active node's bin selection. */
                onClear: () => {
                  onClearBinSelection(nodeKey);
                },
              }}
              onLegendCountsChange={setLegendCounts}
            />
          );
        })()}
    </div>
  );
}
