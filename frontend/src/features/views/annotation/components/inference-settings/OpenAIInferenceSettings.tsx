import { ReasoningField, TemperatureField } from './InferenceControlFields';

interface OpenAIInferenceSettingsProps {
  temperature: number;
  onTemperatureCommit: (value: number) => void;
  reasoningEnabled: boolean;
  onReasoningEnabledChange: (enabled: boolean) => void;
  reasoningEffort: string;
  onReasoningEffortChange: (effort: string) => void;
  disabled?: boolean;
}

export function OpenAIInferenceSettings({
  temperature,
  onTemperatureCommit,
  reasoningEnabled,
  onReasoningEnabledChange,
  reasoningEffort,
  onReasoningEffortChange,
  disabled,
}: OpenAIInferenceSettingsProps) {
  return (
    <section aria-labelledby="openai-inference-settings" className="space-y-4">
      <div className="space-y-0.5">
        <h3 id="openai-inference-settings" className="text-body font-medium">
          OpenAI parameters
        </h3>
        <p className="text-label-secondary text-description">
          Sampling and reasoning support depends on the selected OpenAI model.
        </p>
      </div>
      <TemperatureField
        temperature={temperature}
        onTemperatureCommit={onTemperatureCommit}
        description="Used by sampling models and omitted whenever reasoning is enabled."
        disabled={disabled}
      />
      <ReasoningField
        reasoningEnabled={reasoningEnabled}
        onReasoningEnabledChange={onReasoningEnabledChange}
        reasoningEffort={reasoningEffort}
        onReasoningEffortChange={onReasoningEffortChange}
        label="Reasoning"
        toggleLabel="Toggle reasoning"
        effortLabel="Reasoning effort"
        description="Send the selected model its native reasoning effort when supported."
        disabled={disabled}
      />
    </section>
  );
}
