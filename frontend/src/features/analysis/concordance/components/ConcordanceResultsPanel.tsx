import React, { type Dispatch, type SetStateAction, type RefObject } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';
import HelpIcon from '@/components/help/HelpIcon';
import type { ConcordanceAnalysisResponse, ConcordanceGroupedRow } from '@/api/text';
import type { NodeColumnSelection } from '../../common';
import type { WorkspaceNodeLike } from '../../common/nodeSelectionTypes';
import { MetadataColumnSelector } from '../../common/components/MetadataColumnSelector';
import type { MultiSeriesChartType } from '../../common/components/MultiSeriesChart';
import {
  type DispersionDisplayBinCount,
  type TaggedBinRow,
} from '../concordanceViewModels';
import type { PaginationState } from '../hooks/useConcordanceTaskFlow';
import { ConcordanceTableNodeBlock } from './ConcordanceTableNodeBlock';
import { ConcordanceDispersionNodeBlock } from './ConcordanceDispersionNodeBlock';

type Section = { columns: string[]; color?: string; disabled?: boolean };

export type ConcordanceResultsPanelProps = {
  // Result + view orchestration
  results: ConcordanceAnalysisResponse;
  resultsRef: RefObject<HTMLDivElement | null>;
  resultsViewportRef: RefObject<HTMLDivElement | null>;
  resultsViewportWidth: number;

  viewMode: 'separated' | 'combined';
  handleViewModeChange: (mode: 'separated' | 'combined') => void;
  combinedLoading: boolean;

  concordanceView: 'table' | 'dispersion';
  setConcordanceView: Dispatch<SetStateAction<'table' | 'dispersion'>>;

  // Display + metadata
  showMetadata: boolean;
  availableMetadataColumns: string[];
  metadataColumnSections: Section[];
  metadataDisabledReason: string | undefined;
  selectedMetadataColumns: string[];
  setSelectedMetadataColumns: Dispatch<SetStateAction<string[]>>;

  // Dispersion-only state
  proportionalDispersionBars: boolean;
  setProportionalDispersionBars: Dispatch<SetStateAction<boolean>>;
  combinedSourceMode: 'aggregate' | 'split';
  setCombinedSourceMode: Dispatch<SetStateAction<'aggregate' | 'split'>>;
  dispersionChartType: MultiSeriesChartType;
  setDispersionChartType: Dispatch<SetStateAction<MultiSeriesChartType>>;
  selectedBinIndices: Record<string, Set<number>>;
  onBinSelect: (blockKey: string, index: number, shiftHeld: boolean) => void;
  onClearBinSelection: (blockKey: string) => void;
  colourMatches: boolean;
  setColourMatches: Dispatch<SetStateAction<boolean>>;
  lowercaseMatches: boolean;
  setLowercaseMatches: Dispatch<SetStateAction<boolean>>;
  hiddenMatchedTexts: Set<string>;
  setHiddenMatchedTexts: Dispatch<SetStateAction<Set<string>>>;
  binCount: DispersionDisplayBinCount;
  setBinCount: (value: DispersionDisplayBinCount) => void;
  allMatchedTexts: string[];
  matchedTextColorMap: Record<string, string>;
  getMaterializedBinsForKey: (nodeKey: string) => TaggedBinRow[] | undefined;
  isBlockMaterialised: (nodeKey: string) => boolean;

  // Search + selection (for per-block dispatch)
  searchWord: string;
  selectedNodes: WorkspaceNodeLike[];
  panelSelectedNodes: WorkspaceNodeLike[];
  effectiveNodeColumnSelections: NodeColumnSelection[];
  labelToNodeId: Record<string, string> | null;
  sourceColorMap: Record<string, string>;
  defaultPalette: string[];

  // Per-block pagination + state
  nodePagination: PaginationState;
  globalPageSize: number;
  combinedPage: number;
  setCombinedPage: Dispatch<SetStateAction<number>>;
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
  openDetachDialog: (nodes: { nodeId: string; column: string; nodeLabel: string }[]) => void;
  /**
   * Open the per-document detach dialog. Parent gathers the source-node
   * info(s) (one for per-node view, multiple for combined view) and the
   * current bin selection; the dialog handles column picking and confirm
   * dispatches the actual detach call(s).
   */
  onDispersionDetach: (
    nodes: Array<{ nodeId: string; column: string; nodeLabel: string }>,
    selectedBins: ReadonlySet<number> | null,
    binCount: number,
    options?: {
      selectedMatchedTexts?: string[] | null;
      matchCaseInsensitive?: boolean;
    },
  ) => Promise<void> | void;
  /** Snapshot-view flag: when true, the node blocks render the
   * captured rows + bins but every mutation surface (Process All,
   * Add to Workspace, Dispersion Detach) is disabled. Pagination,
   * sort, dispersion re-binning, and exports still work because
   * they operate on the in-memory captured data. */
  readOnly?: boolean;
};

export const ConcordanceResultsPanel: React.FC<ConcordanceResultsPanelProps> = ({
  results,
  resultsRef,
  resultsViewportRef,
  resultsViewportWidth,
  viewMode,
  handleViewModeChange,
  combinedLoading,
  concordanceView,
  setConcordanceView,
  showMetadata,
  availableMetadataColumns,
  metadataColumnSections,
  metadataDisabledReason,
  selectedMetadataColumns,
  setSelectedMetadataColumns,
  proportionalDispersionBars,
  setProportionalDispersionBars,
  combinedSourceMode,
  setCombinedSourceMode,
  dispersionChartType,
  setDispersionChartType,
  selectedBinIndices,
  onBinSelect,
  onClearBinSelection,
  colourMatches,
  setColourMatches,
  lowercaseMatches,
  setLowercaseMatches,
  hiddenMatchedTexts,
  setHiddenMatchedTexts,
  binCount,
  setBinCount,
  allMatchedTexts,
  matchedTextColorMap,
  getMaterializedBinsForKey,
  isBlockMaterialised,
  searchWord,
  selectedNodes,
  panelSelectedNodes,
  effectiveNodeColumnSelections,
  labelToNodeId,
  sourceColorMap,
  defaultPalette,
  nodePagination,
  globalPageSize,
  combinedPage,
  setCombinedPage,
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
  onDispersionDetach,
  readOnly = false,
}) => {
  const showDispersion = concordanceView === 'dispersion';

  return (
    <Card ref={resultsRef}>
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              Search Results
              <HelpIcon
                targetKey="analysis.concordance.results"
                label="Concordance results"
                tooltip="Browse keyword-in-context hits, switch between separated/combined views, and adjust pagination."
              />
            </CardTitle>
            {results.message && (
              <CardDescription className="max-w-2xl text-sm text-muted-foreground">
                {results.message}
              </CardDescription>
            )}
          </div>
          {panelSelectedNodes.length > 1 && (
            <Tabs
              value={viewMode}
              onValueChange={(mode) => handleViewModeChange(mode as 'separated' | 'combined')}
              className="w-full md:w-auto"
            >
              <TabsList aria-label="Concordance view mode">
                <TabsTrigger value="separated">Separated</TabsTrigger>
                {results?.combinable && (
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
                  setColourMatches(false);
                  setLowercaseMatches(false);
                  setHiddenMatchedTexts(new Set());
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
                selectedColumns={selectedMetadataColumns ?? []}
                onSelectedColumnsChange={setSelectedMetadataColumns}
                sections={metadataColumnSections}
                disabledReason={metadataDisabledReason}
              />
            </div>
          </div>
          {showDispersion ? (
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={proportionalDispersionBars}
                  onChange={(e) => setProportionalDispersionBars(e.target.checked)}
                  className="h-4 w-4"
                />
                <span>Bar length proportional to text length</span>
              </label>
              {!proportionalDispersionBars && viewMode === 'combined' && (
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <span>Sources:</span>
                  <select
                    value={combinedSourceMode}
                    onChange={(e) => setCombinedSourceMode(e.target.value as 'aggregate' | 'split')}
                    className="h-7 rounded border border-input bg-background px-2 text-sm"
                  >
                    <option value="aggregate">Aggregate</option>
                    <option value="split">Split (solid/dashed)</option>
                  </select>
                </label>
              )}
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={colourMatches}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setColourMatches(checked);
                    if (!checked) {
                      setLowercaseMatches(false);
                      setHiddenMatchedTexts(new Set());
                    }
                  }}
                  className="h-4 w-4"
                />
                <span>Colour matches</span>
              </label>
              {colourMatches && (
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={lowercaseMatches}
                    onChange={(e) => {
                      setLowercaseMatches(e.target.checked);
                      setHiddenMatchedTexts(new Set());
                    }}
                    className="h-4 w-4"
                  />
                  <span>Lowercase matches</span>
                </label>
              )}
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <div ref={resultsViewportRef} className="space-y-4">
          {results.data && Object.keys(results.data).length > 0 ? (
            <div className={`grid gap-4 ${viewMode === 'combined' ? 'grid-cols-1' : 'grid-cols-1'}`}>
              {Object.entries(results.data)
                .filter(([k]) => (viewMode === 'combined' ? k === '__COMBINED__' : k !== '__COMBINED__'))
                .map(([nodeName, nodeData]) => {
                  const keyedOrder = Object.keys(results.data);
                  const approxIndex = keyedOrder.indexOf(nodeName);
                  let node = panelSelectedNodes.find((n: WorkspaceNodeLike) => {
                    const d = n.data as Record<string, unknown> | undefined;
                    return ((d?.name as string | undefined) || n.id) === nodeName;
                  });
                  if (!node) {
                    node = panelSelectedNodes.find((n: WorkspaceNodeLike) => n.id === nodeName);
                  }
                  if (!node) {
                    node = panelSelectedNodes.find((n: WorkspaceNodeLike) => n.name === nodeName);
                  }
                  const mappedNodeId = labelToNodeId?.[nodeName];
                  if (!node && mappedNodeId) {
                    node = panelSelectedNodes.find((n: WorkspaceNodeLike) => n.id === mappedNodeId);
                  }
                  if (!node) {
                    node = panelSelectedNodes[approxIndex];
                  }

                  const resolvedNodeId = node?.id || mappedNodeId || '';
                  const paginationKey = resolvedNodeId || nodeName;
                  const requestNodeId = resolvedNodeId || nodeName;
                  const selection = effectiveNodeColumnSelections.find((sel) => sel.nodeId === resolvedNodeId);
                  const column = selection?.column || '';

                  const nodeDisplayName = (node?.name || nodeName) as string;
                  const nodeColor = sourceColorMap[nodeName.toLowerCase()]
                    || sourceColorMap[(node?.id || '').toLowerCase()]
                    || sourceColorMap[(node?.name || '').toLowerCase()]
                    || defaultPalette[approxIndex % defaultPalette.length];

                  const blockContext = {
                    nodeId: node?.id || '',
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
                    handlePageChange,
                    handleRowClick,
                    handleMaterialize,
                    setCombinedPage,
                    openDetachDialog,
                    readOnly,
                  };
                  return concordanceView === 'dispersion' ? (
                    <ConcordanceDispersionNodeBlock
                      key={nodeName}
                      {...sharedProps}
                      resultsViewportWidth={resultsViewportWidth}
                      proportionalDispersionBars={proportionalDispersionBars}
                      colourMatches={colourMatches}
                      lowercaseMatches={lowercaseMatches}
                      hiddenMatchedTexts={hiddenMatchedTexts}
                      setHiddenMatchedTexts={setHiddenMatchedTexts}
                      binCount={binCount}
                      onBinCountChange={setBinCount}
                      combinedSourceMode={combinedSourceMode}
                      dispersionChartType={dispersionChartType}
                      onDispersionChartTypeChange={setDispersionChartType}
                      selectedBinIndices={selectedBinIndices}
                      onBinSelect={onBinSelect}
                      onClearBinSelection={onClearBinSelection}
                      allMatchedTexts={allMatchedTexts}
                      matchedTextColorMap={matchedTextColorMap}
                      getMaterializedBinsForKey={getMaterializedBinsForKey}
                      isBlockMaterialised={isBlockMaterialised}
                      onDispersionDetach={onDispersionDetach}
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
};
