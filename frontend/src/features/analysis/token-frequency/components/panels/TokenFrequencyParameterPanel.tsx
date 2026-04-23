import NodeSelectionPanel from '@/components/NodeSelectionPanel';
import { ANALYSIS_LOCKED_MESSAGE } from '@/components/tabs/AnalysisLockedNotice';
import type { NodeColumnSelection } from '@/hooks/useAutoNodeColumns';
import { AnalysisCardLayout } from '../../../common/components/AnalysisCardLayout';
import type { WorkspaceNodeLike, NodeColumnSource } from '../../../common/nodeSelectionTypes';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

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
  actionState: { runDisabled: boolean; clearDisabled: boolean; runLabel: string };
  isAnalyzing: boolean;
  onAnalyze: () => void;
  onClearResults: () => void;
  hasIncompleteSelections: boolean;
  appliedStopCount: number;
  hasResults: boolean;
  runLabel?: string;
  baselineNodeId: string | null;
  onBaselineNodeChange: (nodeId: string) => void;
  computeDisplayName: (nodeId: string) => string;
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
  baselineNodeId,
  onBaselineNodeChange,
  computeDisplayName,
}: TokenFrequencyParameterPanelProps) => {
  const hasTwoNodes = panelSelectedNodes.length === 2;
  const nodeIds = panelSelectedNodes.map((n) => String(n.id)).filter(Boolean);

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
        clearDisabled: actionState.clearDisabled,
        isRunning: isAnalyzing,
        hasResult: hasResults,
        runLabel,
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

      {hasTwoNodes && (
        <div className="flex items-center gap-3 pt-2">
          <Label htmlFor="baseline-node" className="text-sm font-medium whitespace-nowrap">Baseline</Label>
          <Select
            value={baselineNodeId ?? nodeIds[0]}
            onValueChange={onBaselineNodeChange}
            disabled={isLocked}
          >
            <SelectTrigger id="baseline-node" className="h-8 w-64">
              <SelectValue placeholder="Select baseline node" />
            </SelectTrigger>
            <SelectContent>
              {nodeIds.map((id) => (
                <SelectItem key={id} value={id}>
                  {computeDisplayName(id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </AnalysisCardLayout>
  );
};
