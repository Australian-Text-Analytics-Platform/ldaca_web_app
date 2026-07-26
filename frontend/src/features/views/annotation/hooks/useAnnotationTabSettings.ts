import { useRef, useState } from 'react';
import type { AnnotationProviderType } from '../aiProviders';

export type AnnotationMode = 'manual' | 'ai';

interface UseAnnotationTabSettingsArgs {
  tabSettings: Record<string, string>;
  onTabSettingChange: (key: string, value: string) => void;
}

/**
 * Parse a persisted tab-setting string as a provider-configuration model map.
 *
 * Used by: useAnnotationTabSettings when hydrating the AI provider dropdown.
 * The value lives in the backend Tab resource as a string map because generic tab settings are
 * Record<string,string>; malformed user-edited JSON is ignored with a warning so
 * the tab still opens and the user can save a fresh provider configuration.
 */
const parseStringMapSetting = (
  value: string | undefined,
  warning: string,
): Record<string, string> => {
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
    console.warn(warning, error);
    return {};
  }
};

const parseStringArrayMapSetting = (
  value: string | undefined,
  warning: string,
): Record<string, string[]> => {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const values: Record<string, string[]> = {};
    for (const [key, columns] of Object.entries(parsed)) {
      if (Array.isArray(columns) && columns.every((column) => typeof column === 'string')) {
        values[key] = Array.from(new Set(columns));
      }
    }
    return values;
  } catch (error) {
    console.warn(warning, error);
    return {};
  }
};

/**
 * Owns Annotation's tab-persisted mode and AI settings.
 *
 * Used by: AnnotationFeature so the feature body can focus on selector/run UI
 * while this hook handles Tab-resource string hydration and write-through updates.
 * Flow: seed local state from the active tab's string settings, expose setters
 * that mirror discrete user actions, and write each committed value back through
 * AnalysisTabsHost's tab-setting sink.
 */
export function useAnnotationTabSettings({
  tabSettings,
  onTabSettingChange,
}: UseAnnotationTabSettingsArgs) {
  const [annotationMode, setAnnotationModeState] = useState<AnnotationMode>(() =>
    tabSettings.annotationMode === 'ai' ? 'ai' : 'manual',
  );
  const setAnnotationMode = (mode: AnnotationMode) => {
    setAnnotationModeState(mode);
    onTabSettingChange('annotationMode', mode);
  };

  const [aiProviderModels, setAiProviderModelsState] = useState<Record<string, string>>(() =>
    parseStringMapSetting(
      tabSettings.aiProviderModels,
      '[annotation] Ignoring malformed AI provider model setting:',
    ),
  );
  const [aiProviderConfigurationId, setAiProviderConfigurationId] = useState<string | null>(() => {
    const saved = tabSettings.aiProviderConfigurationId?.trim() ?? '';
    return saved.length > 0 ? saved : null;
  });
  const [aiProviderType, setAiProviderType] = useState<AnnotationProviderType | null>(() => {
    const value = tabSettings.aiProviderType;
    return value === 'openrouter' ||
      value === 'openai' ||
      value === 'anthropic' ||
      value === 'google' ||
      value === 'custom'
      ? value
      : null;
  });
  const [aiModel, setAiModel] = useState(() => {
    const providerModels = parseStringMapSetting(
      tabSettings.aiProviderModels,
      '[annotation] Ignoring malformed AI provider model setting:',
    );
    const configurationId = tabSettings.aiProviderConfigurationId ?? '';
    return providerModels[configurationId] ?? '';
  });

  const persistAiProviderModels = (models: Record<string, string>) => {
    setAiProviderModelsState(models);
    onTabSettingChange('aiProviderModels', JSON.stringify(models));
  };

  const selectAiProvider = (
    configurationId: string,
    providerType: AnnotationProviderType,
    modelForProvider: string,
  ) => {
    setAiProviderConfigurationId(configurationId);
    setAiProviderType(providerType);
    setAiModel(modelForProvider);
    onTabSettingChange('aiProviderConfigurationId', configurationId);
    onTabSettingChange('aiProviderType', providerType);
  };

  const clearAiProvider = () => {
    setAiProviderConfigurationId(null);
    setAiModel('');
    onTabSettingChange('aiProviderConfigurationId', '');
  };

  const [aiPrompt, setAiPrompt] = useState(() => tabSettings.aiPrompt ?? '');
  const commitAiPrompt = (prompt: string) => {
    onTabSettingChange('aiPrompt', prompt);
  };

  const [aiTemperature, setAiTemperatureState] = useState<number>(() => {
    const parsed = Number(tabSettings.aiTemperature);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const commitAiTemperature = (value: number) => {
    setAiTemperatureState(value);
    onTabSettingChange('aiTemperature', String(value));
  };

  const [aiReasoningEnabled, setAiReasoningEnabledState] = useState<boolean>(
    () => tabSettings.aiReasoningEnabled === 'true',
  );
  const setAiReasoningEnabled = (enabled: boolean) => {
    setAiReasoningEnabledState(enabled);
    onTabSettingChange('aiReasoningEnabled', String(enabled));
  };

  const [aiReasoningEffort, setAiReasoningEffortState] = useState<string>(
    () => tabSettings.aiReasoningEffort ?? 'medium',
  );
  const setAiReasoningEffort = (effort: string) => {
    setAiReasoningEffortState(effort);
    onTabSettingChange('aiReasoningEffort', effort);
  };

  const [annotationTargets, setAnnotationTargets] = useState<Record<string, string>>(() =>
    parseStringMapSetting(
      tabSettings.annotationTargets,
      '[annotation] Ignoring malformed annotation-target setting:',
    ),
  );
  const annotationTargetsRef = useRef(annotationTargets);
  const setAnnotationTarget = (nodeId: string, column: string) => {
    // A single browser event may persist multiple selector changes before React
    // rerenders. Read the latest committed map rather than the render snapshot
    // so each call writes a complete Tab setting value to AnalysisTabsHost.
    const next = { ...annotationTargetsRef.current, [nodeId]: column };
    annotationTargetsRef.current = next;
    setAnnotationTargets(next);
    onTabSettingChange('annotationTargets', JSON.stringify(next));
  };

  const [annotationComparisonColumns, setAnnotationComparisonColumnsState] = useState<
    Record<string, string[]>
  >(() =>
    parseStringArrayMapSetting(
      tabSettings.annotationComparisonColumns,
      '[annotation] Ignoring malformed comparison-column setting:',
    ),
  );
  const annotationComparisonColumnsRef = useRef(annotationComparisonColumns);
  const setAnnotationComparisonColumns = (nodeId: string, columns: string[]) => {
    const next = { ...annotationComparisonColumnsRef.current };
    const uniqueColumns = Array.from(new Set(columns));
    if (uniqueColumns.length > 0) next[nodeId] = uniqueColumns;
    else Reflect.deleteProperty(next, nodeId);
    annotationComparisonColumnsRef.current = next;
    setAnnotationComparisonColumnsState(next);
    onTabSettingChange('annotationComparisonColumns', JSON.stringify(next));
  };

  return {
    annotationMode,
    setAnnotationMode,
    aiProviderModels,
    persistAiProviderModels,
    aiProviderConfigurationId,
    aiProviderType,
    aiModel,
    setAiModel,
    selectAiProvider,
    clearAiProvider,
    aiPrompt,
    setAiPrompt,
    commitAiPrompt,
    aiTemperature,
    commitAiTemperature,
    aiReasoningEnabled,
    setAiReasoningEnabled,
    aiReasoningEffort,
    setAiReasoningEffort,
    annotationTargets,
    setAnnotationTarget,
    annotationComparisonColumns,
    setAnnotationComparisonColumns,
  };
}
