import { useEffect, useState, type FocusEvent } from 'react';
import { Input } from '../../../../../components/ui/input';
import { Label } from '../../../../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../../components/ui/select';
import HelpIcon from '../../../../../components/help/HelpIcon';
import NodeSelectionPanel from '../../../../../components/NodeSelectionPanel';
import { ANALYSIS_LOCKED_MESSAGE } from '../../../../../components/tabs/AnalysisLockedNotice';
import type { NodeColumnSelection } from '../../../../../hooks/useAutoNodeColumns';
import type { ColumnInfo } from '../../../../../utils/columnTypes';
import type { NodeLike } from '../../../../../hooks/useNodeColumnInfos';
import { AnalysisCardLayout } from '../../../common/components/AnalysisCardLayout';

export type CorpusSample = {
  percent: string;
  enabled: boolean;
};

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
  corpusSamples: CorpusSample[];
  nodeDocCounts: number[];
  onCorpusSampleChange: (idx: number, update: Partial<CorpusSample>) => void;
  topicSizeMode: 'target' | 'min' | 'exact';
  onTopicSizeModeChange: (mode: 'target' | 'min' | 'exact') => void;
  topicSizeValue: number;
  topicSizeUserSet: boolean;
  topicSizeWarning: 'orange' | 'red' | null;
  onTopicSizeValueChange: (value: number) => void;
  showSamplingWarning: boolean;
  randomSeed: number;
  randomSeedUserSet: boolean;
  onRandomSeedChange: (value: number) => void;
  representativeWordsCount: number;
  representativeWordsCountUserSet: boolean;
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
  corpusSamples,
  nodeDocCounts,
  onCorpusSampleChange,
  topicSizeMode,
  onTopicSizeModeChange,
  topicSizeValue,
  topicSizeUserSet,
  topicSizeWarning,
  onTopicSizeValueChange,
  showSamplingWarning,
  randomSeed,
  randomSeedUserSet,
  onRandomSeedChange,
  representativeWordsCount,
  representativeWordsCountUserSet,
  onRepresentativeWordsCountChange,
  isRunning,
  isClearing,
  onRun,
  onClear,
  hasMissingColumns,
  resultState,
}: Props) {
  const [topicSizeValueDraft, setTopicSizeValueDraft] = useState(() => String(topicSizeValue));

  useEffect(() => {
    setTopicSizeValueDraft(String(topicSizeValue));
  }, [topicSizeValue]);

  const handleTopicSizeValueBlur = (event: FocusEvent<HTMLInputElement>) => {
    const raw = Number(event.currentTarget.value);
    const next = Math.max(2, isNaN(raw) ? 2 : Math.round(raw));
    setTopicSizeValueDraft(String(next));
    onTopicSizeValueChange(next); // always call — even unchanged — to solidify grey placeholder
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

      <div className="mt-4 grid grid-cols-2 gap-6">

        {/* ── Left column: Data Block Sampling ── */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-1.5">
            <Label className="text-sm font-medium">Data Block Sampling</Label>
            <HelpIcon targetKey="analysis.topic-modeling.sampling" />
          </div>

          {/* Always render exactly 2 rows */}
          {([0, 1] as const).map((idx) => {
            const node = selectedNodes[idx];
            const sample = corpusSamples[idx] ?? { percent: '100', enabled: false };
            const nodeId = node?.id ?? '';
            const color = nodeId
              ? (nodeColors[nodeId] ?? defaultPalette[idx] ?? '#6b7280')
              : '#9ca3af';
            const nDocs = nodeDocCounts[idx] ?? 0;

            // When unchecked: display 100 and show full doc count
            const displayPercent = sample.enabled ? sample.percent : '100';
            const effectiveDocs = sample.enabled
              ? Math.max(
                  1,
                  Math.round(
                    (nDocs * Math.min(100, Math.max(1, Number(sample.percent) || 100))) / 100
                  )
                )
              : nDocs;

            if (!node) {
              // Placeholder row — same height as a real row, no interaction
              return (
                <div
                  key={`placeholder-${idx}`}
                  className="flex items-center gap-2 opacity-25"
                  style={{ minHeight: '2rem' }}
                >
                  <div
                    className="h-5 w-5 flex-shrink-0 rounded-full border-2"
                    style={{ borderColor: '#9ca3af' }}
                  />
                  <span className="text-sm text-muted-foreground">—</span>
                </div>
              );
            }

            return (
              <div key={nodeId || idx} className="flex items-center gap-2">
                {/* Coloured circle radio toggle */}
                <button
                  type="button"
                  onClick={() =>
                    !isLocked && onCorpusSampleChange(idx, { enabled: !sample.enabled })
                  }
                  disabled={isLocked}
                  aria-label={sample.enabled ? 'Disable sampling' : 'Enable sampling'}
                  className="h-5 w-5 flex-shrink-0 rounded-full border-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: sample.enabled ? color : 'transparent',
                    borderColor: color,
                  }}
                />

                <span className={`text-sm font-medium${sample.enabled ? '' : ' text-muted-foreground'}`}>Random</span>

                {/* % input — vertically aligned across rows by identical prefix */}
                <Input
                  aria-label={`Sampling percentage for corpus ${idx + 1}`}
                  type="number"
                  min={1}
                  max={100}
                  step={10}
                  value={displayPercent}
                  disabled={isLocked || !sample.enabled}
                  className="h-8 w-14 flex-shrink-0 px-1.5 text-center text-sm"
                  onChange={(e) => onCorpusSampleChange(idx, { percent: e.target.value })}
                  onBlur={(e) => {
                    const raw = Number(e.target.value);
                    const clamped = Math.min(
                      100,
                      Math.max(1, isNaN(raw) ? 1 : Math.round(raw))
                    );
                    onCorpusSampleChange(idx, { percent: String(clamped) });
                  }}
                />

                <span className="text-sm font-medium">%</span>

                {nDocs > 0 && (
                  <span className="text-sm font-medium">
                    {`→ ~`}<span style={{ color }}>{effectiveDocs.toLocaleString()}</span>{` documents`}
                  </span>
                )}
              </div>
            );
          })}

          {showSamplingWarning && (
            <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs leading-tight text-amber-700">
              Sampled corpus may be too small for the target topic count.
            </p>
          )}
        </div>

        {/* ── Right column: Topic Modelling Options ── */}
        <div className="flex flex-col gap-3">
          <Label className="text-sm font-medium">Topic Modelling Options</Label>

          {/* Row 1: mode dropdown + value input */}
          <div className="flex items-center gap-2">
            <Select
              value={topicSizeMode}
              onValueChange={(v) => onTopicSizeModeChange(v as 'target' | 'min' | 'exact')}
              disabled={isLocked}
            >
              <SelectTrigger className="h-8 flex-1 text-sm font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="target" className="text-sm font-medium">Aim Topic No.</SelectItem>
                <SelectItem value="min" className="text-sm font-medium">Min Topic Size</SelectItem>
                <SelectItem value="exact" className="text-sm font-medium">Exact Topic No.</SelectItem>
              </SelectContent>
            </Select>
            <Input
              id="topic-size-value"
              aria-label="Topic size value"
              type="number"
              min={2}
              step={1}
              value={topicSizeValueDraft}
              disabled={isLocked}
              title={
                topicSizeWarning === 'red'
                  ? 'Fewer than 3 documents per topic — results will likely be unusable'
                  : topicSizeWarning === 'orange'
                  ? 'Fewer than 10 documents per topic — topics may be noisy or unstable'
                  : undefined
              }
              className={`h-8 w-24 flex-shrink-0 px-2 text-right text-sm${
                topicSizeWarning === 'red'
                  ? ' text-red-500'
                  : topicSizeWarning === 'orange'
                  ? ' text-orange-500'
                  : !topicSizeUserSet
                  ? ' text-muted-foreground'
                  : ''
              }`}
              onChange={(e) => setTopicSizeValueDraft(e.target.value)}
              onBlur={handleTopicSizeValueBlur}
            />
          </div>

          {/* Row 2: random seed */}
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="random-seed" className="whitespace-nowrap pl-3 text-sm">
              Random Seed
            </Label>
            <Input
              id="random-seed"
              type="number"
              min={0}
              step={1}
              value={randomSeed}
              className={`h-8 w-24 text-right text-sm${!randomSeedUserSet ? ' text-muted-foreground' : ''}`}
              onChange={(e) => onRandomSeedChange(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>

          {/* Row 3: words per topic */}
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="representative-words-count" className="whitespace-nowrap pl-3 text-sm">
              Words per topic
            </Label>
            <Input
              id="representative-words-count"
              type="number"
              min={1}
              max={50}
              step={1}
              value={representativeWordsCount}
              className={`h-8 w-24 text-right text-sm${!representativeWordsCountUserSet ? ' text-muted-foreground' : ''}`}
              onChange={(e) =>
                onRepresentativeWordsCountChange(Math.max(1, Number(e.target.value) || 0))
              }
            />
          </div>
        </div>

      </div>
    </AnalysisCardLayout>
  );
}
