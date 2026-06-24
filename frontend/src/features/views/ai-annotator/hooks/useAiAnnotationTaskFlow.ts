import { useEffect, useState } from 'react';

import {
  aiAnnotationTaskResultPost,
  detachAiAnnotation,
  getAiAnnotationModels,
  runAiAnnotation,
} from '@/api';
import type {
  AiAnnotationClassDef,
  AiAnnotationExample,
  AiAnnotationModelInfo,
  AiAnnotationResponse,
} from '@/api';
import { extractAndSetTaskId } from '../../common';
import type { EndpointPreset } from './useAiAnnotationSettings';

interface UseAiAnnotationTaskFlowArgs {
  currentWorkspaceId: string | null;
  selectedNodeId: string | null;
  selectedColumn: string;
  selectedNodeLabel: string | null;
  aiAnnotationColumn: string;
  parsedClasses: AiAnnotationClassDef[];
  parsedExamples: AiAnnotationExample[];
  model: string;
  setModel: (model: string) => void;
  apiKey: string;
  baseUrl: string | null;
  temperature: string;
  topP: string;
  seed: string;
  batchSize: string;
  endpointPreset: EndpointPreset;
  customBaseUrl: string;
  getAuthHeaders: () => Record<string, string>;
  setStatusMessage: (message: string) => void;
  localTaskId: string | null;
  resolveTaskId: () => Promise<string | null>;
  setLocalTaskId: (taskId: string | null) => void;
  clearResults: () => Promise<void>;
  resultRef: { current: AiAnnotationResponse | null };
  applyResponseResult: (response: AiAnnotationResponse | null) => void;
  setIsPaging: (isPaging: boolean) => void;
  resetSettings: () => void;
  defaultPageSize: number;
}

/** Builds the detached node name used by the AI annotation save/detach workflow. */
/**
 * Called by: useAiAnnotationTaskFlow before detach requests because workspace
 * output nodes should follow the same readable suffix pattern as other
 * analysis features.
 */
function buildDetachNodeName(nodeLabel: string, suffix: string) {
  const trimmed = nodeLabel.trim();
  const base = trimmed.length > 0 ? trimmed : 'node';
  const normalized = base.replace(/\s+/g, '_');
  return `${normalized}${suffix}`;
}

/** Converts editable numeric text fields into backend request values. */
/**
 * Called by: buildAiAnnotationRequestFields so run and detach actions share
 * one interpretation of blank and invalid numeric inputs.
 */
function buildAiAnnotationRequestFields({
  aiAnnotationColumn,
  parsedClasses,
  parsedExamples,
  model,
  apiKey,
  baseUrl,
  temperature,
  topP,
  seed,
  batchSize,
}: Pick<
  UseAiAnnotationTaskFlowArgs,
  | 'aiAnnotationColumn'
  | 'parsedClasses'
  | 'parsedExamples'
  | 'model'
  | 'apiKey'
  | 'baseUrl'
  | 'temperature'
  | 'topP'
  | 'seed'
  | 'batchSize'
>) {
  return {
    annotation_column: aiAnnotationColumn.trim() ? aiAnnotationColumn : null,
    classes: parsedClasses,
    examples: parsedExamples,
    model: model.trim(),
    api_key: apiKey.trim() || null,
    base_url: baseUrl,
    temperature: Number(temperature),
    top_p: Number(topP),
    seed: seed.trim() ? Number(seed) : null,
    batch_size: Number(batchSize) || 100,
  };
}

/**
 * Coordinates AI annotation task side effects outside the feature component.
 * Used by: AiAnnotatorFeature because the feature should compose controls and
 * result panels while this hook builds backend requests, loads models, pages
 * task results, tracks busy flags, and surfaces task status messages.
 * Flow: derive shared request fields from settings, submit run/page/detach
 * API calls, copy returned responses into the shared task ref and result
 * controls, and keep provider model options synchronized with endpoint state.
 */
export function useAiAnnotationTaskFlow({
  currentWorkspaceId,
  selectedNodeId,
  selectedColumn,
  selectedNodeLabel,
  aiAnnotationColumn,
  parsedClasses,
  parsedExamples,
  model,
  setModel,
  apiKey,
  baseUrl,
  temperature,
  topP,
  seed,
  batchSize,
  endpointPreset,
  customBaseUrl,
  getAuthHeaders,
  setStatusMessage,
  localTaskId,
  resolveTaskId,
  setLocalTaskId,
  clearResults,
  resultRef,
  applyResponseResult,
  setIsPaging,
  resetSettings,
  defaultPageSize,
}: UseAiAnnotationTaskFlowArgs) {
  const [isRunning, setIsRunning] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<AiAnnotationModelInfo[]>([]);
  const [isDetaching, setIsDetaching] = useState(false);

  /** Stores a backend response in both the lifecycle ref and result controls. */
  /**
   * Called by: run and page-load actions because both API paths return the
   * same AiAnnotationResponse shape and should update UI state identically.
   */
  const applyTaskResponse = (response: AiAnnotationResponse) => {
    resultRef.current = response;
    applyResponseResult(response);
    setStatusMessage(response.message);
  };

  /** Fetches a paged result slice for the annotation table without restarting the task. */
  /**
   * Called by: the result table pagination footer because page changes should
   * refresh the stored task result instead of launching a new annotation run.
   */
  const loadResultPage = async (page: number, pageSize: number) => {
    const resolvedTaskId = localTaskId ?? (await resolveTaskId());
    if (!resolvedTaskId) {
      return;
    }
    setIsPaging(true);
    try {
      const { data: response } = await aiAnnotationTaskResultPost({
        body: {
          page,
          page_size: pageSize,
        },
        headers: getAuthHeaders(),
        path: { task_id: resolvedTaskId },
        throwOnError: true,
      });
      setLocalTaskId(response.metadata?.task_id ?? resolvedTaskId);
      applyTaskResponse(response);
    } catch (error) {
      setStatusMessage(
        `Failed to load AI annotation page: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsPaging(false);
    }
  };

  /** Queries the configured provider endpoint so users can choose a concrete model id. */
  /**
   * Called by: the Refresh Models button and endpoint-change effect because
   * model choices depend on the active provider base URL and API key.
   */
  const handleLoadModels = async () => {
    setIsLoadingModels(true);
    try {
      const { data: response } = await getAiAnnotationModels({
        body: { base_url: baseUrl, api_key: apiKey.trim() || null },
        headers: getAuthHeaders(),
        throwOnError: true,
      });
      const models = response.data.models;
      setAvailableModels(models);
      const modelIds = models.map((item) => item.id);
      if (models.length > 0 && (!model.trim() || !modelIds.includes(model))) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- models.length > 0 guard guarantees index 0
        setModel(models[0]!.id);
      }
      setStatusMessage(response.message);
    } catch (error) {
      setStatusMessage(
        `Failed to load models: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsLoadingModels(false);
    }
  };

  useEffect(() => {
    if (!currentWorkspaceId) return;
    if (endpointPreset === 'custom' && !customBaseUrl.trim()) return;
    void Promise.resolve().then(() => handleLoadModels());
    // handleLoadModels is intentionally excluded: it closes over form state
    // setters whose identities are not stable, while this effect should follow
    // endpoint availability rather than every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpointPreset, customBaseUrl, currentWorkspaceId]);

  /** Returns the parameter controls to the default annotation provider configuration. */
  /**
   * Called by: the Reset Parameters action because reset should clear the
   * settings hook and report the user-facing status in the same place.
   */
  const resetParameters = () => {
    resetSettings();
    setStatusMessage('Parameters reset to defaults.');
  };

  /** Starts a backend detach task that materializes annotations into a new workspace node. */
  /**
   * Called by: AiAnnotationResultPanel because completed annotation results
   * can be added back into the workspace as a generated node.
   */
  const handleDetach = async () => {
    if (!selectedNodeId || !selectedColumn) {
      setStatusMessage('Select one data block and text column before detaching.');
      return;
    }

    setIsDetaching(true);
    try {
      const { data: response } = await detachAiAnnotation({
        body: {
          column: selectedColumn,
          new_node_name: buildDetachNodeName(selectedNodeLabel ?? selectedNodeId, '_ai_annotation'),
          ...buildAiAnnotationRequestFields({
            aiAnnotationColumn,
            parsedClasses,
            parsedExamples,
            model,
            apiKey,
            baseUrl,
            temperature,
            topP,
            seed,
            batchSize,
          }),
        },
        headers: getAuthHeaders(),
        path: { node_id: selectedNodeId },
        throwOnError: true,
      });

      const detachTaskId = (response as { metadata?: { task_id?: string } }).metadata?.task_id;
      setStatusMessage(
        detachTaskId
          ? `AI annotation detach started (task: ${detachTaskId}).`
          : 'AI annotation detach started.',
      );
    } catch (error) {
      setStatusMessage(
        `Failed to detach AI annotation: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsDetaching(false);
    }
  };

  /** Submits the active node and column to the annotation backend. */
  /**
   * Called by: the AI Annotation tab Run action because it starts a fresh
   * backend annotation task and seeds the first visible result page.
   */
  const handleRun = async () => {
    if (!selectedNodeId || !selectedColumn) {
      setStatusMessage('Select one data block and text column before running.');
      return;
    }

    setIsRunning(true);
    try {
      const { data: response } = await runAiAnnotation({
        body: {
          node_ids: [selectedNodeId],
          node_columns: { [selectedNodeId]: selectedColumn },
          ...buildAiAnnotationRequestFields({
            aiAnnotationColumn,
            parsedClasses,
            parsedExamples,
            model,
            apiKey,
            baseUrl,
            temperature,
            topP,
            seed,
            batchSize,
          }),
          page: 1,
          page_size: defaultPageSize,
          descending: true,
        },
        headers: getAuthHeaders(),
        throwOnError: true,
      });

      extractAndSetTaskId(response, setLocalTaskId);
      applyTaskResponse(response);
    } catch (error) {
      setStatusMessage(
        `Failed to run AI annotation: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsRunning(false);
    }
  };

  /** Routes the Clear action through the shared analysis lifecycle. */
  /**
   * Called by: both AI annotation tabs because Clear removes the task-backed
   * annotation result while preserving the current form inputs.
   */
  const handleClear = async () => {
    setIsClearing(true);
    try {
      await clearResults();
    } catch (error) {
      setStatusMessage(
        `Failed to clear AI annotation: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsClearing(false);
    }
  };

  return {
    isRunning,
    isClearing,
    isLoadingModels,
    availableModels,
    isDetaching,
    loadResultPage,
    handleLoadModels,
    resetParameters,
    handleDetach,
    handleRun,
    handleClear,
  };
}
