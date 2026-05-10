import React, { type Dispatch, type SetStateAction } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Play, Trash2 } from 'lucide-react';
import HelpIcon from '@/components/help/HelpIcon';
import InfoIcon from '@/components/help/InfoIcon';
import NodeSelectionPanel from '@/features/analysis/common/components/NodeSelectionPanel';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { ANALYSIS_LOCKED_MESSAGE } from '@/features/analysis/common/components/AnalysisLockedNotice';
import type { AnalysisActionState, NodeColumnSelection } from '../../common';
import type { WorkspaceNodeLike } from '../../common/nodeSelectionTypes';
import type { ColumnInfo } from '@/utils/columnTypes';
import { PageSizeSelect } from '../../common/components/PageSizeSelect';
import type { PaginationState } from '../hooks/useConcordanceTaskFlow';

type GetColumnInfo = (node: WorkspaceNodeLike | null | undefined, idx?: number) => ColumnInfo[];

export type ConcordanceParameterPanelProps = {
  // Selection
  panelSelectedNodes: WorkspaceNodeLike[];
  effectiveNodeColumnSelections: NodeColumnSelection[];
  handleColumnChange: (nodeId: string, column: string) => void;
  nodeColors: Record<string, string>;
  handleColorChange: (nodeId: string, color: string) => void;
  defaultPalette: string[];
  getColumnInfos: GetColumnInfo;
  displayNodeCount: number;
  isLocked: boolean;

  // Search params
  searchWord: string;
  setSearchWord: Dispatch<SetStateAction<string>>;
  numLeftTokens: number;
  setNumLeftTokens: Dispatch<SetStateAction<number>>;
  numRightTokens: number;
  setNumRightTokens: Dispatch<SetStateAction<number>>;
  regex: boolean;
  setRegex: Dispatch<SetStateAction<boolean>>;
  wholeWord: boolean;
  setWholeWord: Dispatch<SetStateAction<boolean>>;
  caseSensitive: boolean;
  setCaseSensitive: Dispatch<SetStateAction<boolean>>;

  // Action state
  isSearching: boolean;
  actionState: AnalysisActionState;
  handleRunOrUpdate: () => Promise<void>;
  handleClearResults: () => Promise<void>;

  // Page size
  globalPageSize: number;
  setGlobalPageSize: Dispatch<SetStateAction<number>>;
  setNodePagination: Dispatch<SetStateAction<PaginationState>>;
  persistResultPreferences: (partial: { pageSize?: number }) => Promise<unknown>;
};

export const ConcordanceParameterPanel: React.FC<ConcordanceParameterPanelProps> = ({
  panelSelectedNodes,
  effectiveNodeColumnSelections,
  handleColumnChange,
  nodeColors,
  handleColorChange,
  defaultPalette,
  getColumnInfos,
  displayNodeCount,
  isLocked,
  searchWord,
  setSearchWord,
  numLeftTokens,
  setNumLeftTokens,
  numRightTokens,
  setNumRightTokens,
  regex,
  setRegex,
  wholeWord,
  setWholeWord,
  caseSensitive,
  setCaseSensitive,
  isSearching,
  actionState,
  handleRunOrUpdate,
  handleClearResults,
  globalPageSize,
  setGlobalPageSize,
  setNodePagination,
  persistResultPreferences,
}) => {
  const runDisabledReason = (() => {
    if (isSearching) return undefined;
    if (actionState.runDisabledReason) return actionState.runDisabledReason;
    if (!searchWord.trim()) return 'Enter a search word first';
    if (effectiveNodeColumnSelections.some((sel) => !sel.column)) return 'Select a column for each data block';
    return undefined;
  })();

  return (
    <Card>
      <CardHeader className="space-y-0 pb-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              Concordance Search
              <InfoIcon
                targetKey="concordance.overview"
                label="About Concordance Search"
                tooltip="Learn what concordance search is and how it can help you."
              />
              <HelpIcon
                targetKey="analysis.concordance.parameters"
                label="Concordance parameters"
                tooltip="Select data blocks, choose the search term, and set context options before running."
              />
            </CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <NodeSelectionPanel
          selectedNodes={panelSelectedNodes}
          nodeColumnSelections={effectiveNodeColumnSelections}
          onColumnChange={handleColumnChange}
          nodeColors={nodeColors}
          onColorChange={handleColorChange}
          defaultPalette={defaultPalette}
          maxCompare={2}
          className="border border-dashed border-muted-foreground/40 rounded-lg bg-muted/30 p-4"
          showShape
          disabled={!!isLocked}
          locked={!!isLocked}
          showColorPicker={true}
          getNodeColumns={getColumnInfos}
          allowedDataTypes={['string']}
          originalCount={displayNodeCount}
          lockedMessage={ANALYSIS_LOCKED_MESSAGE}
        />

        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <label className="block text-sm font-medium text-foreground">Search word or phrase</label>
                <HelpIcon targetKey="analysis.concordance.search-term" label="Concordance search term" />
              </div>
              <input
                type="text"
                value={searchWord}
                onChange={(e) => setSearchWord(e.target.value)}
                placeholder="Enter word or phrase to search for"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">Left context (tokens)</label>
                <input
                  type="number"
                  value={numLeftTokens}
                  onChange={(e) => setNumLeftTokens(parseInt(e.target.value) || 0)}
                  min="0"
                  max="50"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">Right context (tokens)</label>
                <input
                  type="number"
                  value={numRightTokens}
                  onChange={(e) => setNumRightTokens(parseInt(e.target.value) || 0)}
                  min="0"
                  max="50"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={wholeWord}
                  onChange={(e) => setWholeWord(e.target.checked)}
                  disabled={regex}
                  className="h-4 w-4"
                />
                <span className="text-sm text-foreground">Whole word</span>
              </label>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={regex}
                  onChange={(e) => {
                    const nextRegex = e.target.checked;
                    setRegex(nextRegex);
                    if (nextRegex) {
                      setWholeWord(false);
                    }
                  }}
                  className="h-4 w-4"
                />
                <span className="text-sm text-foreground">Use regular expression</span>
              </label>
              <HelpIcon targetKey="analysis.concordance.regex-toggle" label="Regex mode toggle" />
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-sm text-foreground">Case sensitive</span>
            </label>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-3 pt-0">
        <DisabledReasonTooltip reason={runDisabledReason}>
          <Button
            onClick={() => {
              void handleRunOrUpdate();
            }}
            disabled={
              actionState.runDisabled
              || !searchWord.trim()
              || effectiveNodeColumnSelections.some((sel) => !sel.column)
            }
            className="w-full md:w-auto"
          >
            {isSearching ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Running...</>
            ) : (
              <><Play className="mr-2 h-4 w-4" />{actionState.runLabel}</>
            )}
          </Button>
        </DisabledReasonTooltip>

        <div className="flex items-center gap-2">
          <Button
            onClick={handleClearResults}
            variant="destructive"
            disabled={actionState.clearDisabled}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Clear Results
          </Button>
          <HelpIcon targetKey="analysis.concordance.clear-results" label="Clear results" />
        </div>
        <PageSizeSelect
          value={globalPageSize}
          onChange={(newSize) => {
            setGlobalPageSize(newSize);
            setNodePagination((prev) => {
              const updated = { ...prev };
              Object.keys(updated).forEach((nid) => {
                updated[nid] = { ...updated[nid]!, pageSize: newSize, currentPage: 1 };
              });
              return updated;
            });
            void persistResultPreferences({ pageSize: newSize });
          }}
        />
      </CardFooter>
    </Card>
  );
};
