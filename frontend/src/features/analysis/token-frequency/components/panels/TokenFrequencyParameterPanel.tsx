import NodeSelectionPanel from '@/components/NodeSelectionPanel';
import { ANALYSIS_LOCKED_MESSAGE } from '@/components/tabs/AnalysisLockedNotice';
import type { NodeColumnSelection } from '@/hooks/useAutoNodeColumns';
import { AnalysisCardLayout } from '../../../common/components/AnalysisCardLayout';

type TokenFrequencyParameterPanelProps = {
  panelSelectedNodes: any[];
  effectiveNodeColumnSelections: NodeColumnSelection[];
  onColumnChange: (nodeId: string, column: string) => void;
  nodeColors: Record<string, string>;
  onColorChange: (nodeId: string, color: string) => void;
  defaultPalette: string[];
  isLocked: boolean;
  getNodeColumns: (node: any, idx?: number) => any[];
  displayNodeCount: number;
  actionState: { runDisabled: boolean; clearDisabled: boolean };
  isAnalyzing: boolean;
  onAnalyze: () => void;
  onClearResults: () => void;
  hasIncompleteSelections: boolean;
  appliedStopCount: number;
  hasResults: boolean;
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
}: TokenFrequencyParameterPanelProps) => {
  return (
    <AnalysisCardLayout
      title="Token Frequency Analysis"
      help={{
        targetKey: 'analysis.token-frequency.parameters',
        label: 'Token frequency parameters',
        tooltip: 'Choose nodes, text columns, token limits, and stop words before running the analysis.',
      }}
      actions={{
        onRun: onAnalyze,
        onClear: onClearResults,
        runDisabled: actionState.runDisabled || hasIncompleteSelections,
        clearDisabled: actionState.clearDisabled,
        isRunning: isAnalyzing,
        hasResult: hasResults,
        runHelp: { targetKey: 'analysis.token-frequency.run', label: 'Run token frequency' },
        clearHelp: { targetKey: 'analysis.token-frequency.clear-results', label: 'Clear results' },
        extraContent: appliedStopCount > 0 ? (
          <span className="text-xs text-muted-foreground">
            Active filter: {appliedStopCount} word{appliedStopCount === 1 ? '' : 's'}
          </span>
        ) : null,
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
    </AnalysisCardLayout>
  );
};
