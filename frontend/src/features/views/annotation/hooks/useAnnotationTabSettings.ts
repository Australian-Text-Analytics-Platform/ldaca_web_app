import { useCallback, useRef, useState } from 'react';
import type { IntercoderReliabilityMetric } from '@/features/views/common/columnComparisonModel';
import type { AnnotationProviderType } from '../aiProviders';
import {
  ANNOTATION_TAB_SETTINGS_KEY,
  type AnnotationExampleSamplingMethod,
  type AnnotationMode,
  type AnnotationProcessingMode,
  type AnnotationTabSettings,
  parseAnnotationTabSettings,
} from '../annotationTabSettings';

export type {
  AnnotationExampleSamplingMethod,
  AnnotationMode,
  AnnotationProcessingMode,
} from '../annotationTabSettings';

interface UseAnnotationTabSettingsArgs {
  tabSettings: Record<string, string>;
  onTabSettingChange: (key: string, value: string) => void;
  excludedRoleColumns?: Record<string, string | null | undefined>;
}

type SettingsUpdate =
  | Partial<AnnotationTabSettings>
  | ((current: AnnotationTabSettings) => AnnotationTabSettings);

/**
 * Owns Annotation's device-local mode, AI settings, column-role selections, and the shared
 * result-table height.
 * All committed values are serialized as one tab-setting record; prompt and
 * model drafts remain local until their existing commit events fire.
 */
export function useAnnotationTabSettings({
  tabSettings,
  onTabSettingChange,
  excludedRoleColumns = {},
}: UseAnnotationTabSettingsArgs) {
  const [settings, setSettings] = useState(() =>
    parseAnnotationTabSettings(tabSettings[ANNOTATION_TAB_SETTINGS_KEY], excludedRoleColumns),
  );
  const settingsRef = useRef(settings);
  const [aiPrompt, setAiPrompt] = useState(settings.aiPrompt);
  const [aiModel, setAiModel] = useState(
    settings.aiProviderConfigurationId
      ? (settings.aiProviderModels[settings.aiProviderConfigurationId] ?? '')
      : '',
  );

  const commitSettings = useCallback(
    (update: SettingsUpdate) => {
      const current = settingsRef.current;
      const next = typeof update === 'function' ? update(current) : { ...current, ...update };
      settingsRef.current = next;
      setSettings(next);
      onTabSettingChange(ANNOTATION_TAB_SETTINGS_KEY, JSON.stringify(next));
    },
    [onTabSettingChange],
  );

  const setAnnotationMode = useCallback(
    (annotationMode: AnnotationMode) => {
      commitSettings({ annotationMode });
    },
    [commitSettings],
  );
  const persistAiProviderModels = useCallback(
    (aiProviderModels: Record<string, string>) => {
      commitSettings({ aiProviderModels });
    },
    [commitSettings],
  );
  const selectAiProvider = useCallback(
    (
      aiProviderConfigurationId: string,
      aiProviderType: AnnotationProviderType,
      modelForProvider: string,
    ) => {
      setAiModel(modelForProvider);
      commitSettings({ aiProviderConfigurationId, aiProviderType });
    },
    [commitSettings],
  );
  const clearAiProvider = useCallback(() => {
    setAiModel('');
    commitSettings({ aiProviderConfigurationId: null, aiProviderType: null });
  }, [commitSettings]);
  const commitAiPrompt = useCallback(
    (prompt: string) => {
      commitSettings({ aiPrompt: prompt });
    },
    [commitSettings],
  );
  const commitAiTemperature = useCallback(
    (aiTemperature: number) => {
      commitSettings({ aiTemperature });
    },
    [commitSettings],
  );
  const commitAiMaxRetriesPerBatch = useCallback(
    (aiMaxRetriesPerBatch: number) => {
      commitSettings({ aiMaxRetriesPerBatch });
    },
    [commitSettings],
  );
  const commitAiMaxExamplesPerClass = useCallback(
    (aiMaxExamplesPerClass: number) => {
      commitSettings({ aiMaxExamplesPerClass });
    },
    [commitSettings],
  );
  const setAiExampleSamplingMethod = useCallback(
    (aiExampleSamplingMethod: AnnotationExampleSamplingMethod) => {
      commitSettings({ aiExampleSamplingMethod });
    },
    [commitSettings],
  );
  const commitAiExampleRandomSeed = useCallback(
    (aiExampleRandomSeed: number) => {
      commitSettings({ aiExampleRandomSeed });
    },
    [commitSettings],
  );
  const commitAiBatchSize = useCallback(
    (aiBatchSize: number) => {
      commitSettings({ aiBatchSize });
    },
    [commitSettings],
  );
  const setAiProcessingMode = useCallback(
    (aiProcessingMode: AnnotationProcessingMode) => {
      commitSettings({ aiProcessingMode });
    },
    [commitSettings],
  );
  const setAiReasoningEnabled = useCallback(
    (aiReasoningEnabled: boolean) => {
      commitSettings({ aiReasoningEnabled });
    },
    [commitSettings],
  );
  const setAiReasoningEffort = useCallback(
    (aiReasoningEffort: string) => {
      commitSettings({ aiReasoningEffort });
    },
    [commitSettings],
  );
  const setAnnotationTarget = useCallback(
    (nodeId: string, column: string) => {
      commitSettings((current) => ({
        ...current,
        annotationTargets: { ...current.annotationTargets, [nodeId]: column },
      }));
    },
    [commitSettings],
  );
  const setAnnotationReliabilityMetric = useCallback(
    (nodeId: string, metric: IntercoderReliabilityMetric) => {
      commitSettings((current) => ({
        ...current,
        annotationReliabilityMetrics: {
          ...current.annotationReliabilityMetrics,
          [nodeId]: metric,
        },
      }));
    },
    [commitSettings],
  );

  const setAnnotationTableHeight = useCallback(
    (annotationTableHeight: number | null) => {
      commitSettings({ annotationTableHeight });
    },
    [commitSettings],
  );

  const uniqueRoleColumns = useCallback(
    (nodeId: string, columns: string[]) =>
      Array.from(new Set(columns)).filter((column) => column !== excludedRoleColumns[nodeId]),
    [excludedRoleColumns],
  );
  const setAnnotationComparisonColumns = useCallback(
    (nodeId: string, columns: string[]) => {
      const selected = uniqueRoleColumns(nodeId, columns);
      commitSettings((current) => {
        const annotationComparisonColumns = { ...current.annotationComparisonColumns };
        const annotationMetadataColumns = { ...current.annotationMetadataColumns };
        if (selected.length > 0) annotationComparisonColumns[nodeId] = selected;
        else Reflect.deleteProperty(annotationComparisonColumns, nodeId);
        const metadata = (annotationMetadataColumns[nodeId] ?? []).filter(
          (column) => !selected.includes(column),
        );
        if (metadata.length > 0) annotationMetadataColumns[nodeId] = metadata;
        else Reflect.deleteProperty(annotationMetadataColumns, nodeId);
        return { ...current, annotationComparisonColumns, annotationMetadataColumns };
      });
    },
    [commitSettings, uniqueRoleColumns],
  );
  const setAnnotationMetadataColumns = useCallback(
    (nodeId: string, columns: string[]) => {
      const selected = uniqueRoleColumns(nodeId, columns);
      commitSettings((current) => {
        const annotationMetadataColumns = { ...current.annotationMetadataColumns };
        const annotationComparisonColumns = { ...current.annotationComparisonColumns };
        if (selected.length > 0) annotationMetadataColumns[nodeId] = selected;
        else Reflect.deleteProperty(annotationMetadataColumns, nodeId);
        const comparison = (annotationComparisonColumns[nodeId] ?? []).filter(
          (column) => !selected.includes(column),
        );
        if (comparison.length > 0) annotationComparisonColumns[nodeId] = comparison;
        else Reflect.deleteProperty(annotationComparisonColumns, nodeId);
        return { ...current, annotationComparisonColumns, annotationMetadataColumns };
      });
    },
    [commitSettings, uniqueRoleColumns],
  );

  return {
    ...settings,
    setAnnotationMode,
    persistAiProviderModels,
    aiModel,
    setAiModel,
    selectAiProvider,
    clearAiProvider,
    aiPrompt,
    setAiPrompt,
    commitAiPrompt,
    commitAiTemperature,
    commitAiMaxRetriesPerBatch,
    commitAiMaxExamplesPerClass,
    setAiExampleSamplingMethod,
    commitAiExampleRandomSeed,
    commitAiBatchSize,
    setAiProcessingMode,
    setAiReasoningEnabled,
    setAiReasoningEffort,
    setAnnotationTarget,
    setAnnotationComparisonColumns,
    setAnnotationReliabilityMetric,
    setAnnotationMetadataColumns,
    setAnnotationTableHeight,
  };
}
