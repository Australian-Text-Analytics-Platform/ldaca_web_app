import {
  NodeInputsPanel,
  type NodeInputColumnAddonArgs,
} from '@/features/views/common/components/NodeInputsPanel';
import { TokensColumnMismatchNotice } from '@/features/views/common/components/TokensColumnMismatchNotice';
import type { NodeColumnSelection } from '@/features/views/common/nodeSelectionTypes';
import { AnalysisCardLayout } from '@/features/views/common/components/AnalysisCardLayout';
import type { UseTabNodeInputsResult } from '@/features/views/common/nodeInputs';
import { Label } from '@/components/ui/label';
import HelpIcon from '@/components/help/HelpIcon';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface StudyNodeOption {
  id: string;
  label: string;
  color: string;
}

/**
 * Study-corpus selector shown immediately under the selected-node cards.
 * Rendered by: TokenFrequencyParameterPanel when two nodes are selected because
 * keyword statistics need one node marked as the study corpus while preserving
 * the selected-node card layout for column/tokenizer/color parameters.
 * Flow: resolve the effective study id, render a compact segmented swatch
 * group, mark the active swatch with a check icon, and notify the feature when
 * the user switches the study block.
 */
function StudyDataBlockToggle({
  nodeOptions,
  studyNodeId,
  onStudyNodeChange,
}: {
  nodeOptions: StudyNodeOption[];
  studyNodeId: string | null;
  onStudyNodeChange: (nodeId: string) => void;
}) {
  if (nodeOptions.length < 2) return null;
  const activeNodeId = studyNodeId ?? nodeOptions[0]?.id ?? null;

  return (
    <div className="px-3 pt-2">
      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
        <Label className="whitespace-nowrap text-sm font-medium">Study Data Block</Label>
        <div
          role="radiogroup"
          aria-label="Study Data Block"
          className="inline-flex items-center gap-1 rounded-lg bg-muted p-1"
        >
          {nodeOptions.map((option) => {
            const isActive = activeNodeId === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={isActive}
                aria-label={`Use ${option.label} as study data block`}
                title={option.label}
                className={cn(
                  'relative inline-flex size-8 items-center justify-center rounded-md p-0.5 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                  isActive ? 'bg-background shadow-sm' : 'hover:bg-background/70',
                )}
                onClick={() => {
                  onStudyNodeChange(option.id);
                }}
              >
                <span
                  aria-hidden="true"
                  className="block size-full rounded-sm shadow-sm"
                  style={{ backgroundColor: option.color }}
                >
                  {isActive ? (
                    <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
        <HelpIcon
          targetKey="analysis.token-frequency.reference"
          label="Study Data Block"
          tooltip="The study block is treated as Corpus 2 (O2/%2) in the keyword statistics; the other block is the reference (Corpus 1). Switching it flips the direction of measures like LogRatio."
        />
      </div>
    </div>
  );
}

interface TokenFrequencyParameterPanelProps {
  nodeInputs: UseTabNodeInputsResult;
  onColumnChange: (nodeId: string, column: string) => void;
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
  hasResults: boolean;
  runLabel?: string;
  studyNodeId: string | null;
  onStudyNodeChange: (nodeId: string) => void;
  getColorForNode: (nodeId: string, index?: number) => string;
  nodeColors?: Record<string, string>;
  onNodeColorChange?: (nodeId: string, color: string) => void;
  computeDisplayName: (nodeId: string) => string;
  renderTokenizerModelSelector?: (args: NodeInputColumnAddonArgs) => React.ReactNode;
}

/**
 * Rendered by: TokenFrequencyFeature to show setup controls and selection locking because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * Flow: derive display state, bind user actions, then render the analysis UI.
 */
export const TokenFrequencyParameterPanel = ({
  nodeInputs,
  onColumnChange,
  actionState,
  isAnalyzing,
  onAnalyze,
  onStop,
  isStopping,
  onClearResults,
  hasIncompleteSelections,
  hasResults,
  runLabel,
  studyNodeId,
  onStudyNodeChange,
  getColorForNode,
  nodeColors,
  onNodeColorChange,
  computeDisplayName,
  renderTokenizerModelSelector,
}: TokenFrequencyParameterPanelProps) => {
  const panelSelectedNodes = nodeInputs.selectedNodes;
  const effectiveNodeColumnSelections: NodeColumnSelection[] = nodeInputs.nodeColumnSelections;
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
      }}
    >
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
        onColumnChange={onColumnChange}
        nodeColors={nodeColors}
        onNodeColorChange={onNodeColorChange}
        renderColumnAddon={renderTokenizerModelSelector}
      />
      {hasMultipleNodes ? (
        <StudyDataBlockToggle
          nodeOptions={nodeOptions}
          studyNodeId={studyNodeId}
          onStudyNodeChange={onStudyNodeChange}
        />
      ) : null}
      <TokensColumnMismatchNotice
        nodes={panelSelectedNodes}
        selections={effectiveNodeColumnSelections}
        className="mt-3"
      />
    </AnalysisCardLayout>
  );
};
