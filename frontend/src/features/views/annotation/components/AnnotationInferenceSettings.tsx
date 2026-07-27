import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Effort levels offered by the thinking-effort select, ordered low→high. */
const REASONING_EFFORTS = ['low', 'medium', 'high'] as const;

interface AnnotationInferenceSettingsProps {
  /** Sampling temperature (0–2); the field seeds from and clamps to this. */
  temperature: number;
  /** Persist the clamped temperature (called on blur). */
  onTemperatureCommit: (value: number) => void;
  /** Maximum automatic retries after the initial request for each batch. */
  maxRetriesPerBatch: number;
  onMaxRetriesPerBatchCommit: (value: number) => void;
  /** Rows sent in each Run All provider request. */
  batchSize: number;
  onBatchSizeCommit: (value: number) => void;
  /** Whether Run All replaces every label or only fills blank annotations. */
  processingMode: 'reprocess_all' | 'fill_missing';
  onProcessingModeChange: (value: 'reprocess_all' | 'fill_missing') => void;
  /** Whether reasoning/thinking is requested; hides the effort control when off. */
  reasoningEnabled: boolean;
  onReasoningEnabledChange: (enabled: boolean) => void;
  /** Thinking effort level ('low' | 'medium' | 'high'), only used when enabled. */
  reasoningEffort: string;
  onReasoningEffortChange: (effort: string) => void;
  disabled?: boolean;
}

export function AnnotationInferenceSettings({
  temperature,
  onTemperatureCommit,
  maxRetriesPerBatch,
  onMaxRetriesPerBatchCommit,
  batchSize,
  onBatchSizeCommit,
  processingMode,
  onProcessingModeChange,
  reasoningEnabled,
  onReasoningEnabledChange,
  reasoningEffort,
  onReasoningEffortChange,
  disabled,
}: AnnotationInferenceSettingsProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="annotation-ai-temperature">Temperature</Label>
        <Input
          key={`annotation-ai-temperature-${String(temperature)}`}
          id="annotation-ai-temperature"
          type="number"
          min={0}
          max={2}
          step={0.1}
          defaultValue={String(temperature)}
          disabled={disabled}
          className="w-28"
          onBlur={(event) => {
            const parsed = Number(event.target.value);
            const safe = Number.isFinite(parsed) ? parsed : 0;
            onTemperatureCommit(Math.min(2, Math.max(0, safe)));
          }}
        />
        <p className="text-xs text-muted-foreground">
          0 is deterministic; higher values add randomness (max 2).
        </p>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Run All processing</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Label className="flex cursor-pointer items-center gap-2 font-normal">
            <input
              type="radio"
              name="annotation-ai-processing-mode"
              value="reprocess_all"
              checked={processingMode === 'reprocess_all'}
              disabled={disabled}
              className="size-4 accent-primary"
              onChange={() => {
                onProcessingModeChange('reprocess_all');
              }}
            />
            Reprocess all rows
          </Label>
          <Label className="flex cursor-pointer items-center gap-2 font-normal">
            <input
              type="radio"
              name="annotation-ai-processing-mode"
              value="fill_missing"
              checked={processingMode === 'fill_missing'}
              disabled={disabled}
              className="size-4 accent-primary"
              onChange={() => {
                onProcessingModeChange('fill_missing');
              }}
            />
            Fill missing only
          </Label>
        </div>
        <p className="text-xs text-muted-foreground">
          Reprocess replaces the annotation column; fill missing preserves existing labels.
        </p>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="annotation-ai-batch-size">Batch size</Label>
        <Input
          key={`annotation-ai-batch-size-${String(batchSize)}`}
          id="annotation-ai-batch-size"
          type="number"
          min={1}
          max={100}
          step={1}
          defaultValue={String(batchSize)}
          disabled={disabled}
          className="w-28"
          onBlur={(event) => {
            const parsed = Number(event.target.value);
            const safe = Number.isFinite(parsed) ? Math.trunc(parsed) : 20;
            onBatchSizeCommit(Math.min(100, Math.max(1, safe)));
          }}
        />
        <p className="text-xs text-muted-foreground">
          Rows sent in each Run All LLM request (default 20, max 100).
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="annotation-ai-max-retries-per-batch">Max retries per batch</Label>
        <Input
          key={`annotation-ai-max-retries-per-batch-${String(maxRetriesPerBatch)}`}
          id="annotation-ai-max-retries-per-batch"
          type="number"
          min={0}
          max={10}
          step={1}
          defaultValue={String(maxRetriesPerBatch)}
          disabled={disabled}
          className="w-28"
          onBlur={(event) => {
            const parsed = Number(event.target.value);
            const safe = Number.isFinite(parsed) ? Math.trunc(parsed) : 2;
            onMaxRetriesPerBatchCommit(Math.min(10, Math.max(0, safe)));
          }}
        />
        <p className="text-xs text-muted-foreground">
          Retry each failed LLM batch up to this many times (default 2; 3 tries total). 0 disables
          retries.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <Label htmlFor="annotation-ai-reasoning">Reasoning</Label>
          <p className="text-xs text-muted-foreground">
            Let the model think before answering (reasoning models only).
          </p>
        </div>
        <Switch
          id="annotation-ai-reasoning"
          checked={reasoningEnabled}
          disabled={disabled}
          aria-label="Toggle reasoning"
          onCheckedChange={onReasoningEnabledChange}
        />
      </div>

      {reasoningEnabled ? (
        <div className="space-y-1.5">
          <Label htmlFor="annotation-ai-reasoning-effort">Thinking effort</Label>
          <Select
            value={reasoningEffort}
            disabled={disabled}
            onValueChange={onReasoningEffortChange}
          >
            <SelectTrigger
              id="annotation-ai-reasoning-effort"
              aria-label="Thinking effort"
              className="w-full"
            >
              <SelectValue placeholder="Select effort" />
            </SelectTrigger>
            <SelectContent>
              {REASONING_EFFORTS.map((effort) => (
                <SelectItem key={effort} value={effort} className="capitalize">
                  {effort}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  );
}
