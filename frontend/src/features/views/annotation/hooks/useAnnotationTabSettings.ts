import { useState } from 'react';
import type { AnnotationAiProviderId } from '../aiProviders';

export type AnnotationMode = 'manual' | 'ai';

interface UseAnnotationTabSettingsArgs {
  tabSettings?: Record<string, string>;
  onTabSettingChange?: (key: string, value: string) => void;
}

/**
 * Parse a persisted tab-setting string as a provider-card model map.
 *
 * Used by: useAnnotationTabSettings when hydrating the AI provider dropdown.
 * The value lives in tabs.json as a string map because generic tab settings are
 * Record<string,string>; malformed user-edited JSON is ignored with a warning so
 * the tab still opens and the user can save a fresh provider card.
 */
const parseProviderModelSetting = (value: string | undefined): Record<string, string> => {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const models: Record<string, string> = {};
    for (const [key, model] of Object.entries(parsed)) {
      if (typeof model === 'string') models[key] = model;
    }
    return models;
  } catch (error) {
    console.warn('[annotation] Ignoring malformed AI provider model setting:', error);
    return {};
  }
};

/**
 * Owns Annotation's tab-persisted mode and AI settings.
 *
 * Used by: AnnotationFeature so the feature body can focus on selector/run UI
 * while this hook handles tabs.json string hydration and write-through updates.
 * Flow: seed local state from the active tab's string settings, expose setters
 * that mirror discrete user actions, and write each committed value back through
 * AnalysisTabsHost's tab-setting sink.
 */
export function useAnnotationTabSettings({
  tabSettings,
  onTabSettingChange,
}: UseAnnotationTabSettingsArgs = {}) {
  const [annotationMode, setAnnotationModeState] = useState<AnnotationMode>(() =>
    tabSettings?.annotationMode === 'ai' ? 'ai' : 'manual',
  );
  const setAnnotationMode = (mode: AnnotationMode) => {
    setAnnotationModeState(mode);
    onTabSettingChange?.('annotationMode', mode);
  };

  const [aiProviderModels, setAiProviderModelsState] = useState<Record<string, string>>(() =>
    parseProviderModelSetting(tabSettings?.aiProviderModels),
  );
  const [aiProvider, setAiProviderState] = useState<AnnotationAiProviderId>(
    () => tabSettings?.aiProvider ?? '',
  );
  const [aiModel, setAiModel] = useState(() => {
    const providerModels = parseProviderModelSetting(tabSettings?.aiProviderModels);
    const providerId = tabSettings?.aiProvider ?? '';
    return providerModels[providerId] ?? tabSettings?.aiModel ?? '';
  });

  const persistAiProviderModels = (models: Record<string, string>) => {
    setAiProviderModelsState(models);
    onTabSettingChange?.('aiProviderModels', JSON.stringify(models));
  };

  const selectAiProvider = (id: AnnotationAiProviderId, modelForProvider: string) => {
    setAiProviderState(id);
    setAiModel(modelForProvider);
    onTabSettingChange?.('aiProvider', id);
    onTabSettingChange?.('aiModel', modelForProvider);
  };

  const [aiPrompt, setAiPrompt] = useState(() => tabSettings?.aiPrompt ?? '');
  const commitAiPrompt = (prompt: string) => {
    onTabSettingChange?.('aiPrompt', prompt);
  };

  const [aiTemperature, setAiTemperatureState] = useState<number>(() => {
    const parsed = Number(tabSettings?.aiTemperature);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const commitAiTemperature = (value: number) => {
    setAiTemperatureState(value);
    onTabSettingChange?.('aiTemperature', String(value));
  };

  const [aiReasoningEnabled, setAiReasoningEnabledState] = useState<boolean>(
    () => tabSettings?.aiReasoningEnabled === 'true',
  );
  const setAiReasoningEnabled = (enabled: boolean) => {
    setAiReasoningEnabledState(enabled);
    onTabSettingChange?.('aiReasoningEnabled', String(enabled));
  };

  const [aiReasoningEffort, setAiReasoningEffortState] = useState<string>(
    () => tabSettings?.aiReasoningEffort ?? 'medium',
  );
  const setAiReasoningEffort = (effort: string) => {
    setAiReasoningEffortState(effort);
    onTabSettingChange?.('aiReasoningEffort', effort);
  };

  const [isPreviewing, setIsPreviewingState] = useState(
    () => tabSettings?.aiPreviewOpen === 'true',
  );
  const setIsPreviewing = (open: boolean) => {
    setIsPreviewingState(open);
    onTabSettingChange?.('aiPreviewOpen', String(open));
  };

  return {
    annotationMode,
    setAnnotationMode,
    aiProviderModels,
    persistAiProviderModels,
    aiProvider,
    aiModel,
    selectAiProvider,
    aiPrompt,
    setAiPrompt,
    commitAiPrompt,
    aiTemperature,
    commitAiTemperature,
    aiReasoningEnabled,
    setAiReasoningEnabled,
    aiReasoningEffort,
    setAiReasoningEffort,
    isPreviewing,
    setIsPreviewing,
  };
}
