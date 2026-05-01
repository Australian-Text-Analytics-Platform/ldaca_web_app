import { useEffect, useState, type FocusEvent } from 'react';
import { Label } from '../../../../../components/ui/label';
import { Input } from '../../../../../components/ui/input';
import HelpIcon from '../../../../../components/help/HelpIcon';
import NodeSelectionPanel from '../../../../../components/NodeSelectionPanel';
import { ANALYSIS_LOCKED_MESSAGE } from '../../../../../components/tabs/AnalysisLockedNotice';
import type { NodeColumnSelection } from '../../../../../hooks/useAutoNodeColumns';
import type { ColumnInfo } from '../../../../../utils/columnTypes';
import type { NodeLike } from '../../../../../hooks/useNodeColumnInfos';
import { AnalysisCardLayout } from '../../../common/components/AnalysisCardLayout';
import { sanitizeMinTopicSizeInput } from './minTopicSize';

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
  randomSeed: number;
  onRandomSeedChange: (value: number) => void;
  representativeWordsCount: number;
  onRepresentativeWordsCountChange: (value: number) => void;
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
  randomSeed,
  onRandomSeedChange,
  representativeWordsCount,
  onRepresentativeWordsCountChange,
  isRunning,
  isClearing,
  onRun,
  onClear,
  hasMissingColumns,
  resultState,
}: Props) {
  const [minTopicSizeDraft, setMinTopicSizeDraft] = useState(() => String(minTopicSize));

  useEffect(() => {
    setMinTopicSizeDraft(String(minTopicSize));
  }, [minTopicSize]);

  const handleMinTopicSizeBlur = (event: FocusEvent<HTMLInputElement>) => {
    const nextValue = sanitizeMinTopicSizeInput(event.currentTarget.value);

    setMinTopicSizeDraft(String(nextValue));

    if (nextValue !== minTopicSize) {
      onMinTopicSizeChange(nextValue);
    }
  };

  return (
    <AnalysisCardLayout
      title="Topic Modelling - BERTopic"
      info={{
        targetKey: 'topic-modeling.overview',
        label: 'About Topic Modeling',
        tooltip: 'Learn what topic modeling is and how it can help you.',
      }}
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
        showShape
        disabled={isLocked}
        locked={isLocked}
        allowedDataTypes={['string']}
        lockedMessage={ANALYSIS_LOCKED_MESSAGE}
        originalCount={selectedNodes.length}
      />

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
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
            value={minTopicSizeDraft}
            onChange={(event) => setMinTopicSizeDraft(event.target.value)}
            onBlur={handleMinTopicSizeBlur}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="random-seed">Random Seed</Label>
          <Input
            id="random-seed"
            type="number"
            min={0}
            step={1}
            value={randomSeed}
            onChange={(event) => onRandomSeedChange(Math.max(0, Number(event.target.value) || 0))}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="representative-words-count">Representative Words to Show</Label>
          <Input
            id="representative-words-count"
            type="number"
            min={1}
            max={50}
            step={1}
            value={representativeWordsCount}
            onChange={(event) => onRepresentativeWordsCountChange(Math.max(1, Number(event.target.value) || 0))}
          />
        </div>
      </div>

    </AnalysisCardLayout>
  );
}
