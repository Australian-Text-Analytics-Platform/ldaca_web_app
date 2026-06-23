import { useState, type FocusEvent } from 'react';
import { CircleHelp } from 'lucide-react';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import HelpIcon from '@/components/help/HelpIcon';
import { AnalysisCardLayout } from '@/features/views/common/components/AnalysisCardLayout';
import { NodeInputsPanel } from '@/features/views/common/components/NodeInputsPanel';
import { VIZ_PALETTE } from '@/features/views/common';
import type { UseTabNodeInputsResult } from '@/features/views/common/nodeInputs';

export interface CorpusSample {
  percent: string;
  enabled: boolean;
}

interface NumericInputDraft {
  source: number;
  value: string;
}

interface Props {
  nodeInputs: UseTabNodeInputsResult;
  onColumnChange: (nodeId: string, column: string) => void;
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
 * Rendered by: TopicModelingFeature to show the topic-modeling parameter form and shared actions because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * Flow: derive display state, bind user actions, then render the analysis UI.
 */
export function TopicModelingParameterPanel({
  nodeInputs,
  onColumnChange,
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
  const selectedNodes = nodeInputs.selectedNodes;
  const [topicSizeDraft, setTopicSizeDraft] = useState<NumericInputDraft>(() => ({
    source: topicSizeValue,
    value: String(topicSizeValue),
  }));
  const topicSizeValueDraft =
    topicSizeDraft.source === topicSizeValue ? topicSizeDraft.value : String(topicSizeValue);
  // Called by: topic-size input change handler while preserving placeholder/user-set semantics because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
  const setTopicSizeValueDraft = (value: string) => {
    setTopicSizeDraft({ source: topicSizeValue, value });
  };

  // Called by: topic-size input blur handler to commit bounded integer values because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
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
  // Called by: words-per-topic input change handler before validation on blur because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
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

  // Called by: words-per-topic input blur handler to commit within the backend-supported cap because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
  const handleRepresentativeWordsCountBlur = (event: FocusEvent<HTMLInputElement>) => {
    const raw = Number(event.currentTarget.value);
    const rounded = Number.isFinite(raw) ? Math.round(raw) : 3;
    const clamped = Math.min(representativeWordsCountCap, Math.max(3, rounded));
    setRepresentativeWordsDraft({ source: clamped, value: String(clamped) });
    onRepresentativeWordsCountChange(clamped);
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
      />

      <div className="mt-4 grid grid-cols-2 gap-6">
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
            const color = nodeId ? (VIZ_PALETTE[idx % VIZ_PALETTE.length] ?? '#6b7280') : '#9ca3af';
            const nDocs = nodeDocCounts[idx] ?? 0;

            // When unchecked: display 100 and show full doc count
            const displayPercent = sample.enabled ? sample.percent : '100';
            const effectiveDocs = sample.enabled
              ? Math.max(
                  1,
                  Math.round(
                    (nDocs * Math.min(100, Math.max(1, Number(sample.percent) || 100))) / 100,
                  ),
                )
              : nDocs;

            if (!node) {
              // Placeholder row — same height as a real row, no interaction
              return (
                <div
                  key={`placeholder-${String(idx)}`}
                  className="flex items-center gap-2 opacity-25"
                  style={{ minHeight: '2rem' }}
                >
                  <div
                    className="h-5 w-5 shrink-0 rounded-full border-2"
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
                  onClick={() => {
                    onCorpusSampleChange(idx, { enabled: !sample.enabled });
                  }}
                  aria-label={sample.enabled ? 'Disable sampling' : 'Enable sampling'}
                  className="h-5 w-5 shrink-0 rounded-full border-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                  style={{
                    backgroundColor: sample.enabled ? color : 'transparent',
                    borderColor: color,
                  }}
                />

                <span
                  className={`text-sm font-medium${sample.enabled ? '' : ' text-muted-foreground'}`}
                >
                  Random
                </span>

                {/* % input — vertically aligned across rows by identical prefix */}
                <Input
                  aria-label={`Sampling percentage for corpus ${String(idx + 1)}`}
                  type="number"
                  min={1}
                  max={100}
                  step={10}
                  value={displayPercent}
                  disabled={!sample.enabled}
                  className="h-8 w-14 shrink-0 px-1.5 text-center text-sm"
                  onChange={(e) => {
                    onCorpusSampleChange(idx, { percent: e.target.value });
                  }}
                  onBlur={(e) => {
                    const raw = Number(e.target.value);
                    const clamped = Math.min(100, Math.max(1, isNaN(raw) ? 1 : Math.round(raw)));
                    onCorpusSampleChange(idx, { percent: String(clamped) });
                  }}
                />

                <span className="text-sm font-medium">%</span>

                {nDocs > 0 && (
                  <span className="text-sm font-medium">
                    {`→ ~`}
                    <span style={{ color }}>{effectiveDocs.toLocaleString()}</span>
                    {` documents`}
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
          <div className="flex items-center gap-1.5">
            <Label className="text-sm font-medium">Topic Modelling Options</Label>
            <HelpIcon targetKey="analysis.topic-modeling.options" />
          </div>

          {/* Row 1: minimum topic size (HDBSCAN min cluster size) */}
          <div className="flex items-center justify-between gap-2">
            <Label
              htmlFor="topic-size-value"
              className="flex min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap pl-3 text-sm"
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
              className={`h-8 w-24 shrink-0 px-2 text-right text-sm${
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
              onChange={(e) => {
                onRandomSeedChange(Math.max(0, Number(e.target.value) || 0));
              }}
            />
          </div>

          {/* Row 3: words per topic */}
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="representative-words-count" className="whitespace-nowrap pl-3 text-sm">
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
                className={`h-8 w-24 text-right text-sm${!representativeWordsCountUserSet ? ' text-muted-foreground' : ''}`}
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
