import NodeSelectionPanel from '@/features/analysis/common/components/NodeSelectionPanel';
import { ANALYSIS_LOCKED_MESSAGE } from '@/features/analysis/common/components/AnalysisLockedNotice';
import { TokensColumnMismatchNotice } from '@/features/analysis/common/components/TokensColumnMismatchNotice';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import type { NodeColumnSelection } from '@/hooks/useAutoNodeColumns';
import { AnalysisCardLayout } from '@/features/analysis/common/components/AnalysisCardLayout';
import type { WorkspaceNodeLike, NodeColumnSource } from '@/features/analysis/common/nodeSelectionTypes';
import { Label } from '@/components/ui/label';
import HelpIcon from '@/components/help/HelpIcon';

type TokenFrequencyParameterPanelProps = {
  panelSelectedNodes: WorkspaceNodeLike[];
  effectiveNodeColumnSelections: NodeColumnSelection[];
  onColumnChange: (nodeId: string, column: string) => void;
  nodeColors: Record<string, string>;
  onColorChange: (nodeId: string, color: string) => void;
  defaultPalette: string[];
  isLocked: boolean;
  getNodeColumns: (node: WorkspaceNodeLike, idx?: number) => NodeColumnSource;
  displayNodeCount: number;
  actionState: { runDisabled: boolean; clearDisabled: boolean; runLabel: string; runDisabledReason?: string };
  isAnalyzing: boolean;
  onAnalyze: () => void;
  onClearResults: () => void;
  hasIncompleteSelections: boolean;
  appliedStopCount: number;
  hasResults: boolean;
  runLabel?: string;
  referenceNodeId: string | null;
  onReferenceNodeChange: (nodeId: string) => void;
  getColorForNode: (nodeId: string, index?: number) => string;
  computeDisplayName: (nodeId: string) => string;
  /**
   * Available tokeniser models on the active node for the selected source
   * column. When >1 entry, render a picker so the user can route the
   * frequency count through a specific tokeniser. Empty / one entry =
   * picker hidden (auto-pick the single one or none).
   */
  tokensModelOptions: string[];
  tokensModel: string | null;
  setTokensModel: (next: string | null) => void;
};

export const TokenFrequencyParameterPanel = ({
  panelSelectedNodes,
  effectiveNodeColumnSelections,
  onColumnChange,
  nodeColors,
  onColorChange,
  defaultPalette,
  isLocked,
  getNodeColumns,
  displayNodeCount,
  actionState,
  isAnalyzing,
  onAnalyze,
  onClearResults,
  hasIncompleteSelections,
  appliedStopCount,
  hasResults,
  runLabel,
  referenceNodeId,
  onReferenceNodeChange,
  getColorForNode,
  computeDisplayName,
  tokensModelOptions,
  tokensModel,
  setTokensModel,
}: TokenFrequencyParameterPanelProps) => {
  const hasMultipleNodes = panelSelectedNodes.length >= 2;
  const nodeOptions = panelSelectedNodes
    .map((node, index) => {
      const nodeId = typeof node.id === 'string' ? node.id : '';
      if (!nodeId) return null;
      return {
        id: nodeId,
        label: computeDisplayName(nodeId),
        color: getColorForNode(nodeId, index),
      };
    })
    .filter((option): option is { id: string; label: string; color: string } => Boolean(option));

  return (
    <AnalysisCardLayout
      title="Token Frequency Analysis"
      info={{
        targetKey: 'token-frequency.overview',
        label: 'About Token Frequency Analysis',
        tooltip: 'Learn what token frequency analysis is and how it can help you.',
      }}
      help={{
        targetKey: 'analysis.token-frequency.parameters',
        label: 'Token frequency parameters',
        tooltip: 'Choose up to two data blocks and the text columns to analyze. After the run, use the results panel to adjust stop words and displayed token limits.',
      }}
      actions={{
        onRun: onAnalyze,
        onClear: onClearResults,
        runDisabled: actionState.runDisabled || hasIncompleteSelections,
        runDisabledReason: hasIncompleteSelections
          ? 'Select a column for each data block'
          : actionState.runDisabledReason,
        clearDisabled: actionState.clearDisabled,
        isRunning: isAnalyzing,
        hasResult: hasResults,
        runLabel,
        runHelp: { targetKey: 'analysis.token-frequency.run', label: 'Run token frequency' },
        clearHelp: { targetKey: 'analysis.token-frequency.clear-results', label: 'Clear results' },
        extraContent: (
          <>
            {appliedStopCount > 0 ? (
              <span className="text-xs text-muted-foreground">
                Active filter: {appliedStopCount} word{appliedStopCount === 1 ? '' : 's'}
              </span>
            ) : null}
            {/* Tokens-model picker — only when the active source has been
                tokenised under >1 model. Frequency counts always read from
                the derived tokens column when one exists, so picking which
                model to use matters for users who tokenised the same
                source twice (e.g. jieba and bert-base-uncased). */}
            {tokensModelOptions.length > 1 ? (
              <div className="flex items-center gap-2 text-xs">
                <Label className="whitespace-nowrap text-xs font-medium">Tokeniser</Label>
                <select
                  value={tokensModel ?? ''}
                  onChange={(e) => setTokensModel(e.target.value || null)}
                  className="rounded-md border border-input bg-background px-2 py-1 text-xs shadow-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  title="Pick which tokeniser's column to count from"
                  disabled={isLocked}
                >
                  {tokensModelOptions.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            ) : null}
            {hasMultipleNodes && nodeOptions.length > 1 ? (
              <div className="ml-auto flex items-center gap-2">
                <Label className="whitespace-nowrap text-base font-medium">Reference Data Block</Label>
                <div className="inline-flex items-center gap-1">
                  {nodeOptions.map((option) => {
                    const isActive = (referenceNodeId ?? nodeOptions[0]?.id) === option.id;
                    return (
                      <DisabledReasonTooltip
                        key={option.id}
                        reason={isLocked ? 'Clear results first to change the reference data block' : undefined}
                      >
                      <label
                        className={`inline-flex cursor-pointer items-center justify-center rounded-full p-1 transition-colors${isLocked ? ' cursor-not-allowed opacity-60' : ''}`}
                        title={option.label}
                        aria-label={option.label}
                      >
                        <input
                          type="radio"
                          name="reference-node"
                          value={option.id}
                          checked={isActive}
                          disabled={isLocked}
                          onChange={() => onReferenceNodeChange(option.id)}
                          className="sr-only"
                        />
                        <span
                          className="inline-block h-5 w-5 rounded-full border-2 transition-colors"
                          style={{
                            borderColor: option.color,
                            backgroundColor: isActive ? option.color : 'transparent',
                          }}
                          aria-hidden="true"
                        />
                      </label>
                      </DisabledReasonTooltip>
                    );
                  })}
                </div>
                <HelpIcon
                  targetKey="analysis.token-frequency.reference"
                  label="Reference Data Block"
                  tooltip="The reference block is treated as Corpus 1 (O1/%1) in the keyword statistics. Switching it flips the direction of measures like LogRatio."
                />
              </div>
            ) : null}
          </>
        ),
      }}
    >
      <NodeSelectionPanel
        selectedNodes={panelSelectedNodes}
        nodeColumnSelections={effectiveNodeColumnSelections}
        onColumnChange={onColumnChange}
        nodeColors={nodeColors}
        onColorChange={onColorChange}
        defaultPalette={defaultPalette}
        maxCompare={2}
        className="rounded-lg border border-dashed border-muted-foreground/40 bg-muted/30 p-4"
        showShape
        disabled={isLocked}
        locked={isLocked}
        showColorPicker
        getNodeColumns={getNodeColumns}
        allowedDataTypes={['string']}
        originalCount={displayNodeCount}
        lockedMessage={ANALYSIS_LOCKED_MESSAGE}
      />
      <TokensColumnMismatchNotice
        nodes={panelSelectedNodes}
        selections={effectiveNodeColumnSelections}
        className="mt-3"
      />
    </AnalysisCardLayout>
  );
};
