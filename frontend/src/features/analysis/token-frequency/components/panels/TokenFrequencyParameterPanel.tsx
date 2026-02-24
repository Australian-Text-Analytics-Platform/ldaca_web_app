import NodeSelectionPanel from '@/components/NodeSelectionPanel';
import HelpIcon from '@/components/help/HelpIcon';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Play, Trash2 } from 'lucide-react';
import { ANALYSIS_LOCKED_MESSAGE } from '@/components/tabs/AnalysisLockedNotice';
import type { NodeColumnSelection } from '@/hooks/useAutoNodeColumns';

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
}: TokenFrequencyParameterPanelProps) => {
  return (
    <Card>
      <CardHeader className="space-y-0 pb-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              Token Frequency Analysis
              <HelpIcon
                targetKey="analysis.token-frequency.parameters"
                label="Token frequency parameters"
                tooltip="Choose nodes, text columns, token limits, and stop words before running the analysis."
              />
            </CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-0">
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
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-3 pt-0">
        <div className="flex items-center gap-2">
          <Button
            onClick={onAnalyze}
            disabled={actionState.runDisabled || hasIncompleteSelections}
            className="w-full md:w-auto"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Calculate Token Frequencies
              </>
            )}
          </Button>
          <HelpIcon targetKey="analysis.token-frequency.run" label="Run token frequency" />
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={onClearResults} variant="destructive" disabled={actionState.clearDisabled}>
            <Trash2 className="mr-2 h-4 w-4" />
            Clear Results
          </Button>
          <HelpIcon targetKey="analysis.token-frequency.clear-results" label="Clear results" />
        </div>
        {appliedStopCount > 0 && (
          <span className="text-xs text-muted-foreground">
            Active filter: {appliedStopCount} word{appliedStopCount === 1 ? '' : 's'}
          </span>
        )}
      </CardFooter>
    </Card>
  );
};
