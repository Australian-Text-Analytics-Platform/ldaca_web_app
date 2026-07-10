import { useState, type FocusEvent } from 'react';
import { CircleHelp } from 'lucide-react';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AnalysisCardLayout } from '@/features/views/common/components/AnalysisCardLayout';
import {
  NodeInputsPanel,
  type NodeInputColumnAddonArgs,
} from '@/features/views/common/components/NodeInputsPanel';
import type { UseTabNodeInputsResult } from '@/features/views/common/nodeInputs';
import {
  effectiveSampleDocumentCount,
  sanitizeSamplePercent,
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
    runLabel: string;
    runDisabledReason?: string;
  };
  corpusSamples: CorpusSample[];
  nodeDocCounts: number[];
  onCorpusSampleChange: (idx: number, update: Partial<CorpusSample>) => void;
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
  /**
   * When locked, the maximum display value the user can pick for "Words per
   * topic" without re-running — the originally-fitted count. `null` means
   * unlocked (no server-side cap).
   */
  representativeWordsCountServerMax?: number | null;
  /** Override for the tooltip on the locked "Words per topic" input. */
  representativeWordsCountLockedReason?: string;
  onRepresentativeWordsCountChange: (value: number) => void;
  isRunning: boolean;
  isStopping?: boolean;
  isClearing: boolean;
  onRun: () => void | Promise<void>;
  onStop?: () => void | Promise<void>;
  onClear: () => void | Promise<void>;
  hasMissingColumns: boolean;
  resultState?: string;
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
  representativeWordsCountServerMax = null,
  representativeWordsCountLockedReason,
  onRepresentativeWordsCountChange,
  isRunning,
  isStopping,
  isClearing,
  onRun,
  onStop,
  onClear,
  hasMissingColumns,
  resultState,
}: Props) {
  const [topicSizeDraft, setTopicSizeDraft] = useState<NumericInputDraft>(() => ({
    source: topicSizeValue,
    value: String(topicSizeValue),
  }));
  const topicSizeValueDraft =
    topicSizeDraft.source === topicSizeValue ? topicSizeDraft.value : String(topicSizeValue);
  // Called by: topic-size input change handler while preserving placeholder/user-set semantics.
  const setTopicSizeValueDraft = (value: string) => {
    setTopicSizeDraft({ source: topicSizeValue, value });
  };

  // Called by: topic-size input blur handler to commit bounded integer values.
  const handleTopicSizeValueBlur = (event: FocusEvent<HTMLInputElement>) => {
    const raw = Number(event.currentTarget.value);
    const next = Math.max(2, isNaN(raw) ? 2 : Math.round(raw));
    setTopicSizeDraft({ source: next, value: String(next) });
    onTopicSizeValueChange(next); // always call — even unchanged — to solidify grey placeholder
  };

  const [representativeWordsDraft, setRepresentativeWordsDraft] = useState<NumericInputDraft>(
    () => ({
      source: representativeWordsCount,
      value: String(representativeWordsCount),
    }),
  );
  const representativeWordsCountDraft =
    representativeWordsDraft.source === representativeWordsCount
      ? representativeWordsDraft.value
      : String(representativeWordsCount);
  // Called by: words-per-topic input change handler before validation on blur.
  const setRepresentativeWordsCountDraft = (value: string) => {
    setRepresentativeWordsDraft({ source: representativeWordsCount, value });
  };

  // Backend now fits with at least 50 representative words and serves up to
  // 2× the originally-fitted count, so post-fit we can let the user scale
  // up without rerunning. Pre-fit cap stays at 50 since there's no fitted
  // count to double yet.
  const representativeWordsCountCap = representativeWordsCountServerMax
    ? Math.max(50, 2 * representativeWordsCountServerMax)
    : 50;

  // Called by: words-per-topic input blur handler to commit within the backend-supported cap.
  const handleRepresentativeWordsCountBlur = (event: FocusEvent<HTMLInputElement>) => {
    const raw = Number(event.currentTarget.value);
    const rounded = Number.isFinite(raw) ? Math.round(raw) : 3;
    const clamped = Math.min(representativeWordsCountCap, Math.max(3, rounded));
    setRepresentativeWordsDraft({ source: clamped, value: String(clamped) });
    onRepresentativeWordsCountChange(clamped);
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
      title="Topic Modelling - BERTopic"
      info={{
        targetKey: 'topic-modeling.overview',
        label: 'About Topic Modeling',
        tooltip: 'Learn what topic modeling is and how it can help you.',
      }}
      actions={{
        onRun,
        onStop,
        onClear,
        runDisabled: actionState.runDisabled || isRunning || hasMissingColumns,
        runDisabledReason: hasMissingColumns
          ? 'Select a column for each data block'
          : actionState.runDisabledReason,
        clearDisabled: actionState.clearDisabled || isClearing,
        isRunning,
        isStopping,
        isClearing,
        hasResult: resultState === 'successful' || resultState === 'failed',
        runLabel: actionState.runLabel,
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
        defaultPalette={defaultPalette}
        nodeColors={nodeColors}
        onNodeColorChange={onNodeColorChange}
        columnAddonWidth="auto"
        renderColumnAddon={renderSamplingInput}
      />

      {showSamplingWarning && (
        <p className="mx-3 mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs leading-tight text-amber-700">
          Sampled corpus may be too small for the target topic count.
        </p>
      )}

      <div className="mt-4 px-3">
        <div className="flex flex-wrap items-end gap-4">
          {/* Minimum topic size (HDBSCAN min cluster size) */}
          <div className="min-w-[11rem] space-y-1">
            <Label
              htmlFor="topic-size-value"
              className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-muted-foreground"
            >
              Minimum topic size
              <span
                aria-label="Minimum topic size is the smallest number of documents that can form a topic; smaller values yield more, finer-grained topics"
                title="Minimum topic size is the smallest number of documents that can form a topic. Smaller values yield more, finer-grained topics; the total number of topics is determined automatically."
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
              >
                <CircleHelp className="h-4 w-4" />
              </span>
            </Label>
            <Input
              id="topic-size-value"
              aria-label="Minimum topic size"
              type="number"
              min={2}
              step={1}
              value={topicSizeValueDraft}
              title={
                topicSizeWarning === 'red'
                  ? 'Fewer than 3 documents per topic — results will likely be unusable'
                  : topicSizeWarning === 'orange'
                    ? 'Fewer than 10 documents per topic — topics may be noisy or unstable'
                    : undefined
              }
              className={`h-9 w-full px-2 text-right text-sm${
                topicSizeWarning === 'red'
                  ? ' text-red-500'
                  : topicSizeWarning === 'orange'
                    ? ' text-orange-500'
                    : !topicSizeUserSet
                      ? ' text-muted-foreground'
                      : ''
              }`}
              onChange={(e) => {
                setTopicSizeValueDraft(e.target.value);
              }}
              onBlur={handleTopicSizeValueBlur}
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

          {/* Words per topic */}
          <div className="min-w-[10rem] space-y-1">
            <Label
              htmlFor="representative-words-count"
              className="block whitespace-nowrap text-xs font-medium text-muted-foreground"
            >
              Words per topic
            </Label>
            <DisabledReasonTooltip
              reason={
                representativeWordsCountServerMax
                  ? (representativeWordsCountLockedReason ??
                    `Adjustable up to ${String(representativeWordsCountCap)} after modelling. Clear Results to fit with a higher count.`)
                  : undefined
              }
            >
              <Input
                id="representative-words-count"
                type="number"
                min={3}
                max={representativeWordsCountCap}
                step={1}
                value={representativeWordsCountDraft}
                className={`h-9 w-full text-right text-sm${!representativeWordsCountUserSet ? ' text-muted-foreground' : ''}`}
                onChange={(e) => {
                  setRepresentativeWordsCountDraft(e.target.value);
                }}
                onBlur={handleRepresentativeWordsCountBlur}
              />
            </DisabledReasonTooltip>
          </div>
        </div>
      </div>
    </AnalysisCardLayout>
  );
}
