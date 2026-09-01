import { ReasoningField, TemperatureField } from './InferenceControlFields';

interface GoogleInferenceSettingsProps {
  temperature: number;
  onTemperatureCommit: (value: number) => void;
  reasoningEnabled: boolean;
  onReasoningEnabledChange: (enabled: boolean) => void;
  reasoningEffort: string;
  onReasoningEffortChange: (effort: string) => void;
  disabled?: boolean;
}

export function GoogleInferenceSettings({
  temperature,
  onTemperatureCommit,
  reasoningEnabled,
  onReasoningEnabledChange,
  reasoningEffort,
  onReasoningEffortChange,
  disabled,
}: GoogleInferenceSettingsProps) {
  return (
    <section aria-labelledby="google-inference-settings" className="space-y-4">
      <div className="space-y-0.5">
        <h3 id="google-inference-settings" className="text-body font-medium">
          Google parameters
        </h3>
        <p className="text-label-secondary text-description">
          Gemini accepts temperature alongside its native thinking budget.
        </p>
      </div>
      <TemperatureField
        temperature={temperature}
        onTemperatureCommit={onTemperatureCommit}
        description="Lower values are more consistent; higher values add randomness. Model support varies."
        disabled={disabled}
      />
      <ReasoningField
        reasoningEnabled={reasoningEnabled}
        onReasoningEnabledChange={onReasoningEnabledChange}
        reasoningEffort={reasoningEffort}
        onReasoningEffortChange={onReasoningEffortChange}
        label="Thinking"
        toggleLabel="Toggle thinking"
        effortLabel="Thinking effort"
        description="Add a Gemini thinking budget before the answer."
        disabled={disabled}
      />
    </section>
  );
}
