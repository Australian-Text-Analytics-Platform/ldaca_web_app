import { ReasoningField } from './InferenceControlFields';

interface AnthropicInferenceSettingsProps {
  reasoningEnabled: boolean;
  onReasoningEnabledChange: (enabled: boolean) => void;
  reasoningEffort: string;
  onReasoningEffortChange: (effort: string) => void;
  disabled?: boolean;
}

/** Claude-native settings. Sampling is intentionally not part of this component contract. */
export function AnthropicInferenceSettings({
  reasoningEnabled,
  onReasoningEnabledChange,
  reasoningEffort,
  onReasoningEffortChange,
  disabled,
}: AnthropicInferenceSettingsProps) {
  return (
    <section aria-labelledby="anthropic-inference-settings" className="space-y-4">
      <div className="space-y-0.5">
        <h3 id="anthropic-inference-settings" className="text-body font-medium">
          Anthropic parameters
        </h3>
        <p className="text-label-secondary text-description">
          Claude uses native thinking controls and leaves sampling at the provider default.
        </p>
      </div>
      <ReasoningField
        reasoningEnabled={reasoningEnabled}
        onReasoningEnabledChange={onReasoningEnabledChange}
        reasoningEffort={reasoningEffort}
        onReasoningEffortChange={onReasoningEffortChange}
        label="Thinking"
        toggleLabel="Toggle thinking"
        effortLabel="Thinking effort"
        description="Use adaptive thinking on current Claude models and fixed-budget thinking on older models."
        disabled={disabled}
      />
    </section>
  );
}
