import { ReasoningField, TemperatureField } from './InferenceControlFields';

interface CustomInferenceSettingsProps {
  temperature: number;
  onTemperatureCommit: (value: number) => void;
  reasoningEnabled: boolean;
  onReasoningEnabledChange: (enabled: boolean) => void;
  reasoningEffort: string;
  onReasoningEffortChange: (effort: string) => void;
  disabled?: boolean;
}

export function CustomInferenceSettings({
  temperature,
  onTemperatureCommit,
  reasoningEnabled,
  onReasoningEnabledChange,
  reasoningEffort,
  onReasoningEffortChange,
  disabled,
}: CustomInferenceSettingsProps) {
  return (
    <section aria-labelledby="custom-inference-settings" className="space-y-4">
      <div className="space-y-0.5">
        <h3 id="custom-inference-settings" className="text-body font-medium">
          Custom endpoint parameters
        </h3>
        <p className="text-label-secondary text-description">
          These controls use the endpoint&apos;s OpenAI-compatible Chat Completions contract.
        </p>
      </div>
      <TemperatureField
        temperature={temperature}
        onTemperatureCommit={onTemperatureCommit}
        description="Use when the selected endpoint and model support temperature."
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
        description="Request a reasoning effort only when the endpoint implements that extension."
        disabled={disabled}
      />
    </section>
  );
}
