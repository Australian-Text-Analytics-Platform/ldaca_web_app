import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

const REASONING_EFFORTS = ['low', 'medium', 'high'] as const;

interface TemperatureFieldProps {
  temperature: number;
  onTemperatureCommit: (value: number) => void;
  description: string;
  disabled?: boolean;
}

export function TemperatureField({
  temperature,
  onTemperatureCommit,
  description,
  disabled,
}: TemperatureFieldProps) {
  return (
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
      <p className="text-label-secondary text-description">{description}</p>
    </div>
  );
}

interface ReasoningFieldProps {
  reasoningEnabled: boolean;
  onReasoningEnabledChange: (enabled: boolean) => void;
  reasoningEffort: string;
  onReasoningEffortChange: (effort: string) => void;
  label: string;
  toggleLabel: string;
  effortLabel: string;
  description: string;
  disabled?: boolean;
}

export function ReasoningField({
  reasoningEnabled,
  onReasoningEnabledChange,
  reasoningEffort,
  onReasoningEffortChange,
  label,
  toggleLabel,
  effortLabel,
  description,
  disabled,
}: ReasoningFieldProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <Label htmlFor="annotation-ai-reasoning">{label}</Label>
          <p className="text-label-secondary text-description">{description}</p>
        </div>
        <Switch
          id="annotation-ai-reasoning"
          checked={reasoningEnabled}
          disabled={disabled}
          aria-label={toggleLabel}
          onCheckedChange={onReasoningEnabledChange}
        />
      </div>

      {reasoningEnabled ? (
        <div className="space-y-1.5">
          <Label htmlFor="annotation-ai-reasoning-effort">{effortLabel}</Label>
          <Select
            value={reasoningEffort}
            disabled={disabled}
            onValueChange={onReasoningEffortChange}
          >
            <SelectTrigger
              id="annotation-ai-reasoning-effort"
              aria-label={effortLabel}
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
