/**
 * Collapsible "Model Configuration" section for the Annotation tab's AI mode.
 *
 * Rendered by: AnnotationFeature, injected as a child of AnnotationAiSettings
 * directly under the Prompt editor. It surfaces the provider-level inference
 * knobs that are separate from prompt/model *content*: the sampling temperature
 * and an optional reasoning toggle with a thinking-effort level.
 *
 * Why it exists: temperature and reasoning are advanced, provider-specific knobs
 * most users leave at their defaults (temperature 0, reasoning off), so they live
 * behind a collapsed disclosure to keep the common path uncluttered while still
 * flowing through to `/annotation/ai/*` (the backend maps effort onto each
 * provider's native reasoning control).
 *
 * Persistence: the parent owns the values (persisted per-tab like model/prompt),
 * so this component is controlled. Temperature commits on blur (it doubles as a
 * typed field, matching the model/API-key save-on-blur pattern) after clamping to
 * the [0, 2] range every provider accepts; the reasoning switch and effort select
 * are discrete actions that commit on change.
 *
 * Locking: when the parameter panel is locked (`disabled`), the disclosure still
 * opens/closes so users can *inspect* the settings a run is using — only the inner
 * inputs (temperature, reasoning switch, effort) go read-only. The trigger itself
 * is therefore never disabled.
 */
import { ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
    <Collapsible defaultOpen={false} className="rounded-lg border bg-background/60">
      <CollapsibleTrigger
        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-hidden [&[data-state=open]>svg]:rotate-180"
      >
        Model Configuration
        <ChevronDown className="size-3.5 transition-transform duration-200" aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-4 border-t px-3 py-3">
          <div className="space-y-1.5">
            <Label htmlFor="annotation-ai-temperature">Temperature</Label>
            <Input
              // Uncontrolled + re-seeded via key on external change (hydration /
              // clamp-on-commit), mirroring the API-key field; blur commits the
              // parsed, clamped value so partial edits like "0." don't churn state.
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
      </CollapsibleContent>
    </Collapsible>
  );
}

export default AnnotationInferenceSettings;
