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
