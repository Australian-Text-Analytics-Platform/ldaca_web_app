import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface AnnotationRunAllSettingsProps {
  maxRetriesPerBatch: number;
  onMaxRetriesPerBatchCommit: (value: number) => void;
  batchSize: number;
  onBatchSizeCommit: (value: number) => void;
  processingMode: 'reprocess_all' | 'fill_missing';
  onProcessingModeChange: (value: 'reprocess_all' | 'fill_missing') => void;
  disabled?: boolean;
}

/** Wordflow-owned batching and write behavior shared by every Annotation provider. */
export function AnnotationRunAllSettings({
  maxRetriesPerBatch,
  onMaxRetriesPerBatchCommit,
  batchSize,
  onBatchSizeCommit,
  processingMode,
  onProcessingModeChange,
  disabled,
}: AnnotationRunAllSettingsProps) {
  return (
    <section aria-labelledby="annotation-run-all-settings" className="space-y-4">
      <div className="space-y-0.5">
        <h3 id="annotation-run-all-settings" className="text-body font-medium">
          Run All controls
        </h3>
        <p className="text-label-secondary text-description">
          These controls belong to Wordflow and apply to every provider.
        </p>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-body font-medium">Run All processing</legend>
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
        <p className="text-label-secondary text-description">
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
        <p className="text-label-secondary text-description">
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
        <p className="text-label-secondary text-description">
          Retry each failed LLM batch up to this many times (default 2; 3 tries total). 0 disables
          retries.
        </p>
      </div>
    </section>
  );
}
