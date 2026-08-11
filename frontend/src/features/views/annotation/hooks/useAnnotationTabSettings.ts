import { useRef, useState } from 'react';
import {
  type IntercoderReliabilityMetric,
  isIntercoderReliabilityMetric,
} from '@/features/views/common/columnComparisonModel';
import type { AnnotationProviderType } from '../aiProviders';
import type { AnnotationDifferenceFilter } from '../annotationDifferenceQuery';

export type AnnotationMode = 'manual' | 'ai';
export type AnnotationProcessingMode = 'reprocess_all' | 'fill_missing';
export type AnnotationExampleSamplingMethod = 'random' | 'first_n' | 'last_n';

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

const parseReliabilityMetricMapSetting = (
  value: string | undefined,
): Record<string, IntercoderReliabilityMetric> => {
  const values = parseStringMapSetting(
    value,
    '[annotation] Ignoring malformed reliability-metric setting:',
  );
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, IntercoderReliabilityMetric] =>
      isIntercoderReliabilityMetric(entry[1]),
    ),
  );
};

const parseDifferenceFilterMapSetting = (
  value: string | undefined,
): Record<string, AnnotationDifferenceFilter> => {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const filters: Record<string, AnnotationDifferenceFilter> = {};
    for (const [nodeId, filter] of Object.entries(parsed)) {
      if (!filter || typeof filter !== 'object' || Array.isArray(filter)) continue;
      const candidate = filter as Record<string, unknown>;
      if (candidate.kind === 'any') {
        filters[nodeId] = { kind: 'any' };
      } else if (candidate.kind === 'column' && typeof candidate.column === 'string') {
        filters[nodeId] = { kind: 'column', column: candidate.column };
      }
    }
    return filters;
  } catch (error) {
    console.warn('[annotation] Ignoring malformed difference-filter setting:', error);
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

  const [aiMaxRetriesPerBatch, setAiMaxRetriesPerBatchState] = useState<number>(() => {
    const parsed = Number(tabSettings.aiMaxRetriesPerBatch);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 10 ? parsed : 2;
  });
  const commitAiMaxRetriesPerBatch = (value: number) => {
    setAiMaxRetriesPerBatchState(value);
    onTabSettingChange('aiMaxRetriesPerBatch', String(value));
  };

  const [aiMaxExamplesPerClass, setAiMaxExamplesPerClassState] = useState<number>(() => {
    const parsed = Number(tabSettings.aiMaxExamplesPerClass);
    return Number.isInteger(parsed) && parsed >= 1 ? parsed : 10;
  });
  const commitAiMaxExamplesPerClass = (value: number) => {
    setAiMaxExamplesPerClassState(value);
    onTabSettingChange('aiMaxExamplesPerClass', String(value));
  };

  const [aiExampleSamplingMethod, setAiExampleSamplingMethodState] =
    useState<AnnotationExampleSamplingMethod>(() => {
      const value = tabSettings.aiExampleSamplingMethod;
      return value === 'first_n' || value === 'last_n' ? value : 'random';
    });
  const setAiExampleSamplingMethod = (value: AnnotationExampleSamplingMethod) => {
    setAiExampleSamplingMethodState(value);
    onTabSettingChange('aiExampleSamplingMethod', value);
  };

  const [aiExampleRandomSeed, setAiExampleRandomSeedState] = useState<number>(() => {
    const parsed = Number(tabSettings.aiExampleRandomSeed);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  });
  const commitAiExampleRandomSeed = (value: number) => {
    setAiExampleRandomSeedState(value);
    onTabSettingChange('aiExampleRandomSeed', String(value));
  };

  const [aiBatchSize, setAiBatchSizeState] = useState<number>(() => {
    const parsed = Number(tabSettings.aiBatchSize);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : 20;
  });
  const commitAiBatchSize = (value: number) => {
    setAiBatchSizeState(value);
    onTabSettingChange('aiBatchSize', String(value));
  };

  const [aiProcessingMode, setAiProcessingModeState] = useState<AnnotationProcessingMode>(() =>
    tabSettings.aiProcessingMode === 'fill_missing' ? 'fill_missing' : 'reprocess_all',
  );
  const setAiProcessingMode = (value: AnnotationProcessingMode) => {
    setAiProcessingModeState(value);
    onTabSettingChange('aiProcessingMode', value);
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

  const [annotationDifferenceFilters, setAnnotationDifferenceFiltersState] = useState<
    Record<string, AnnotationDifferenceFilter>
  >(() => parseDifferenceFilterMapSetting(tabSettings.annotationDifferenceFilters));
  const annotationDifferenceFiltersRef = useRef(annotationDifferenceFilters);
  const setAnnotationDifferenceFilter = (
    nodeId: string,
    filter: AnnotationDifferenceFilter | null,
  ) => {
    const next = { ...annotationDifferenceFiltersRef.current };
    if (filter) next[nodeId] = filter;
    else Reflect.deleteProperty(next, nodeId);
    annotationDifferenceFiltersRef.current = next;
    setAnnotationDifferenceFiltersState(next);
    onTabSettingChange('annotationDifferenceFilters', JSON.stringify(next));
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
    const activeFilter = annotationDifferenceFiltersRef.current[nodeId];
    if (
      activeFilter &&
      (uniqueColumns.length === 0 ||
        (activeFilter.kind === 'column' && !uniqueColumns.includes(activeFilter.column)))
    ) {
      setAnnotationDifferenceFilter(nodeId, null);
    }
  };

  const [annotationReliabilityMetrics, setAnnotationReliabilityMetricsState] = useState<
    Record<string, IntercoderReliabilityMetric>
  >(() => parseReliabilityMetricMapSetting(tabSettings.annotationReliabilityMetrics));
  const annotationReliabilityMetricsRef = useRef(annotationReliabilityMetrics);
  const setAnnotationReliabilityMetric = (nodeId: string, metric: IntercoderReliabilityMetric) => {
    const next = { ...annotationReliabilityMetricsRef.current, [nodeId]: metric };
    annotationReliabilityMetricsRef.current = next;
    setAnnotationReliabilityMetricsState(next);
    onTabSettingChange('annotationReliabilityMetrics', JSON.stringify(next));
  };

  const [annotationMetadataColumns, setAnnotationMetadataColumnsState] = useState<
    Record<string, string[]>
  >(() =>
    parseStringArrayMapSetting(
      tabSettings.annotationMetadataColumns,
      '[annotation] Ignoring malformed metadata-column setting:',
    ),
  );
  const annotationMetadataColumnsRef = useRef(annotationMetadataColumns);
  const setAnnotationMetadataColumns = (nodeId: string, columns: string[]) => {
    const next = { ...annotationMetadataColumnsRef.current };
    const uniqueColumns = Array.from(new Set(columns));
    if (uniqueColumns.length > 0) next[nodeId] = uniqueColumns;
    else Reflect.deleteProperty(next, nodeId);
    annotationMetadataColumnsRef.current = next;
    setAnnotationMetadataColumnsState(next);
    onTabSettingChange('annotationMetadataColumns', JSON.stringify(next));
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
    aiMaxRetriesPerBatch,
    commitAiMaxRetriesPerBatch,
    aiMaxExamplesPerClass,
    commitAiMaxExamplesPerClass,
    aiExampleSamplingMethod,
    setAiExampleSamplingMethod,
    aiExampleRandomSeed,
    commitAiExampleRandomSeed,
    aiBatchSize,
    commitAiBatchSize,
    aiProcessingMode,
    setAiProcessingMode,
    aiReasoningEnabled,
    setAiReasoningEnabled,
    aiReasoningEffort,
    setAiReasoningEffort,
    annotationTargets,
    setAnnotationTarget,
    annotationDifferenceFilters,
    setAnnotationDifferenceFilter,
    annotationComparisonColumns,
    setAnnotationComparisonColumns,
    annotationReliabilityMetrics,
    setAnnotationReliabilityMetric,
    annotationMetadataColumns,
    setAnnotationMetadataColumns,
  };
}
