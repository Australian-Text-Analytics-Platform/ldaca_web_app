import React, { type Dispatch, type SetStateAction } from 'react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Play, Square, Trash2 } from 'lucide-react';
import HelpIcon from '@/components/help/HelpIcon';
import { AnalysisFeatureHeader } from '@/features/views/common/components/AnalysisFeatureHeader';
import NodeSelectionPanel, {
  type NodeSelectionColumnAddonArgs,
} from '@/features/views/common/components/NodeSelectionPanel';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { SNAPSHOT_DISABLED_REASON, snapshotDisabledReason } from '@/features/snapshot-view';
import { ANALYSIS_LOCKED_MESSAGE } from '@/features/views/common/components/AnalysisLockedNotice';
import { TokensColumnMismatchNotice } from '@/features/views/common/components/TokensColumnMismatchNotice';
import type { AnalysisActionState, NodeColumnSelection } from '../../common';
import type { WorkspaceNodeLike } from '../../common/nodeSelectionTypes';
import type { ColumnInfo } from '@/features/workspace/data-view/utils/columnTypes';
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
  actionState: AnalysisActionState;
  handleRunOrUpdate: () => Promise<void>;
  handleStopTask?: () => Promise<void>;
  isStopping?: boolean;
  handleClearResults: () => Promise<void>;

  // Page size
  globalPageSize: number;
  setGlobalPageSize: Dispatch<SetStateAction<number>>;
  setNodePagination: Dispatch<SetStateAction<PaginationState>>;
  persistResultPreferences: (partial: { pageSize?: number }) => Promise<unknown>;
  /** Forwarded to <AnalysisFeatureHeader> — wires the Save snapshot
   * button in the header's right slot. */
  onSaveSnapshot?: (filename: string, description: string) => Promise<void>;
  /** Forwarded to <AnalysisFeatureHeader>. When set, the Save button
   * is rendered disabled with this string as a hover tooltip. */
  saveSnapshotDisabledReason?: string | null;
  /** Forwarded to <AnalysisFeatureHeader> — wires the Open click in
   * the load dialog to the host's load pipeline. */
  onOpenSnapshot?: (filename: string) => Promise<void>;
  /** Forwarded to <AnalysisFeatureHeader>. Data-block labels used to
   * pre-populate the Save dialog's filename input. */
  snapshotNodeLabels?: string[];
  /** When true, the panel renders the captured search params for
   * display only — every input is disabled, Run + Clear footer is
   * hidden, and the Save/Open snapshot buttons in the header stay
   * available (the host gates Save with ``saveSnapshotDisabledReason``
   * which it sets to a fixed string in snapshot mode). Used by the
   * snapshot view to reuse the live ParameterPanel chrome verbatim. */
  readOnly?: boolean;
  renderTokenizerModelSelector?: (args: NodeSelectionColumnAddonArgs) => React.ReactNode;
};

/**
 * Rendered by: ConcordanceFeature to own concordance parameters and header snapshot controls because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * Flow: derive display state, bind user actions, then render the analysis UI.
 */
export function ConcordanceParameterPanel({
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
  searchMode,
  setSearchMode,
  tokensModeAvailable,
  isSearching,
  actionState,
  handleRunOrUpdate,
  handleStopTask,
  isStopping,
  handleClearResults,
  globalPageSize,
  setGlobalPageSize,
  setNodePagination,
  persistResultPreferences,
  onSaveSnapshot,
  saveSnapshotDisabledReason,
  onOpenSnapshot,
  snapshotNodeLabels,
  readOnly = false,
  renderTokenizerModelSelector,
}: ConcordanceParameterPanelProps) {
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
        tool="concordance"
        title="Concordance Search"
        infoKey="concordance.overview"
        infoLabel="About Concordance Search"
        infoTooltip="Learn what concordance search is and how it can help you."
        helpKey="analysis.concordance.parameters"
        helpLabel="Concordance parameters"
        helpTooltip="Select data blocks, choose the search term, and set context options before running."
        onSaveSnapshot={onSaveSnapshot}
        saveSnapshotDisabledReason={saveSnapshotDisabledReason}
        onOpenSnapshot={onOpenSnapshot}
        snapshotNodeLabels={snapshotNodeLabels}
      />
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
          disabled={!!isLocked || readOnly}
          locked={!!isLocked || readOnly}
          showColorPicker={true}
          getNodeColumns={getColumnInfos}
          allowedDataTypes={['string']}
          originalCount={displayNodeCount}
          lockedMessage={readOnly ? SNAPSHOT_DISABLED_REASON : ANALYSIS_LOCKED_MESSAGE}
          renderColumnControlAddon={renderTokenizerModelSelector}
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
              <DisabledReasonTooltip
                reason={readOnly ? SNAPSHOT_DISABLED_REASON : undefined}
                className="w-full"
              >
                <input
                  type="text"
                  value={searchWord}
                  onChange={(e) => setSearchWord(e.target.value)}
                  disabled={readOnly}
                  placeholder={
                    searchMode === 'tokens'
                      ? 'One or more tokens, separated by space, comma, or |'
                      : 'Enter word or phrase to search for'
                  }
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                />
              </DisabledReasonTooltip>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  Left context (tokens)
                </label>
                <DisabledReasonTooltip
                  reason={readOnly ? SNAPSHOT_DISABLED_REASON : undefined}
                  className="w-full"
                >
                  <input
                    type="number"
                    value={numLeftTokens}
                    onChange={(e) => setNumLeftTokens(parseInt(e.target.value) || 0)}
                    disabled={readOnly}
                    min="0"
                    max="50"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </DisabledReasonTooltip>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  Right context (tokens)
                </label>
                <DisabledReasonTooltip
                  reason={readOnly ? SNAPSHOT_DISABLED_REASON : undefined}
                  className="w-full"
                >
                  <input
                    type="number"
                    value={numRightTokens}
                    onChange={(e) => setNumRightTokens(parseInt(e.target.value) || 0)}
                    disabled={readOnly}
                    min="0"
                    max="50"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </DisabledReasonTooltip>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm">
            {/* Search mode picker. ``tokens`` is auto-selected when every selected
              source column has a tokenizer model; the regex / whole-word / case
              checkboxes don't apply in tokens mode so they're disabled with a
              tooltip explaining why. */}
            <div className="flex items-center gap-1">
              <span className="text-sm font-medium text-foreground">Search mode:</span>
              <div
                role="radiogroup"
                aria-label="Concordance search mode"
                className="inline-flex overflow-hidden rounded-md border border-input"
              >
                <DisabledReasonTooltip reason={readOnly ? SNAPSHOT_DISABLED_REASON : undefined}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={searchMode === 'regex'}
                    onClick={() => setSearchMode('regex')}
                    disabled={readOnly}
                    className={`px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      searchMode === 'regex'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background text-foreground hover:bg-muted'
                    }`}
                  >
                    Text
                  </button>
                </DisabledReasonTooltip>
                <DisabledReasonTooltip
                  reason={snapshotDisabledReason(
                    readOnly,
                    tokensModeAvailable
                      ? 'Each alternative is an exact-token match. Example: 猫|犬|魚 or cat dog fish finds every hit of any of them.'
                      : 'Tokens mode needs a tokenizer model for each selected column.',
                  )}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={searchMode === 'tokens'}
                    onClick={() => {
                      if (tokensModeAvailable) setSearchMode('tokens');
                    }}
                    disabled={!tokensModeAvailable || readOnly}
                    className={`border-l border-input px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      searchMode === 'tokens'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background text-foreground hover:bg-muted'
                    }`}
                  >
                    Tokens
                  </button>
                </DisabledReasonTooltip>
              </div>
              <HelpIcon
                targetKey="analysis.concordance.search-mode"
                label="Search mode (text vs tokens)"
              />
            </div>

            <div className="flex items-center gap-2">
              <DisabledReasonTooltip
                reason={snapshotDisabledReason(
                  readOnly,
                  searchMode === 'tokens' &&
                    'Whole-word applies to text-mode searches only — tokens-mode matches exact tokens by design.',
                )}
              >
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={wholeWord}
                    onChange={(e) => setWholeWord(e.target.checked)}
                    disabled={regex || searchMode === 'tokens' || readOnly}
                    className="h-4 w-4"
                  />
                  <span className="text-sm text-foreground">Whole word</span>
                </label>
              </DisabledReasonTooltip>
            </div>
            <div className="flex items-center gap-2">
              <DisabledReasonTooltip
                reason={snapshotDisabledReason(
                  readOnly,
                  searchMode === 'tokens' &&
                    'Regex applies to text-mode only — switch to text-mode to use it.',
                )}
              >
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={regex}
                    disabled={searchMode === 'tokens' || readOnly}
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
              </DisabledReasonTooltip>
              <HelpIcon targetKey="analysis.concordance.regex-toggle" label="Regex mode toggle" />
            </div>
            <DisabledReasonTooltip reason={readOnly ? SNAPSHOT_DISABLED_REASON : undefined}>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(e) => setCaseSensitive(e.target.checked)}
                  disabled={readOnly}
                  className="h-4 w-4"
                />
                <span className="text-sm text-foreground">Case sensitive</span>
              </label>
            </DisabledReasonTooltip>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-3 pt-0">
        {!readOnly && (
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
        )}
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
            // Snapshot mode: pagination is client-side over the
            // captured rows, so we don't push the new size to the
            // server. ``persistResultPreferences`` would 404 against
            // a workspace the snapshot's task no longer lives in.
            if (!readOnly) {
              void persistResultPreferences({ pageSize: newSize });
            }
          }}
        />
      </CardFooter>
    </Card>
  );
}
