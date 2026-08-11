import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AnnotationExampleSamplingMethod } from '../hooks/useAnnotationTabSettings';

interface AnnotationExampleSamplingControlsProps {
  maxExamplesPerClass: number;
  onMaxExamplesPerClassCommit: (value: number) => void;
  samplingMethod: AnnotationExampleSamplingMethod;
  onSamplingMethodChange: (value: AnnotationExampleSamplingMethod) => void;
  randomSeed: number;
  onRandomSeedCommit: (value: number) => void;
  disabled?: boolean;
}

/**
 * Configures the stable per-class subset drawn from an Example Data Block.
 *
 * Rendered by AnnotationFeature immediately after the optional example selector.
 * The intrinsic grid wraps controls when its card narrows; committing numeric
 * fields normalizes them to the backend's integer boundaries before persistence.
 */
export function AnnotationExampleSamplingControls({
  maxExamplesPerClass,
  onMaxExamplesPerClassCommit,
  samplingMethod,
  onSamplingMethodChange,
  randomSeed,
  onRandomSeedCommit,
  disabled,
}: AnnotationExampleSamplingControlsProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="annotation-ai-max-examples-per-class">Max examples per class</Label>
        <Input
          key={`annotation-ai-max-examples-per-class-${String(maxExamplesPerClass)}`}
          id="annotation-ai-max-examples-per-class"
          type="number"
          min={1}
          step={1}
          defaultValue={String(maxExamplesPerClass)}
          disabled={disabled}
          onBlur={(event) => {
            const parsed = Number(event.target.value);
            const safe = Number.isFinite(parsed) ? Math.trunc(parsed) : 10;
            const normalized = Math.max(1, safe);
            event.currentTarget.value = String(normalized);
            onMaxExamplesPerClassCommit(normalized);
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="annotation-ai-example-sampling-method">Sampling method</Label>
        <Select
          value={samplingMethod}
          disabled={disabled}
          onValueChange={(value) => {
            onSamplingMethodChange(value as AnnotationExampleSamplingMethod);
          }}
        >
          <SelectTrigger id="annotation-ai-example-sampling-method" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="random">Random</SelectItem>
            <SelectItem value="first_n">First N</SelectItem>
            <SelectItem value="last_n">Last N</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {samplingMethod === 'random' ? (
        <div className="space-y-1.5">
          <Label htmlFor="annotation-ai-example-random-seed">Random seed</Label>
          <Input
            key={`annotation-ai-example-random-seed-${String(randomSeed)}`}
            id="annotation-ai-example-random-seed"
            type="number"
            min={0}
            step={1}
            defaultValue={String(randomSeed)}
            disabled={disabled}
            onBlur={(event) => {
              const parsed = Number(event.target.value);
              const safe = Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
              const normalized = Math.max(0, safe);
              event.currentTarget.value = String(normalized);
              onRandomSeedCommit(normalized);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
