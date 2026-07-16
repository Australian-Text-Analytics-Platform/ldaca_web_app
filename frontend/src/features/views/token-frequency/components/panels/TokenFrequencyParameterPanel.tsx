import {
  NodeInputsPanel,
  type NodeInputColumnAddonArgs,
} from '@/features/views/common/components/NodeInputsPanel';
import { TokensColumnMismatchNotice } from '@/features/views/common/components/TokensColumnMismatchNotice';
import type { NodeColumnSelection } from '@/features/views/common/nodeSelectionTypes';
import { AnalysisCardLayout } from '@/features/views/common/components/AnalysisCardLayout';
import type { UseTabNodeInputsResult } from '@/features/views/common/nodeInputs';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

interface StudyNodeOption {
  id: string;
  label: string;
}

/**
 * Per-card corpus-role switch for two-node token-frequency comparisons.
 * Rendered by: TokenFrequencyParameterPanel inside each selected-node card so
 * the study/reference role sits next to the node it applies to.
 * Flow: unchecked means this card is Study Corpus, checked means Reference
 * Corpus. Toggling a card to Study stores that node id; toggling it to
 * Reference stores the paired node id as the study corpus, keeping both cards
 * synchronized through the single `studyNodeId` value.
 */
function CorpusRoleSwitch({
  nodeOption,
  pairedNodeId,
  isStudy,
  onStudyNodeChange,
}: {
  nodeOption: StudyNodeOption;
  pairedNodeId: string;
  isStudy: boolean;
  onStudyNodeChange: (nodeId: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
      <span
        className={cn(
          'whitespace-nowrap text-xs font-medium',
          isStudy ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        Study Corpus
      </span>
      <Switch
        size="sm"
        checked={!isStudy}
        aria-label={`${nodeOption.label} corpus role`}
        onCheckedChange={(isReference) => {
          onStudyNodeChange(isReference ? pairedNodeId : nodeOption.id);
        }}
      />
      <span
        className={cn(
          'whitespace-nowrap text-xs font-medium',
          isStudy ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        Reference Corpus
      </span>
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
  nodeColors?: Record<string, string>;
  onNodeColorChange?: (nodeId: string, color: string) => void;
  computeDisplayName: (nodeId: string) => string;
  renderTokenizerModelSelector?: (args: NodeInputColumnAddonArgs) => React.ReactNode;
}

/**
 * Rendered by TokenFrequencyFeature as the setup surface for its active tab.
 * Flow: render node, document-column, tokenizer, study-role, and colour
 * controls, then gate run, stop, and clear actions from the supplied task and
 * rerun state.
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
  nodeColors,
  onNodeColorChange,
  computeDisplayName,
  renderTokenizerModelSelector,
}: TokenFrequencyParameterPanelProps) => {
  const panelSelectedNodes = nodeInputs.selectedNodes;
  const effectiveNodeColumnSelections: NodeColumnSelection[] = nodeInputs.nodeColumnSelections;
  const nodeOptions = panelSelectedNodes
    .map((node) => {
      const nodeId = typeof node.id === 'string' ? node.id : '';
      if (!nodeId) return null;
      return {
        id: nodeId,
        label: computeDisplayName(nodeId),
      };
    })
    .filter((option): option is StudyNodeOption => Boolean(option));
  const showCorpusRoleSwitches = nodeOptions.length === 2;
  const activeStudyNodeId = studyNodeId ?? nodeOptions[0]?.id ?? null;

  const renderCorpusRoleSwitch = showCorpusRoleSwitches
    ? ({ nodeId }: NodeInputColumnAddonArgs) => {
        const nodeOption = nodeOptions.find((option) => option.id === nodeId);
        const pairedNode = nodeOptions.find((option) => option.id !== nodeId);
        if (!nodeOption || !pairedNode) return null;
        return (
          <CorpusRoleSwitch
            nodeOption={nodeOption}
            pairedNodeId={pairedNode.id}
            isStudy={activeStudyNodeId === nodeId}
            onStudyNodeChange={onStudyNodeChange}
          />
        );
      }
    : undefined;

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
        renderExtraNodeContent={renderCorpusRoleSwitch}
      />
      <TokensColumnMismatchNotice
        nodes={panelSelectedNodes}
        selections={effectiveNodeColumnSelections}
        className="mt-3"
      />
    </AnalysisCardLayout>
  );
};
