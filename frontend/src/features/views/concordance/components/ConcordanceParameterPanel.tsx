import React, { type Dispatch, type SetStateAction } from 'react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Play, Square, Trash2 } from 'lucide-react';
import HelpIcon from '@/components/help/HelpIcon';
import { AnalysisFeatureHeader } from '@/features/views/common/components/AnalysisFeatureHeader';
import {
  NodeInputsPanel,
  type NodeInputColumnAddonArgs,
} from '@/features/views/common/components/NodeInputsPanel';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TokensColumnMismatchNotice } from '@/features/views/common/components/TokensColumnMismatchNotice';
import type { NodeColumnSelection } from '../../common/nodeSelectionTypes';
import type { RerunActionState } from '@/features/views/common/rerunActionState';
import type { UseTabNodeInputsResult } from '@/features/views/common/nodeInputs';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';

export interface ConcordanceParameterPanelProps {
  // Selection (add-node-as-needed)
  nodeInputs: UseTabNodeInputsResult;
  handleColumnChange: (nodeId: string, column: string) => void;
  nodeColors?: Record<string, string>;
  onNodeColorChange?: (nodeId: string, color: string) => void;
  defaultPalette?: string[];

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
  /**
   * Selected concordance engine. ``tokens`` mode walks the tokenization column
   * prepared by the selected tokenizer model; only meaningful when
   * ``tokensModeAvailable`` is true.
   */
  searchMode: 'regex' | 'tokens';
  setSearchMode: (next: 'regex' | 'tokens') => void;
  tokensModeAvailable: boolean;

  // Action state
  isSearching: boolean;
  actionState: RerunActionState;
  handleRunOrUpdate: () => Promise<void>;
  handleStopTask?: () => Promise<void>;
  isStopping?: boolean;
  handleClearResults: () => Promise<boolean>;
  renderTokenizerModelSelector?: (args: NodeInputColumnAddonArgs) => React.ReactNode;
}

/**
 * Rendered by: ConcordanceFeature to own concordance parameters.
 */
export function ConcordanceParameterPanel({
  nodeInputs,
  handleColumnChange,
  nodeColors,
  onNodeColorChange,
  defaultPalette,
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
  searchMode,
  setSearchMode,
  tokensModeAvailable,
  isSearching,
  actionState,
  handleRunOrUpdate,
  handleStopTask,
  isStopping,
  handleClearResults,
  renderTokenizerModelSelector,
}: ConcordanceParameterPanelProps) {
  const effectiveNodeColumnSelections: NodeColumnSelection[] = nodeInputs.nodeColumnSelections;
  const panelSelectedNodes: WorkspaceNodeMetadata[] = nodeInputs.selectedNodes;
  const runDisabledReason = (() => {
    if (isSearching) return undefined;
    if (actionState.runDisabledReason) return actionState.runDisabledReason;
    if (!searchWord.trim()) return 'Enter a search word first';
    if (effectiveNodeColumnSelections.some((sel) => !sel.column))
      return 'Select a column for each data block';
    return undefined;
  })();
  return (
    <Card>
      <AnalysisFeatureHeader
        title="Concordance Search"
        infoKey="concordance.overview"
        infoLabel="About Concordance Search"
        infoTooltip="Learn what concordance search is and how it can help you."
        helpKey="analysis.concordance.parameters"
        helpLabel="Concordance parameters"
        helpTooltip="Select data blocks, choose the search term, and set context options before running."
      />
      <CardContent className="space-y-4 pt-0">
        <NodeInputsPanel
          resolvedNodes={nodeInputs.resolvedNodes}
          availableNodes={nodeInputs.availableNodes}
          graphSelectedIds={nodeInputs.graphSelectedIds}
          recentPresets={nodeInputs.recentPresets}
          canAddMore={nodeInputs.canAddMore}
          maxNodes={2}
          onAddNodes={nodeInputs.addNodes}
          getAddRejection={nodeInputs.getAddRejection}
          onRemoveNode={nodeInputs.removeNode}
          onClear={nodeInputs.clear}
          onColumnChange={handleColumnChange}
          defaultPalette={defaultPalette}
          nodeColors={nodeColors}
          onNodeColorChange={onNodeColorChange}
          renderColumnAddon={renderTokenizerModelSelector}
        />

        <TokensColumnMismatchNotice
          nodes={panelSelectedNodes}
          selections={effectiveNodeColumnSelections}
        />

        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <label className="block text-sm font-medium text-foreground">
                  Search word or phrase
                </label>
                <HelpIcon
                  targetKey="analysis.concordance.search-term"
                  label="Concordance search term"
                />
              </div>
              <input
                type="text"
                value={searchWord}
                onChange={(e) => {
                  setSearchWord(e.target.value);
                }}
                placeholder={
                  searchMode === 'tokens'
                    ? 'One or more tokens, separated by space, comma, or |'
                    : 'Enter word or phrase to search for'
                }
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  Left context (tokens)
                </label>
                <input
                  type="number"
                  value={numLeftTokens}
                  onChange={(e) => {
                    setNumLeftTokens(parseInt(e.target.value) || 0);
                  }}
                  min="0"
                  max="50"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  Right context (tokens)
                </label>
                <input
                  type="number"
                  value={numRightTokens}
                  onChange={(e) => {
                    setNumRightTokens(parseInt(e.target.value) || 0);
                  }}
                  min="0"
                  max="50"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm">
            {/* Search mode picker. ``tokens`` is auto-selected when every selected
              source column has a tokenizer model. The regex / whole-word / case
              checkboxes only apply to text mode, so they're hidden entirely when
              tokens mode is active. */}
            <div className="flex items-center gap-1">
              <span className="text-sm font-medium text-foreground">Search mode:</span>
              <Tabs
                value={searchMode}
                onValueChange={(next) => {
                  if (next === 'tokens' && !tokensModeAvailable) return;
                  setSearchMode(next as 'regex' | 'tokens');
                }}
              >
                <TabsList className="h-8">
                  <TabsTrigger value="regex" className="text-xs">
                    Text
                  </TabsTrigger>
                  <DisabledReasonTooltip
                    reason={
                      tokensModeAvailable
                        ? 'Each alternative is an exact-token match. Example: 猫|犬|魚 or cat dog fish finds every hit of any of them.'
                        : 'Tokens mode needs a tokenizer model for each selected column.'
                    }
                  >
                    <TabsTrigger value="tokens" disabled={!tokensModeAvailable} className="text-xs">
                      Tokens
                    </TabsTrigger>
                  </DisabledReasonTooltip>
                </TabsList>
              </Tabs>
              <HelpIcon
                targetKey="analysis.concordance.search-mode"
                label="Search mode (text vs tokens)"
              />
            </div>

            {searchMode === 'regex' && (
              <>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={wholeWord}
                      onChange={(e) => {
                        setWholeWord(e.target.checked);
                      }}
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
                  <HelpIcon
                    targetKey="analysis.concordance.regex-toggle"
                    label="Regex mode toggle"
                  />
                </div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={caseSensitive}
                    onChange={(e) => {
                      setCaseSensitive(e.target.checked);
                    }}
                    className="h-4 w-4"
                  />
                  <span className="text-sm text-foreground">Case sensitive</span>
                </label>
              </>
            )}
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-3 pt-0">
        <>
          <DisabledReasonTooltip reason={runDisabledReason}>
            <Button
              onClick={() => {
                void handleRunOrUpdate();
              }}
              disabled={
                actionState.runDisabled ||
                !searchWord.trim() ||
                effectiveNodeColumnSelections.some((sel) => !sel.column)
              }
              className="w-full md:w-auto"
            >
              {isSearching ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  {actionState.runLabel}
                </>
              )}
            </Button>
          </DisabledReasonTooltip>

          {handleStopTask && isSearching ? (
            <Button
              onClick={() => {
                void handleStopTask();
              }}
              variant="outline"
              disabled={isStopping}
            >
              {isStopping ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Square className="mr-2 h-4 w-4" />
              )}
              Stop
            </Button>
          ) : null}

          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                void handleClearResults();
              }}
              variant="destructive"
              disabled={actionState.clearDisabled}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Clear Results
            </Button>
            <HelpIcon targetKey="analysis.concordance.clear-results" label="Clear results" />
          </div>
        </>
      </CardFooter>
    </Card>
  );
}
