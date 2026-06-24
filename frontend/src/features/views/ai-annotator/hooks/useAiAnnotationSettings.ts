import { useState } from 'react';

export type EndpointPreset = 'openai' | 'lmstudio' | 'custom';

export interface AiAnnotationSettings {
  endpointPreset: EndpointPreset;
  model: string;
  classesText: string;
  examplesText: string;
  temperature: string;
  topP: string;
  seed: string;
  apiKey: string;
  customBaseUrl: string;
  batchSize: string;
}

export const LMSTUDIO_BASE_URL = 'http://127.0.0.1:1234/v1';

const DEFAULT_AI_ANNOTATION_SETTINGS: AiAnnotationSettings = {
  endpointPreset: 'openai',
  model: '',
  classesText: 'support: Supportive stance\ncritical: Critical stance',
  examplesText: '',
  temperature: '1.0',
  topP: '1.0',
  seed: '42',
  apiKey: '',
  customBaseUrl: '',
  batchSize: '100',
};

/** Resolves the backend API base URL override that run/save AI annotation calls send to the server. */
/**
 * Called by: useAiAnnotationSettings because the request settings model owns endpoint choice and must expose the normalized backend base URL to run, detach, and model-loading actions.
 */
const resolveAiAnnotationBaseUrl = (preset: EndpointPreset, customUrl: string): string | null => {
  if (preset === 'openai') return null;
  if (preset === 'lmstudio') return LMSTUDIO_BASE_URL;
  return customUrl.trim() || null;
};

/** Parses the user-authored class list into the request shape expected by the AI annotation backend. */
/**
 * Called by: useAiAnnotationSettings so callers can read backend-ready classes without duplicating textarea parsing in the feature component.
 * Flow: split nonempty class lines, separate optional descriptions at colons, default blank descriptions to the class name, then drop entries without names.
 */
const parseAiAnnotationClasses = (raw: string) => {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex < 0) {
        return { name: line, description: line };
      }
      const name = line.slice(0, separatorIndex).trim();
      const description = line.slice(separatorIndex + 1).trim();
      return { name, description: description || name };
    })
    .filter((item) => item.name.length > 0);
};

/** Parses few-shot examples into validated query/classification pairs. */
/**
 * Called by: useAiAnnotationSettings so AI annotation run/detach actions can pass examples directly to the backend request.
 * Flow: split nonempty example lines, keep only query-to-classification pairs with both sides present, then return typed few-shot examples.
 */
const parseAiAnnotationExamples = (raw: string) => {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf('=>');
      if (separatorIndex < 0) {
        return null;
      }
      const query = line.slice(0, separatorIndex).trim();
      const classification = line.slice(separatorIndex + 2).trim();
      if (!query || !classification) {
        return null;
      }
      return { query, classification };
    })
    .filter((item): item is { query: string; classification: string } => Boolean(item));
};

/**
 * Consolidates the AI annotation request form fields into one settings object.
 * Used by: AiAnnotatorFeature because run, detach, model loading, and reset all
 * read the same provider/model/prompt settings and should not carry ten
 * unrelated state cells in the feature component.
 * Flow: keep request fields in one state object, expose narrow setters for UI
 * controls, derive parsed classes/examples and normalized endpoint URL on read,
 * and reset the full request model atomically.
 */
export function useAiAnnotationSettings() {
  const [settings, setSettings] = useState<AiAnnotationSettings>(DEFAULT_AI_ANNOTATION_SETTINGS);

  const setField = <K extends keyof AiAnnotationSettings>(
    key: K,
    value: AiAnnotationSettings[K],
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const resetSettings = () => {
    setSettings(DEFAULT_AI_ANNOTATION_SETTINGS);
  };

  return {
    ...settings,
    baseUrl: resolveAiAnnotationBaseUrl(settings.endpointPreset, settings.customBaseUrl),
    parsedClasses: parseAiAnnotationClasses(settings.classesText),
    parsedExamples: parseAiAnnotationExamples(settings.examplesText),
    resetSettings,
    setEndpointPreset: (value: EndpointPreset) => {
      setField('endpointPreset', value);
    },
    setModel: (value: string) => {
      setField('model', value);
    },
    setClassesText: (value: string) => {
      setField('classesText', value);
    },
    setExamplesText: (value: string) => {
      setField('examplesText', value);
    },
    setTemperature: (value: string) => {
      setField('temperature', value);
    },
    setTopP: (value: string) => {
      setField('topP', value);
    },
    setSeed: (value: string) => {
      setField('seed', value);
    },
    setApiKey: (value: string) => {
      setField('apiKey', value);
    },
    setCustomBaseUrl: (value: string) => {
      setField('customBaseUrl', value);
    },
    setBatchSize: (value: string) => {
      setField('batchSize', value);
    },
  };
}
