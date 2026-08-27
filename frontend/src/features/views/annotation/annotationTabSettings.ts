import {
  type IntercoderReliabilityMetric,
  isIntercoderReliabilityMetric,
} from '@/features/views/common/columnComparisonModel';
import type { AnnotationProviderType } from './aiProviders';

export const ANNOTATION_TAB_SETTINGS_KEY = 'annotation.settings';

export type AnnotationMode = 'manual' | 'ai';
export type AnnotationProcessingMode = 'reprocess_all' | 'fill_missing';
export type AnnotationExampleSamplingMethod = 'random' | 'first_n' | 'last_n';

export interface AnnotationTabSettings {
  annotationMode: AnnotationMode;
  aiProviderModels: Record<string, string>;
  aiProviderConfigurationId: string | null;
  aiProviderType: AnnotationProviderType | null;
  aiPrompt: string;
  aiTemperature: number;
  aiMaxRetriesPerBatch: number;
  aiMaxExamplesPerClass: number;
  aiExampleSamplingMethod: AnnotationExampleSamplingMethod;
  aiExampleRandomSeed: number;
  aiBatchSize: number;
  aiProcessingMode: AnnotationProcessingMode;
  aiReasoningEnabled: boolean;
  aiReasoningEffort: string;
  annotationTargets: Record<string, string>;
  annotationComparisonColumns: Record<string, string[]>;
  annotationReliabilityMetrics: Record<string, IntercoderReliabilityMetric>;
  annotationMetadataColumns: Record<string, string[]>;
  /** Shared result-table height in pixels for Manual, Preview, and Review; null keeps the default. */
  annotationTableHeight: number | null;
}

export const ANNOTATION_TABLE_MIN_HEIGHT = 384;

export const DEFAULT_ANNOTATION_TAB_SETTINGS: AnnotationTabSettings = {
  annotationMode: 'manual',
  aiProviderModels: {},
  aiProviderConfigurationId: null,
  aiProviderType: null,
  aiPrompt: '',
  aiTemperature: 0,
  aiMaxRetriesPerBatch: 2,
  aiMaxExamplesPerClass: 10,
  aiExampleSamplingMethod: 'random',
  aiExampleRandomSeed: 0,
  aiBatchSize: 20,
  aiProcessingMode: 'reprocess_all',
  aiReasoningEnabled: false,
  aiReasoningEffort: 'medium',
  annotationTargets: {},
  annotationComparisonColumns: {},
  annotationReliabilityMetrics: {},
  annotationMetadataColumns: {},
  annotationTableHeight: null,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const stringMap = (value: unknown): Record<string, string> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {};

const stringArrayMap = (value: unknown): Record<string, string[]> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).flatMap(([key, columns]) =>
          Array.isArray(columns) && columns.every((column) => typeof column === 'string')
            ? [[key, Array.from(new Set(columns))]]
            : [],
        ),
      )
    : {};

const jsonValue = (value: string | undefined): unknown => {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
};

const providerType = (value: unknown): AnnotationProviderType | null =>
  value === 'openrouter' ||
  value === 'openai' ||
  value === 'anthropic' ||
  value === 'google' ||
  value === 'custom'
    ? value
    : null;

const finiteNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const tableHeight = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= ANNOTATION_TABLE_MIN_HEIGHT
    ? Math.round(value)
    : null;

const integerInRange = (
  value: unknown,
  fallback: number,
  minimum: number,
  maximum = Number.POSITIVE_INFINITY,
): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;

const normalizeColumnRoles = (
  comparisonValue: unknown,
  metadataValue: unknown,
  excludedRoleColumns: Record<string, string | null | undefined>,
) => {
  const annotationComparisonColumns = Object.fromEntries(
    Object.entries(stringArrayMap(comparisonValue)).flatMap(([nodeId, columns]) => {
      const available = columns.filter((column) => column !== excludedRoleColumns[nodeId]);
      return available.length > 0 ? [[nodeId, available]] : [];
    }),
  );
  const annotationMetadataColumns = Object.fromEntries(
    Object.entries(stringArrayMap(metadataValue)).flatMap(([nodeId, columns]) => {
      const available = columns.filter(
        (column) =>
          column !== excludedRoleColumns[nodeId] &&
          !annotationComparisonColumns[nodeId]?.includes(column),
      );
      return available.length > 0 ? [[nodeId, available]] : [];
    }),
  );
  return { annotationComparisonColumns, annotationMetadataColumns };
};

const settingsFromRecord = (
  value: Record<string, unknown>,
  excludedRoleColumns: Record<string, string | null | undefined>,
): AnnotationTabSettings => {
  const roles = normalizeColumnRoles(
    value.annotationComparisonColumns,
    value.annotationMetadataColumns,
    excludedRoleColumns,
  );
  const annotationReliabilityMetrics = Object.fromEntries(
    Object.entries(stringMap(value.annotationReliabilityMetrics)).filter(
      (entry): entry is [string, IntercoderReliabilityMetric] =>
        isIntercoderReliabilityMetric(entry[1]),
    ),
  );
  const configurationId =
    typeof value.aiProviderConfigurationId === 'string'
      ? value.aiProviderConfigurationId.trim()
      : '';
  return {
    annotationMode: value.annotationMode === 'ai' ? 'ai' : 'manual',
    aiProviderModels: stringMap(value.aiProviderModels),
    aiProviderConfigurationId: configurationId || null,
    aiProviderType: providerType(value.aiProviderType),
    aiPrompt: typeof value.aiPrompt === 'string' ? value.aiPrompt : '',
    aiTemperature: finiteNumber(value.aiTemperature, 0),
    aiMaxRetriesPerBatch: integerInRange(value.aiMaxRetriesPerBatch, 2, 0, 10),
    aiMaxExamplesPerClass: integerInRange(value.aiMaxExamplesPerClass, 10, 1),
    aiExampleSamplingMethod:
      value.aiExampleSamplingMethod === 'first_n' || value.aiExampleSamplingMethod === 'last_n'
        ? value.aiExampleSamplingMethod
        : 'random',
    aiExampleRandomSeed: integerInRange(value.aiExampleRandomSeed, 0, 0),
    aiBatchSize: integerInRange(value.aiBatchSize, 20, 1, 100),
    aiProcessingMode: value.aiProcessingMode === 'fill_missing' ? 'fill_missing' : 'reprocess_all',
    aiReasoningEnabled: value.aiReasoningEnabled === true,
    aiReasoningEffort:
      typeof value.aiReasoningEffort === 'string' ? value.aiReasoningEffort : 'medium',
    annotationTargets: stringMap(value.annotationTargets),
    annotationReliabilityMetrics,
    annotationTableHeight: tableHeight(value.annotationTableHeight),
    ...roles,
  };
};

export const parseAnnotationTabSettings = (
  value: string | undefined,
  excludedRoleColumns: Record<string, string | null | undefined> = {},
): AnnotationTabSettings => {
  if (!value) return { ...DEFAULT_ANNOTATION_TAB_SETTINGS };
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) throw new Error('Annotation settings must be an object');
    return settingsFromRecord(parsed, excludedRoleColumns);
  } catch (error) {
    console.warn('[annotation] Ignoring malformed tab settings:', error);
    return { ...DEFAULT_ANNOTATION_TAB_SETTINGS };
  }
};

const LEGACY_ANNOTATION_SETTING_KEYS = [
  'annotationMode',
  'aiProviderModels',
  'aiProviderConfigurationId',
  'aiProviderType',
  'aiPrompt',
  'aiTemperature',
  'aiMaxRetriesPerBatch',
  'aiMaxExamplesPerClass',
  'aiExampleSamplingMethod',
  'aiExampleRandomSeed',
  'aiBatchSize',
  'aiProcessingMode',
  'aiReasoningEnabled',
  'aiReasoningEffort',
  'annotationTargets',
  'annotationComparisonColumns',
  'annotationReliabilityMetrics',
  'annotationMetadataColumns',
] as const;

/** Consolidates the v3 Annotation string keys into the v4 settings record. */
export const migrateLegacyAnnotationTabSettings = (
  tabSettings: Record<string, string>,
): Record<string, string> => {
  if (tabSettings[ANNOTATION_TAB_SETTINGS_KEY]) return tabSettings;
  if (!LEGACY_ANNOTATION_SETTING_KEYS.some((key) => key in tabSettings)) return tabSettings;
  const legacyRecord: Record<string, unknown> = {
    annotationMode: tabSettings.annotationMode,
    aiProviderModels: jsonValue(tabSettings.aiProviderModels),
    aiProviderConfigurationId: tabSettings.aiProviderConfigurationId,
    aiProviderType: tabSettings.aiProviderType,
    aiPrompt: tabSettings.aiPrompt,
    aiTemperature: Number(tabSettings.aiTemperature),
    aiMaxRetriesPerBatch: Number(tabSettings.aiMaxRetriesPerBatch),
    aiMaxExamplesPerClass: Number(tabSettings.aiMaxExamplesPerClass),
    aiExampleSamplingMethod: tabSettings.aiExampleSamplingMethod,
    aiExampleRandomSeed: Number(tabSettings.aiExampleRandomSeed),
    aiBatchSize: Number(tabSettings.aiBatchSize),
    aiProcessingMode: tabSettings.aiProcessingMode,
    aiReasoningEnabled: tabSettings.aiReasoningEnabled === 'true',
    aiReasoningEffort: tabSettings.aiReasoningEffort,
    annotationTargets: jsonValue(tabSettings.annotationTargets),
    annotationComparisonColumns: jsonValue(tabSettings.annotationComparisonColumns),
    annotationReliabilityMetrics: jsonValue(tabSettings.annotationReliabilityMetrics),
    annotationMetadataColumns: jsonValue(tabSettings.annotationMetadataColumns),
  };
  const migrated = settingsFromRecord(legacyRecord, {});
  const next = Object.fromEntries(
    Object.entries(tabSettings).filter(
      ([key]) =>
        !LEGACY_ANNOTATION_SETTING_KEYS.includes(
          key as (typeof LEGACY_ANNOTATION_SETTING_KEYS)[number],
        ),
    ),
  );
  next[ANNOTATION_TAB_SETTINGS_KEY] = JSON.stringify(migrated);
  return next;
};
