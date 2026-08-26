import { useEffect, useRef } from 'react';
import type { ConcordanceNodeResult as ConcordanceResultEntry } from '@/api';
import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { AnalysisTableFrame } from '@/features/views/common/components/AnalysisTableScrollArea';
import { ServerPaginationFooter } from '@/features/views/common/components/ServerPaginationFooter';
import { type ServerColumnDef, useServerTable } from '@/features/views/common/hooks/useServerTable';
import { GroupedResultsPageSizeSummary } from '../../common/components/GroupedResultsPageSizeSummary';
import { PAGE_SIZE_OPTIONS_DEFAULT } from '../../common/constants';
import type { NodeColumnSelection } from '../../common/nodeSelectionTypes';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import type { PaginationState } from '../hooks/useConcordanceTaskFlow';
import {
  batchProcessedCount,
  getDispersionHits,
  type ConcordanceDispersionChartMode,
  type DispersionDisplayBinCount,
  type ConcordanceDensitySeriesInput,
} from '../concordanceDispersionDomain';
import { findConcordanceSourceNode, getConcordanceSourceColor } from '../concordanceSourceDomain';
import { CONCORDANCE_COMBINED_NODE_KEY } from '../concordanceTableDomain';
import { ConcordanceDispersionSummary } from './ConcordanceDispersionSummary';
import { ConcordanceDispersionRowsTable } from './ConcordanceDispersionRowsTable';
import {
  ConcordanceCombinedResultHeader,
  ConcordanceSourceResultHeader,
} from './ConcordanceResultCardHeader';
import { buildConcordanceDispersionTableModel } from './concordanceDispersionTableModel';
type ConcordanceGroupedRow = Record<string, unknown>[];

const EMPTY_BIN_SELECTION: ReadonlySet<number> = new Set<number>();

// Stable empty references so the footer-only TanStack table never rebuilds its
// row model: the dispersion bins body renders manually; this table instance
// exists purely to drive ServerPaginationFooter from the active Review
// projection's explicit document-or-match row count.
const EMPTY_DISPERSION_ROWS: Record<string, unknown>[] = [];
const EMPTY_DISPERSION_COLUMNS: ServerColumnDef<Record<string, unknown>>[] = [];

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
  reviewRowUnit: 'documents' | 'matches' | null;
  densitySeries?: ConcordanceDensitySeriesInput[];
  interactiveFilters: boolean;
  excludedMatchedTexts: ReadonlySet<string>;
  uncasedMatchedTexts: boolean;
  onUncasedMatchedTextsChange: (value: boolean) => void;
  onToggleMatchedTexts: (matchedTexts: readonly string[]) => void;
  termColors: Record<string, string>;
  resultsViewportWidth: number;
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

  // Dispersion-specific state
  proportionalDispersionBars: boolean;
  binCount: DispersionDisplayBinCount;
  onBinCountChange: (value: DispersionDisplayBinCount) => void;
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
  // Handlers
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
 * Rendered by: ConcordanceResultsPanel for each concordance dispersion result block.
 */
export function ConcordanceDispersionNodeBlock({
  nodeKey,
  nodeData,
  context,
  searchWord,
  showMetadata,
  selectedMetadataColumns,
  resultsViewportWidth,
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
  proportionalDispersionBars,
  binCount,
  onBinCountChange,
  dispersionChartMode,
  onDispersionChartModeChange,
  selectedBinIndices,
  onBinSelect,
  onBinRangeSelect,
  onClearBinSelection,
  handlePageChange,
  handleRowClick,
  setCombinedPage,
  reviewRowUnit,
  densitySeries,
  interactiveFilters,
  excludedMatchedTexts,
  uncasedMatchedTexts,
  onUncasedMatchedTextsChange,
  onToggleMatchedTexts,
  termColors,
  resultSummary,
}: ConcordanceDispersionNodeBlockProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
  }, [globalPageSize]);
  const { nodeId: actualNodeId, paginationKey, requestNodeId, column } = context;

  // Footer-only TanStack instance shared by both branches (only one mounts per
  // keyed instance). Called unconditionally to respect the rules of hooks; the
  // bins body still renders manually below. The row count uses the active
  // document-or-match projection.
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
        if (viewportRef.current) viewportRef.current.scrollTop = 0;
        onPageSizeChange(next.pageSize);
        return;
      }
      const newPage = next.pageIndex + 1;
      if (newPage === activePage) return;
      if (viewportRef.current) viewportRef.current.scrollTop = 0;
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
          table={paginationTable}
          pageIndex={activePage - 1}
          pageSize={globalPageSize}
          rowCount={nodeData.pagination.total_source_rows}
          pageSizeLabel={
            reviewRowUnit === null
              ? 'Documents per page'
              : panelSelectedNodes.length > 1
                ? `${reviewRowUnit === 'documents' ? 'Documents' : 'Matches'} per source per page`
                : `${reviewRowUnit === 'documents' ? 'Documents' : 'Matches'} per page`
          }
          pageSizeOptions={[...PAGE_SIZE_OPTIONS_DEFAULT]}
          loading={combinedLoading}
          showPageSize
        />
        {resultSummary ? (
          <div className="border-t border-surface-border">{resultSummary}</div>
        ) : null}
      </>
    );
    const sourceNames = panelSelectedNodes.map((node) => node.name).filter(Boolean);
    const dataBlockLabel = sourceNames.length > 0 ? sourceNames.join(', ') : 'Combined';

    return (
      <Card
        key={CONCORDANCE_COMBINED_NODE_KEY}
        data-testid="concordance-dispersion-combined-card"
        className="mb-6 overflow-hidden"
      >
        <ConcordanceCombinedResultHeader
          nodes={panelSelectedNodes}
          sourceColorMap={sourceColorMap}
          defaultPalette={defaultPalette}
          testId="concordance-dispersion-combined-header"
        />
        <CardContent className="space-y-4 bg-panel/20 p-3">
          <AnalysisTableFrame
            maxHeightClass="max-h-100"
            belowTable={combinedBelowTable}
            viewportRef={viewportRef}
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
              termColors={termColors}
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
          <ConcordanceDispersionSummary
            rows={rows}
            textColumn={column}
            binCount={binCount}
            splitBySource
            dataBlockLabel={dataBlockLabel}
            searchWord={searchWord}
            chartMode={dispersionChartMode}
            onChartModeChange={onDispersionChartModeChange}
            onBinCountChange={onBinCountChange}
            selection={
              interactiveFilters
                ? {
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
                  }
                : undefined
            }
            densitySeries={densitySeries}
            termColors={termColors}
            excludedMatchedTexts={excludedMatchedTexts}
            uncasedMatchedTexts={uncasedMatchedTexts}
            onUncasedMatchedTextsChange={onUncasedMatchedTextsChange}
            onToggleMatchedTexts={interactiveFilters ? onToggleMatchedTexts : undefined}
            showChart={!proportionalDispersionBars}
          />
        </CardContent>
      </Card>
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
    });

  const nodeIsLoading = Boolean(nodeLoading[paginationKey]);
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty-string display name must fall back to the node key
  const dataBlockLabel = context.displayName || nodeKey;
  // Mirror the table block by summarizing the current page groups together
  // with the source documents considered for this page.
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
        table={paginationTable}
        pageIndex={activePage - 1}
        pageSize={globalPageSize}
        rowCount={nodeData.pagination.total_source_rows}
        pageSizeLabel={
          reviewRowUnit === null
            ? 'Documents per page'
            : panelSelectedNodes.length > 1
              ? `${reviewRowUnit === 'documents' ? 'Documents' : 'Matches'} per source per page`
              : `${reviewRowUnit === 'documents' ? 'Documents' : 'Matches'} per page`
        }
        pageSizeOptions={[...PAGE_SIZE_OPTIONS_DEFAULT]}
        loading={nodeIsLoading}
        showPageSize
      />
      {resultSummary ? <div className="border-t border-surface-border">{resultSummary}</div> : null}
    </>
  );

  return (
    <Card
      key={nodeKey}
      data-testid="concordance-dispersion-source-card"
      className="mb-6 overflow-hidden"
    >
      <ConcordanceSourceResultHeader
        name={dataBlockLabel}
        color={context.nodeColor}
        testId="concordance-dispersion-source-header"
      />
      <CardContent className="space-y-4 bg-panel/20 p-3">
        <AnalysisTableFrame
          maxHeightClass="max-h-100"
          belowTable={belowTable}
          viewportRef={viewportRef}
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
            termColors={termColors}
            getRowClassName={(_row, index) =>
              `cursor-pointer ${index % 2 === 0 ? 'bg-surface' : 'bg-panel'}`
            }
            onRowClick={(row) => {
              if (actualNodeId && column) {
                handleRowClick(row, actualNodeId, column, getDispersionHits(row));
              }
            }}
          />
        </AnalysisTableFrame>
        <ConcordanceDispersionSummary
          rows={rows}
          textColumn={column}
          binCount={binCount}
          splitBySource={false}
          dataBlockLabel={dataBlockLabel}
          searchWord={searchWord}
          chartMode={dispersionChartMode}
          onChartModeChange={onDispersionChartModeChange}
          onBinCountChange={onBinCountChange}
          selection={
            interactiveFilters
              ? {
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
                }
              : undefined
          }
          densitySeries={densitySeries}
          termColors={termColors}
          excludedMatchedTexts={excludedMatchedTexts}
          uncasedMatchedTexts={uncasedMatchedTexts}
          onUncasedMatchedTextsChange={onUncasedMatchedTextsChange}
          onToggleMatchedTexts={interactiveFilters ? onToggleMatchedTexts : undefined}
          showChart={!proportionalDispersionBars}
        />
      </CardContent>
    </Card>
  );
}
