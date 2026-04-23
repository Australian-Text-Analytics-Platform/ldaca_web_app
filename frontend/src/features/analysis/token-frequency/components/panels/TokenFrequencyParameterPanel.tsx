import NodeSelectionPanel from '@/components/NodeSelectionPanel';
import { ANALYSIS_LOCKED_MESSAGE } from '@/components/tabs/AnalysisLockedNotice';
import type { NodeColumnSelection } from '@/hooks/useAutoNodeColumns';
import { AnalysisCardLayout } from '../../../common/components/AnalysisCardLayout';
import type { WorkspaceNodeLike, NodeColumnSource } from '../../../common/nodeSelectionTypes';
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
  referenceNodeId: string | null;
  onReferenceNodeChange: (nodeId: string) => void;
  getColorForNode: (nodeId: string, index?: number) => string;
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
  referenceNodeId,
  onReferenceNodeChange,
  getColorForNode,
  computeDisplayName,
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

      {hasMultipleNodes && nodeOptions.length > 1 && (
        <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:gap-3">
          <Label className="text-sm font-medium whitespace-nowrap">Reference Data Block</Label>
          <div className="inline-flex w-fit flex-wrap rounded-xl border border-border bg-muted/40 p-1">
            {nodeOptions.map((option) => {
              const isActive = (referenceNodeId ?? nodeOptions[0]?.id) === option.id;
              return (
                <label
                  key={option.id}
                  className={`relative inline-flex cursor-pointer items-center justify-center rounded-lg p-2 transition-colors ${
                    isActive
                      ? 'bg-background shadow-sm'
                      : 'hover:bg-background/70'
                  } ${isLocked ? 'cursor-not-allowed opacity-60' : ''}`}
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
                    className={`inline-block h-4 w-4 rounded-full ${isActive ? 'ring-2 ring-ring ring-offset-2 ring-offset-background' : ''}`}
                    style={{ backgroundColor: option.color }}
                    aria-hidden="true"
                  />
                  <span className="sr-only">{option.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </AnalysisCardLayout>
  );
};
