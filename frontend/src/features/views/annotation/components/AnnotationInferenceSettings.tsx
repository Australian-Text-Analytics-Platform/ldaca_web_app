import type { AnnotationProviderType } from '../aiProviders';
import { AnnotationRunAllSettings } from './inference-settings/AnnotationRunAllSettings';
import { AnthropicInferenceSettings } from './inference-settings/AnthropicInferenceSettings';
import { CustomInferenceSettings } from './inference-settings/CustomInferenceSettings';
import { GoogleInferenceSettings } from './inference-settings/GoogleInferenceSettings';
import { OpenAIInferenceSettings } from './inference-settings/OpenAIInferenceSettings';
import { OpenRouterInferenceSettings } from './inference-settings/OpenRouterInferenceSettings';
import { UnconfiguredInferenceSettings } from './inference-settings/UnconfiguredInferenceSettings';

interface AnnotationInferenceSettingsProps {
  provider: AnnotationProviderType | null;
  temperature: number;
  onTemperatureCommit: (value: number) => void;
  maxRetriesPerBatch: number;
  onMaxRetriesPerBatchCommit: (value: number) => void;
  batchSize: number;
  onBatchSizeCommit: (value: number) => void;
  processingMode: 'reprocess_all' | 'fill_missing';
  onProcessingModeChange: (value: 'reprocess_all' | 'fill_missing') => void;
  reasoningEnabled: boolean;
  onReasoningEnabledChange: (enabled: boolean) => void;
  reasoningEffort: string;
  onReasoningEffortChange: (effort: string) => void;
  disabled?: boolean;
}

/** Routes persisted settings into one provider-owned native panel plus shared Run All controls. */
export function AnnotationInferenceSettings({
  provider,
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
  const reasoningProps = {
    reasoningEnabled,
    onReasoningEnabledChange,
    reasoningEffort,
    onReasoningEffortChange,
    disabled,
  };
  const samplingProps = {
    ...reasoningProps,
    temperature,
    onTemperatureCommit,
  };

  let providerPanel;
  switch (provider) {
    case 'anthropic':
      providerPanel = <AnthropicInferenceSettings {...reasoningProps} />;
      break;
    case 'google':
      providerPanel = <GoogleInferenceSettings {...samplingProps} />;
      break;
    case 'openai':
      providerPanel = <OpenAIInferenceSettings {...samplingProps} />;
      break;
    case 'openrouter':
      providerPanel = <OpenRouterInferenceSettings {...samplingProps} />;
      break;
    case 'custom':
      providerPanel = <CustomInferenceSettings {...samplingProps} />;
      break;
    default:
      providerPanel = <UnconfiguredInferenceSettings />;
  }

  return (
    <div className="space-y-6">
      {providerPanel}
      <AnnotationRunAllSettings
        maxRetriesPerBatch={maxRetriesPerBatch}
        onMaxRetriesPerBatchCommit={onMaxRetriesPerBatchCommit}
        batchSize={batchSize}
        onBatchSizeCommit={onBatchSizeCommit}
        processingMode={processingMode}
        onProcessingModeChange={onProcessingModeChange}
        disabled={disabled}
      />
    </div>
  );
}
