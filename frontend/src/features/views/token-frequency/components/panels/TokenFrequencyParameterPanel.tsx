import NodeSelectionPanel, {
  type NodeSelectionColumnAddonArgs,
} from '@/features/views/common/components/NodeSelectionPanel';
import { ANALYSIS_LOCKED_MESSAGE } from '@/features/views/common/components/AnalysisLockedNotice';
import { TokensColumnMismatchNotice } from '@/features/views/common/components/TokensColumnMismatchNotice';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import type { NodeColumnSelection } from '@/features/workspace/common/hooks/useAutoNodeColumns';
import { AnalysisCardLayout } from '@/features/views/common/components/AnalysisCardLayout';
import type {
  WorkspaceNodeLike,
  NodeColumnSource,
} from '@/features/views/common/nodeSelectionTypes';
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
  actionState: {
    runDisabled: boolean;
    clearDisabled: boolean;
    runLabel: string;
    runDisabledReason?: string;
  };
  isAnalyzing: boolean;
  onAnalyze: () => void;
  onStop?: () => void;
  isStopping?: boolean;
  onClearResults: () => void;
  hasIncompleteSelections: boolean;
  appliedStopCount: number;
  hasResults: boolean;
  runLabel?: string;
  studyNodeId: string | null;
  onStudyNodeChange: (nodeId: string) => void;
  getColorForNode: (nodeId: string, index?: number) => string;
  computeDisplayName: (nodeId: string) => string;
  renderTokenizerModelSelector?: (args: NodeSelectionColumnAddonArgs) => React.ReactNode;
  lockedMessage?: string;
};

/**
 * Rendered by: TokenFrequencyFeature to show setup controls and selection locking because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * Flow: derive display state, bind user actions, then render the analysis UI.
 */
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
  onStop,
  isStopping,
  onClearResults,
  hasIncompleteSelections,
  appliedStopCount,
  hasResults,
  runLabel,
  studyNodeId,
  onStudyNodeChange,
  getColorForNode,
  computeDisplayName,
  renderTokenizerModelSelector,
  lockedMessage = ANALYSIS_LOCKED_MESSAGE,
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
        tooltip:
          'Choose up to two data blocks and the text columns to analyze. After the run, use the results panel to adjust stop words and displayed token limits.',
      }}
      actions={{
        onRun: onAnalyze,
        onStop,
        onClear: onClearResults,
        runDisabled: actionState.runDisabled || hasIncompleteSelections,
        runDisabledReason: hasIncompleteSelections
          ? 'Select a column for each data block'
          : actionState.runDisabledReason,
        clearDisabled: actionState.clearDisabled,
        isRunning: isAnalyzing,
        isStopping,
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
            {hasMultipleNodes && nodeOptions.length > 1 ? (
              <div className="ml-auto flex items-center gap-2">
                <Label className="whitespace-nowrap text-base font-medium">Study Data Block</Label>
                <div className="inline-flex items-center gap-1">
                  {nodeOptions.map((option) => {
                    const isActive = (studyNodeId ?? nodeOptions[0]?.id) === option.id;
                    return (
                      <DisabledReasonTooltip
                        key={option.id}
                        reason={
                          isLocked
                            ? 'Clear results first to change the study data block'
                            : undefined
                        }
                      >
                        <label
                          className={`inline-flex cursor-pointer items-center justify-center rounded-full p-1 transition-colors${isLocked ? ' cursor-not-allowed opacity-60' : ''}`}
                          title={option.label}
                          aria-label={option.label}
                        >
                          <input
                            type="radio"
                            name="study-node"
                            value={option.id}
                            checked={isActive}
                            disabled={isLocked}
                            onChange={() => onStudyNodeChange(option.id)}
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
                  label="Study Data Block"
                  tooltip="The study block is treated as Corpus 2 (O2/%2) in the keyword statistics; the other block is the reference (Corpus 1). Switching it flips the direction of measures like LogRatio."
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
        lockedMessage={lockedMessage}
        renderColumnControlAddon={renderTokenizerModelSelector}
      />
      <TokensColumnMismatchNotice
        nodes={panelSelectedNodes}
        selections={effectiveNodeColumnSelections}
        className="mt-3"
      />
    </AnalysisCardLayout>
  );
};
