import { useState, type FocusEvent } from 'react';
import { CircleHelp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { TopicSegmentationMethod } from '@/api';
import { AnalysisCardLayout } from '@/features/views/common/components/AnalysisCardLayout';
import {
  NodeInputsPanel,
  type NodeInputColumnAddonArgs,
} from '@/features/views/common/components/NodeInputsPanel';
import type { UseTabNodeInputsResult } from '@/features/views/common/nodeInputs';
import {
  effectiveSampleDocumentCount,
  sanitizeMinClusterSize,
  sanitizeSamplePercent,
  sanitizeMaxSegmentTokens,
  type CorpusSample,
} from '../../hooks/useTopicModelingParameters';

interface NumericInputDraft {
  source: number;
  value: string;
}

interface Props {
  nodeInputs: UseTabNodeInputsResult;
  onColumnChange: (nodeId: string, column: string) => void;
  nodeColors?: Record<string, string>;
  onNodeColorChange?: (nodeId: string, color: string) => void;
  defaultPalette?: string[];
  actionState: {
    runDisabled: boolean;
    clearDisabled: boolean;
    runDisabledReason?: string;
    clearDisabledReason?: string;
  };
  corpusSamples: CorpusSample[];
  nodeDocCounts: number[];
  onCorpusSampleChange: (idx: number, update: Partial<CorpusSample>) => void;
  minClusterSize: number;
  onMinClusterSizeChange: (value: number) => void;
  randomSeed: number;
  randomSeedUserSet: boolean;
  onRandomSeedChange: (value: number) => void;
  segmentationMethod: TopicSegmentationMethod;
  onSegmentationMethodChange: (value: TopicSegmentationMethod) => void;
  maxSegmentTokens: number;
  onMaxSegmentTokensChange: (value: number) => void;
  isRunning: boolean;
  isStopping?: boolean;
  isClearing: boolean;
  onRun: () => void | Promise<void>;
  onStop?: () => void | Promise<void>;
  onClear: () => void | Promise<void>;
  hasMissingColumns: boolean;
  hasResult: boolean;
  parametersLocked: boolean;
}
/**
 * Renders topic-modeling node inputs, sampling controls, run parameters, and shared actions.
 * Rendered by: TopicModelingFeature, which owns the selected-node and task state supplied here.
 * Flow: keep numeric input drafts editable until blur, clamp committed values,
 * attach per-corpus sampling to NodeInputsPanel, and delegate run/stop/clear actions.
 */
export function TopicModelingParameterPanel({
  nodeInputs,
  onColumnChange,
  nodeColors = {},
  onNodeColorChange,
  defaultPalette = [],
  actionState,
  corpusSamples,
  nodeDocCounts,
  onCorpusSampleChange,
  minClusterSize,
  onMinClusterSizeChange,
  randomSeed,
  randomSeedUserSet,
  onRandomSeedChange,
  segmentationMethod,
  onSegmentationMethodChange,
  maxSegmentTokens,
  onMaxSegmentTokensChange,
  isRunning,
  isStopping,
  isClearing,
  onRun,
  onStop,
  onClear,
  hasMissingColumns,
  hasResult,
  parametersLocked,
}: Props) {
  const [minClusterSizeDraft, setMinClusterSizeDraft] = useState<NumericInputDraft>(() => ({
    source: minClusterSize,
    value: String(minClusterSize),
  }));
  const minClusterSizeValueDraft =
    minClusterSizeDraft.source === minClusterSize
      ? minClusterSizeDraft.value
      : String(minClusterSize);

  const handleMinClusterSizeBlur = (event: FocusEvent<HTMLInputElement>) => {
    const next = sanitizeMinClusterSize(event.currentTarget.value);
    setMinClusterSizeDraft({ source: next, value: String(next) });
    onMinClusterSizeChange(next);
  };

  const [maxSegmentTokensDraft, setMaxSegmentTokensDraft] = useState<NumericInputDraft>(() => ({
    source: maxSegmentTokens,
    value: String(maxSegmentTokens),
  }));
  const maxSegmentTokensValueDraft =
    maxSegmentTokensDraft.source === maxSegmentTokens
      ? maxSegmentTokensDraft.value
      : String(maxSegmentTokens);

  const handleMaxSegmentTokensBlur = (event: FocusEvent<HTMLInputElement>) => {
    const next = sanitizeMaxSegmentTokens(event.currentTarget.value);
    setMaxSegmentTokensDraft({ source: next, value: String(next) });
    onMaxSegmentTokensChange(next);
  };

  // Called by: NodeInputsPanel to place topic sampling next to each selected node's text column because sampling is per-corpus input context rather than a separate global option.
  const renderSamplingInput = ({ index, nodeId }: NodeInputColumnAddonArgs) => {
    const sample = corpusSamples[index] ?? { percent: '100' };
    const nDocs = nodeDocCounts[index] ?? 0;
    const effectiveDocs = effectiveSampleDocumentCount(sample, nDocs);
    const label = `Sampling (${effectiveDocs.toLocaleString()} ${
      effectiveDocs === 1 ? 'document' : 'documents'
    })`;
    const inputId = `topic-sampling-percent-${String(index)}-${nodeId.replace(/[^A-Za-z0-9_-]/g, '_')}`;

    return (
      <div className="inline-grid w-max max-w-full gap-1" data-testid="topic-sampling-wrapper">
        <Label
          htmlFor={inputId}
          className="whitespace-nowrap text-xs font-medium text-muted-foreground"
        >
          {label}
        </Label>
        <div
          className="flex w-full items-center rounded-md border border-input bg-transparent shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
          data-testid="topic-sampling-control"
        >
          <Input
            id={inputId}
            aria-label={label}
            type="number"
            min={1}
            max={100}
            step={1}
            value={sample.percent}
            className="h-9 w-14 flex-1 border-0 bg-transparent px-2 text-right text-sm shadow-none focus-visible:ring-0"
            onChange={(event) => {
              onCorpusSampleChange(index, { percent: event.target.value });
            }}
            onBlur={(event) => {
              onCorpusSampleChange(index, {
                percent: String(sanitizeSamplePercent(event.currentTarget.value)),
              });
            }}
          />
          <span className="pr-2 text-sm text-muted-foreground">%</span>
        </div>
      </div>
    );
  };

  return (
    <AnalysisCardLayout
      title="Topic Modelling"
      info={{
        targetKey: 'topic-modeling.overview',
        label: 'About Topic Modelling',
        tooltip: 'Learn what topic modelling is and how it can help you.',
      }}
      actions={{
        onRunAll: onRun,
        onStop,
        onClear,
        runAllDisabled:
          parametersLocked || actionState.runDisabled || isRunning || hasMissingColumns,
        runAllDisabledReason: hasMissingColumns
          ? 'Select a column for each data block'
          : actionState.runDisabledReason,
        clearDisabled: actionState.clearDisabled || isClearing,
        clearDisabledReason: actionState.clearDisabledReason,
        isRunningAll: isRunning,
        isStopping,
        isClearing,
        hasResult,
        runAllLabel: 'Run',
      }}
      actionsGuidanceTarget="topic-modeling-actions"
      parametersLocked={parametersLocked}
    >
      <NodeInputsPanel
        guidanceTarget="topic-modeling-inputs"
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
        defaultPalette={defaultPalette}
        nodeColors={nodeColors}
        onNodeColorChange={onNodeColorChange}
        columnAddonWidth="auto"
        renderColumnAddon={renderSamplingInput}
      />

      <div className="mt-4 px-3">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[11rem] space-y-1">
            <Label
              htmlFor="topic-segmentation-method"
              className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-muted-foreground"
            >
              Segmentation method
              <span
                aria-label="Segmentation method controls which text spans become Topic Segments"
                title="Automatic packs nearby text and may overlap boundaries. Paragraph uses each non-empty line. Sentence uses Unicode sentence boundaries."
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
              >
                <CircleHelp className="h-4 w-4" />
              </span>
            </Label>
            <Select
              value={segmentationMethod}
              onValueChange={(value) => {
                onSegmentationMethodChange(value as TopicSegmentationMethod);
              }}
            >
              <SelectTrigger
                id="topic-segmentation-method"
                aria-label="Segmentation method"
                className="h-9 w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="automatic">Automatic</SelectItem>
                <SelectItem value="paragraph">Paragraph</SelectItem>
                <SelectItem value="sentence">Sentence</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-[12rem] space-y-1">
            <Label
              htmlFor="topic-max-segment-tokens"
              className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-muted-foreground"
            >
              Maximum tokens per segment
              <span
                aria-label="Tokens are model units and may be words or parts of words"
                title="Sets the largest Topic Segment from 32 to 510 model tokens. Oversized Paragraph and Sentence segments keep their beginning and report truncation after the run."
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
              >
                <CircleHelp className="h-4 w-4" />
              </span>
            </Label>
            <Input
              id="topic-max-segment-tokens"
              aria-label="Maximum tokens per segment"
              type="number"
              min={32}
              max={510}
              step={1}
              value={maxSegmentTokensValueDraft}
              className="h-9 w-full px-2 text-right text-sm"
              onChange={(event) => {
                setMaxSegmentTokensDraft({
                  source: maxSegmentTokens,
                  value: event.target.value,
                });
              }}
              onBlur={handleMaxSegmentTokensBlur}
            />
          </div>

          <div className="min-w-[11rem] space-y-1">
            <Label
              htmlFor="topic-min-cluster-size"
              className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-muted-foreground"
            >
              Min topic size
              <span
                aria-label="Min topic size controls the smallest number of Topic Segments that can form a natural topic"
                title="Sets the HDBSCAN minimum topic size for the initial run. Smaller values can produce more natural topics. Changing it requires running a new analysis; Number of topics only merges the resulting topics."
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
              >
                <CircleHelp className="h-4 w-4" />
              </span>
            </Label>
            <Input
              id="topic-min-cluster-size"
              aria-label="Min topic size"
              type="number"
              min={2}
              step={1}
              value={minClusterSizeValueDraft}
              className="h-9 w-full px-2 text-right text-sm"
              onChange={(event) => {
                setMinClusterSizeDraft({
                  source: minClusterSize,
                  value: event.target.value,
                });
              }}
              onBlur={handleMinClusterSizeBlur}
            />
          </div>

          {/* Random seed */}
          <div className="min-w-[9rem] space-y-1">
            <Label
              htmlFor="random-seed"
              className="block whitespace-nowrap text-xs font-medium text-muted-foreground"
            >
              Random Seed
            </Label>
            <Input
              id="random-seed"
              type="number"
              min={0}
              step={1}
              value={randomSeed}
              className={`h-9 w-full text-right text-sm${!randomSeedUserSet ? ' text-muted-foreground' : ''}`}
              onChange={(e) => {
                onRandomSeedChange(Math.max(0, Number(e.target.value) || 0));
              }}
            />
          </div>
        </div>
      </div>
    </AnalysisCardLayout>
  );
}
