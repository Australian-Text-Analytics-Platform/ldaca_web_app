import { type Dispatch, type SetStateAction, type RefObject } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';
import HelpIcon from '@/components/help/HelpIcon';
import type { ConcordanceAnalysisResponse, WorkspaceGraphNode } from '@/api';
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
  combinedSourceMode: 'aggregate' | 'split';
  setCombinedSourceMode: Dispatch<SetStateAction<'aggregate' | 'split'>>;
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
  selectedNodes: WorkspaceGraphNode[];
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
  nodeDetaching: Record<string, boolean>;
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
  openDetachDialog: (nodes: { nodeId: string; column: string; nodeLabel: string }[]) => void;
  /**
   * Open the per-document detach dialog. Parent gathers the source-node
   * info(s) (one for per-node view, multiple for combined view) and the
   * current bin selection; the dialog handles column picking and confirm
   * dispatches the actual detach call(s).
   */
  onDispersionDetach: (
    nodes: { nodeId: string; column: string; nodeLabel: string }[],
    selectedBins: ReadonlySet<number> | null,
    binCount: number,
    options?: {
      selectedMatchedTexts?: string[] | null;
      matchCaseInsensitive?: boolean;
    },
  ) => Promise<void> | void;
}

export interface ConcordanceResultsPanelProps {
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
    combinedSourceMode,
    setCombinedSourceMode,
    dispersionChartMode,
    setDispersionChartMode,
    selectedBinIndices,
    onBinSelect,
    onBinRangeSelect,
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
    selectedNodes,
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
    nodeDetaching,
  },
  commands: { handleSort, handlePageChange, handleRowClick, openDetachDialog, onDispersionDetach },
}: ConcordanceResultsPanelProps) {
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
                selectedColumns={selectedMetadataColumns}
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
                  onChange={(e) => {
                    setProportionalDispersionBars(e.target.checked);
                  }}
                  className="h-4 w-4"
                />
                <span>Bar length proportional to text length</span>
              </label>
              {!proportionalDispersionBars && viewMode === 'combined' && (
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <span>Sources:</span>
                  <select
                    value={combinedSourceMode}
                    onChange={(e) => {
                      setCombinedSourceMode(e.target.value as 'aggregate' | 'split');
                    }}
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
                    handlePageChange,
                    handleRowClick,
                    setCombinedPage,
                    openDetachDialog,
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
                      dispersionChartMode={dispersionChartMode}
                      onDispersionChartModeChange={setDispersionChartMode}
                      selectedBinIndices={selectedBinIndices}
                      onBinSelect={onBinSelect}
                      onBinRangeSelect={onBinRangeSelect}
                      onClearBinSelection={onClearBinSelection}
                      allMatchedTexts={allMatchedTexts}
                      matchedTextColorMap={matchedTextColorMap}
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
}
