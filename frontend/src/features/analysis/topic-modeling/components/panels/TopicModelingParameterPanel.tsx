import { Label } from '../../../../../components/ui/label';
import { Input } from '../../../../../components/ui/input';
import HelpIcon from '../../../../../components/help/HelpIcon';
import NodeSelectionPanel from '../../../../../components/NodeSelectionPanel';
import type { NodeColumnSelection } from '../../../../../hooks/useAutoNodeColumns';
import type { ColumnInfo } from '../../../../../utils/columnTypes';
import type { NodeLike } from '../../../../../hooks/useNodeColumnInfos';
import { AnalysisCardLayout } from '../../../common/components/AnalysisCardLayout';

type Props = {
  selectedNodes: Array<{ id?: string; name?: string }>;
  nodeColumnSelections: NodeColumnSelection[];
  onColumnChange: (nodeId: string, column: string) => void;
  nodeColors: Record<string, string>;
  onNodeColorChange: (nodeId: string, color: string) => void;
  defaultPalette: string[];
  isLocked: boolean;
  getNodeColumns: (node: NodeLike | null | undefined, idx?: number) => ColumnInfo[];
  actionState: { runDisabled: boolean; clearDisabled: boolean; runLabel: string };
  minTopicSize: number;
  onMinTopicSizeChange: (value: number) => void;
  isRunning: boolean;
  isClearing: boolean;
  onRun: () => void | Promise<void>;
  onClear: () => void | Promise<void>;
  hasMissingColumns: boolean;
  resultState?: string;
};

export function TopicModelingParameterPanel({
  selectedNodes,
  nodeColumnSelections,
  onColumnChange,
  nodeColors,
  onNodeColorChange,
  defaultPalette,
  isLocked,
  getNodeColumns,
  actionState,
  minTopicSize,
  onMinTopicSizeChange,
  isRunning,
  isClearing,
  onRun,
  onClear,
  hasMissingColumns,
  resultState,
}: Props) {
  return (
    <AnalysisCardLayout
      title="Topic Modeling Parameters"
      actions={{
        onRun,
        onClear,
        runDisabled: actionState.runDisabled || isRunning || hasMissingColumns,
        clearDisabled: actionState.clearDisabled || isClearing,
        isRunning,
        isClearing,
        hasResult: resultState === 'successful' || resultState === 'failed',
        runLabel: actionState.runLabel,
      }}
    >
      <NodeSelectionPanel
        selectedNodes={selectedNodes}
        nodeColumnSelections={nodeColumnSelections}
        onColumnChange={onColumnChange}
        nodeColors={nodeColors}
        onColorChange={onNodeColorChange}
        defaultPalette={defaultPalette}
        getNodeColumns={getNodeColumns}
        maxCompare={2}
        disabled={isLocked}
        locked={isLocked}
      />

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Label htmlFor="min-topic-size">Min Topic Size</Label>
            <HelpIcon targetKey="analysis.topic-modeling.min-topic-size" />
          </div>
          <Input
            id="min-topic-size"
            type="number"
            min={2}
            max={100}
            step={1}
            value={minTopicSize}
            onChange={(event) => onMinTopicSizeChange(Math.max(2, Number(event.target.value) || 0))}
          />
        </div>
      </div>

    </AnalysisCardLayout>
  );
}
