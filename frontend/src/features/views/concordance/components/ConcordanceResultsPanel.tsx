import { type Dispatch, type SetStateAction, type RefObject } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';
import HelpIcon from '@/components/help/HelpIcon';
import type { ConcordanceAnalysisResponse, ConcordanceDensityResult } from '@/api';
import type { NodeColumnSelection } from '../../common/nodeSelectionTypes';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import { MetadataColumnSelector } from '../../common/components/MetadataColumnSelector';
import type {
  ConcordanceDispersionChartMode,
  DispersionDisplayBinCount,
} from '../concordanceDispersionDomain';
import { resolveConcordanceResultBlock } from '../concordanceSourceDomain';
import { CONCORDANCE_COMBINED_NODE_KEY } from '../concordanceTableDomain';
import type { PaginationState } from '../hooks/useConcordanceTaskFlow';
import { ConcordanceTableNodeBlock } from './ConcordanceTableNodeBlock';
import { ConcordanceDispersionNodeBlock } from './ConcordanceDispersionNodeBlock';

interface Section {
  columns: string[];
  color?: string;
  disabled?: boolean;
}
type ConcordanceGroupedRow = Record<string, unknown>[];

interface ConcordanceResultsShell {
  resultsRef: RefObject<HTMLDivElement | null>;
  resultsViewportRef: RefObject<HTMLDivElement | null>;
  resultsViewportWidth: number;
  viewMode: 'separated' | 'combined';
  handleViewModeChange: (mode: 'separated' | 'combined') => void;
  combinedLoading: boolean;
}

interface ConcordanceResultsDisplay {
  concordanceView: 'table' | 'dispersion';
  setConcordanceView: Dispatch<SetStateAction<'table' | 'dispersion'>>;
  proportionalDispersionBars: boolean;
  setProportionalDispersionBars: Dispatch<SetStateAction<boolean>>;
  dispersionChartMode: ConcordanceDispersionChartMode;
  setDispersionChartMode: Dispatch<SetStateAction<ConcordanceDispersionChartMode>>;
  selectedBinIndices: Record<string, Set<number>>;
  onBinSelect: (blockKey: string, index: number, shiftHeld: boolean) => void;
  onBinRangeSelect: (
    blockKey: string,
    startIndex: number,
    endIndex: number,
    shiftHeld: boolean,
  ) => void;
  onClearBinSelection: (blockKey: string) => void;
  binCount: DispersionDisplayBinCount;
  setBinCount: (value: DispersionDisplayBinCount) => void;
  reviewDispersionRowUnit: 'documents' | 'matches';
  setReviewDispersionRowUnit: Dispatch<SetStateAction<'documents' | 'matches'>>;
}

interface ConcordanceResultsMetadata {
  showMetadata: boolean;
  availableMetadataColumns: string[];
  sections: Section[];
  disabledReason: string | undefined;
  selectedColumns: string[];
  setSelectedColumns: Dispatch<SetStateAction<string[]>>;
}

interface ConcordanceResultsSources {
  searchWord: string;
  panelSelectedNodes: WorkspaceNodeMetadata[];
  effectiveNodeColumnSelections: NodeColumnSelection[];
  labelToNodeId: Record<string, string> | null;
  sourceColorMap: Record<string, string>;
  defaultPalette: string[];
}

interface ConcordanceResultsSession {
  results: ConcordanceAnalysisResponse;
  nodePagination: PaginationState;
  globalPageSize: number;
  /** Changes the single shared page size used by every result table footer. */
  onPageSizeChange: (pageSize: number) => void;
  combinedPage: number;
  setCombinedPage: Dispatch<SetStateAction<number>>;
  nodeLoading: Record<string, boolean>;
  reviewDensityByNode: Record<string, ConcordanceDensityResult>;
}

interface ConcordanceResultsCommands {
  handleSort: (columnKey: string, paginationKey: string, requestNodeId: string) => void;
  handlePageChange: (newPage: number, paginationKey: string, requestNodeId: string) => void;
  handleRowClick: (
    row: Record<string, unknown>,
    nodeId: string,
    column: string,
    groupedHits?: ConcordanceGroupedRow,
  ) => void;
}

export interface ConcordanceResultsPanelProps {
  title?: string;
  isReview: boolean;
  headerAction?: React.ReactNode;
  shell: ConcordanceResultsShell;
  display: ConcordanceResultsDisplay;
  metadata: ConcordanceResultsMetadata;
  sources: ConcordanceResultsSources;
  session: ConcordanceResultsSession;
  commands: ConcordanceResultsCommands;
}

/**
 * Rendered by: ConcordanceFeature to coordinate table and dispersion result blocks.
 */
export function ConcordanceResultsPanel({
  title = 'Search Results',
  isReview,
  headerAction,
  shell: {
    resultsRef,
    resultsViewportRef,
    resultsViewportWidth,
    viewMode,
    handleViewModeChange,
    combinedLoading,
  },
  display: {
    concordanceView,
    setConcordanceView,
    proportionalDispersionBars,
    setProportionalDispersionBars,
    dispersionChartMode,
    setDispersionChartMode,
    selectedBinIndices,
    onBinSelect,
    onBinRangeSelect,
    onClearBinSelection,
    binCount,
    setBinCount,
    reviewDispersionRowUnit,
    setReviewDispersionRowUnit,
  },
  metadata: {
    showMetadata,
    availableMetadataColumns,
    sections: metadataColumnSections,
    disabledReason: metadataDisabledReason,
    selectedColumns: selectedMetadataColumns,
    setSelectedColumns: setSelectedMetadataColumns,
  },
  sources: {
    searchWord,
    panelSelectedNodes,
    effectiveNodeColumnSelections,
    labelToNodeId,
    sourceColorMap,
    defaultPalette,
  },
  session: {
    results,
    nodePagination,
    globalPageSize,
    onPageSizeChange,
    combinedPage,
    setCombinedPage,
    nodeLoading,
    reviewDensityByNode,
  },
  commands: { handleSort, handlePageChange, handleRowClick },
}: ConcordanceResultsPanelProps) {
  const showDispersion = concordanceView === 'dispersion';

  return (
    <Card ref={resultsRef}>
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <CardTitle className="flex items-center gap-2">
            {title}
            <HelpIcon
              targetKey="analysis.concordance.results"
              label="Concordance results"
              tooltip="Browse keyword-in-context hits, switch between separated/combined views, and adjust pagination."
            />
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {panelSelectedNodes.length > 1 && (
              <Tabs
                value={viewMode}
                onValueChange={(mode) => {
                  handleViewModeChange(mode as 'separated' | 'combined');
                }}
                className="w-full md:w-auto"
              >
                <TabsList aria-label="Concordance view mode">
                  <TabsTrigger value="separated">Separated</TabsTrigger>
                  {results.combinable && (
                    <TabsTrigger value="combined">
                      {combinedLoading ? (
                        <span className="flex items-center gap-1">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Combined
                        </span>
                      ) : (
                        'Combined'
                      )}
                    </TabsTrigger>
                  )}
                </TabsList>
              </Tabs>
            )}
            {headerAction}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Tabs
              value={concordanceView}
              onValueChange={(value) => {
                const newView = value as 'table' | 'dispersion';
                setConcordanceView(newView);
                if (newView === 'table') {
                  setProportionalDispersionBars(false);
                }
              }}
            >
              <TabsList>
                <TabsTrigger value="table">Table View</TabsTrigger>
                <TabsTrigger value="dispersion">Dispersion View</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex flex-wrap items-center gap-4">
              <MetadataColumnSelector
                availableColumns={availableMetadataColumns}
                selectedColumns={selectedMetadataColumns}
                onSelectedColumnsChange={setSelectedMetadataColumns}
                sections={metadataColumnSections}
                disabledReason={metadataDisabledReason}
              />
            </div>
          </div>
          {showDispersion ? (
            <div className="flex flex-wrap items-center gap-4">
              {isReview ? (
                <fieldset className="flex items-center gap-3 text-sm">
                  <legend className="sr-only">Page dispersion by</legend>
                  <span>Page by:</span>
                  {(['documents', 'matches'] as const).map((unit) => (
                    <label key={unit} className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        name="concordance-review-row-unit"
                        value={unit}
                        checked={reviewDispersionRowUnit === unit}
                        onChange={() => {
                          setReviewDispersionRowUnit(unit);
                        }}
                      />
                      {unit === 'documents' ? 'Documents' : 'Matches'}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={proportionalDispersionBars}
                  onChange={(e) => {
                    setProportionalDispersionBars(e.target.checked);
                  }}
                  className="h-4 w-4"
                />
                <span>Bar length proportional to text length</span>
              </label>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <div ref={resultsViewportRef} className="space-y-4">
          {Object.keys(results.data).length > 0 ? (
            <div
              className={`grid gap-4 ${viewMode === 'combined' ? 'grid-cols-1' : 'grid-cols-1'}`}
            >
              {Object.entries(results.data)
                .filter(([k]) =>
                  viewMode === 'combined'
                    ? k === CONCORDANCE_COMBINED_NODE_KEY
                    : k !== CONCORDANCE_COMBINED_NODE_KEY,
                )
                .map(([nodeName, nodeData]) => {
                  const keyedOrder = Object.keys(results.data);
                  const approxIndex = keyedOrder.indexOf(nodeName);
                  const {
                    node,
                    nodeId: resolvedNodeId,
                    column,
                  } = resolveConcordanceResultBlock(
                    nodeName,
                    panelSelectedNodes,
                    effectiveNodeColumnSelections,
                    labelToNodeId,
                  );
                  const paginationKey = resolvedNodeId || nodeName;
                  const requestNodeId = resolvedNodeId || nodeName;

                  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty-string node name must fall back to the node key
                  const nodeDisplayName = node?.name || nodeName;
                  const nodeColor =
                    sourceColorMap[nodeName.toLowerCase()] ??
                    sourceColorMap[(node?.id ?? '').toLowerCase()] ??
                    sourceColorMap[(node?.name ?? '').toLowerCase()] ??
                    defaultPalette[approxIndex % defaultPalette.length];

                  const blockContext = {
                    nodeId: resolvedNodeId,
                    paginationKey,
                    requestNodeId,
                    column,
                    displayName: nodeDisplayName,
                    nodeColor,
                  };
                  const sharedProps = {
                    nodeKey: nodeName,
                    nodeData,
                    context: blockContext,
                    searchWord,
                    showMetadata,
                    selectedMetadataColumns,
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
                    reviewRowUnit: isReview ? reviewDispersionRowUnit : null,
                    densitySeries: isReview
                      ? nodeName === CONCORDANCE_COMBINED_NODE_KEY
                        ? Object.entries(reviewDensityByNode).flatMap(([nodeId, density]) => {
                            const source = panelSelectedNodes.find((node) => node.id === nodeId);
                            return density.series.map((item) => ({
                              ...item,
                              source: source?.name ?? nodeId,
                            }));
                          })
                        : reviewDensityByNode[resolvedNodeId]?.series
                      : undefined,
                    handlePageChange,
                    handleRowClick,
                    setCombinedPage,
                  };
                  return concordanceView === 'dispersion' ? (
                    <ConcordanceDispersionNodeBlock
                      key={nodeName}
                      {...sharedProps}
                      resultsViewportWidth={resultsViewportWidth}
                      proportionalDispersionBars={proportionalDispersionBars}
                      binCount={binCount}
                      onBinCountChange={setBinCount}
                      dispersionChartMode={dispersionChartMode}
                      onDispersionChartModeChange={setDispersionChartMode}
                      selectedBinIndices={selectedBinIndices}
                      onBinSelect={onBinSelect}
                      onBinRangeSelect={onBinRangeSelect}
                      onClearBinSelection={onClearBinSelection}
                    />
                  ) : (
                    <ConcordanceTableNodeBlock
                      key={nodeName}
                      {...sharedProps}
                      handleSort={handleSort}
                    />
                  );
                })}
            </div>
          ) : (
            <div className="rounded-md border border-muted bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
              No data available
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
