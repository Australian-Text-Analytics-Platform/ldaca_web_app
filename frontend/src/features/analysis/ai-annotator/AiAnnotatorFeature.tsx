import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import NodeSelectionPanel from '@/features/analysis/common/components/NodeSelectionPanel';
import { useAuth } from '@/hooks/useAuth';
import useNodeColumnInfos from '@/hooks/useNodeColumnInfos';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import {
  aiAnnotationTaskRequest,
  aiAnnotationTaskResult,
  aiAnnotationTaskResultPost,
  detachAiAnnotation,
  getAiAnnotationCategories,
  getAiAnnotationModels,
  getAiAnnotationProviders,
  getNodeData,
  runAiAnnotation,
  saveAiAnnotation,
} from '@/api/generated/sdk.gen';
import type { AiAnnotationNodeResult, AiAnnotationResponse } from '@/api/generated/types.gen';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AnalysisCardLayout } from '../common/components/AnalysisCardLayout';
import AnalysisTaskBanner from '@/features/analysis/common/components/AnalysisTaskBanner';
import { useUIStore } from '@/stores/uiStore';
import { getNodeIdentifier, useAnalysisFeature, useAnalysisLockMachine, extractAndSetTaskId, restoreAnalysisLockFromRequest, resetAnalysisSelectionAfterClear, useNodeColorManagement } from '../common';
import { takeMostRecent } from '@/utils/selectionUtils';
import { ChevronDown, ChevronUp, Loader2, Plus, RotateCcw, Sparkles, Wrench } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AnalysisPagination } from '@/features/analysis/common/components/AnalysisPagination';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { normalizeTypeName } from '@/utils/columnTypes';
import {
  MetadataColumnSelector,
} from '../common/components/MetadataColumnSelector';

type EndpointPreset = 'openai' | 'lmstudio' | 'custom';

/** Names the local OpenAI-compatible endpoint the AI annotator offers for users running LM Studio. */
const LMSTUDIO_BASE_URL = 'http://127.0.0.1:1234/v1';

/** Resolves the backend API base URL override that the run/save AI annotation calls send to the server. */
/**
 * Called by: AiAnnotatorFeature analysis panel as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
 */
const resolveBaseUrl = (preset: EndpointPreset, customUrl: string): string | null => {
  if (preset === 'openai') return null;
  if (preset === 'lmstudio') return LMSTUDIO_BASE_URL;
  return customUrl.trim() || null;
};

/** Seeds the AI annotator form with provider-neutral defaults consumed by the feature component state. */
const DEFAULT_PARAMS = {
  endpointPreset: 'openai' as EndpointPreset,
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

/** Parses the user-authored class list into the request shape expected by the AI annotation backend. */
/**
 * Called by: AiAnnotatorFeature analysis panel as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
   * Flow: split nonempty class lines, separate optional descriptions at colons, default blank descriptions to the class name, then drop entries without names.
 */
const parseClasses = (raw: string) => {
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

/** Parses few-shot examples so the AI annotation task can pass validated query/classification pairs. */
/**
 * Called by: AiAnnotatorFeature analysis panel as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
   * Flow: split nonempty example lines, keep only query-to-classification pairs with both sides present, then return typed few-shot examples.
 */
const parseExamples = (raw: string) => {
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

/** Keeps result paging consistent across the annotation and review tables in this feature. */
const DEFAULT_PAGE_SIZE = 5;

/** Converts arbitrary backend cell values into editable/displayable text for annotation review cells. */
/**
 * Called by: AiAnnotatorFeature analysis panel as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
 */
const stringifyCell = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

/** Builds the detached node name used by the AI annotation save/detach workflow. */
/**
 * Called by: AiAnnotatorFeature analysis panel as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
 */
const buildDetachNodeName = (nodeLabel: string, suffix: string) => {
  const trimmed = nodeLabel.trim();
  const base = trimmed.length > 0 ? trimmed : 'node';
  const normalized = base.replace(/\s+/g, '_');
  return `${normalized}${suffix}`;
};

/** Provides the AI annotation workspace tab, including task launch, result review, save, and detach flows. */
/**
 * Rendered by: the analysis feature registry when this panel is selected because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * Flow: read workspace/auth state, derive locked analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
 */
function AiAnnotatorFeature() {
  const { currentWorkspaceId } = useWorkspaceData();
  const { getAuthHeaders } = useAuth();
  const queryClient = useQueryClient();
  const currentView = useUIStore((state) => state.currentView);
  const isActiveTab = currentView === 'ai-annotator';
  const [endpointPreset, setEndpointPreset] = useState<EndpointPreset>(DEFAULT_PARAMS.endpointPreset);
  const [model, setModel] = useState(DEFAULT_PARAMS.model);
  const [classesText, setClassesText] = useState(DEFAULT_PARAMS.classesText);
  const [examplesText, setExamplesText] = useState(DEFAULT_PARAMS.examplesText);

  const [temperature, setTemperature] = useState(DEFAULT_PARAMS.temperature);
  const [topP, setTopP] = useState(DEFAULT_PARAMS.topP);
  const [seed, setSeed] = useState(DEFAULT_PARAMS.seed);
  const [apiKey, setApiKey] = useState(DEFAULT_PARAMS.apiKey);
  const [customBaseUrl, setCustomBaseUrl] = useState(DEFAULT_PARAMS.customBaseUrl);
  const [batchSize, setBatchSize] = useState(DEFAULT_PARAMS.batchSize);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string }>>([]);
  const [resultNodeId, setResultNodeId] = useState<string | null>(null);
  const [resultNode, setResultNode] = useState<AiAnnotationNodeResult | null>(null);
  const [isPaging, setIsPaging] = useState(false);
  const [selectedMetadataColumns, setSelectedMetadataColumns] = useState<string[]>([]);
  const [panelTab, setPanelTab] = useState<'ai-annotation' | 'review'>('ai-annotation');
  const [isDetaching, setIsDetaching] = useState(false);
  const [reviewEdits, setReviewEdits] = useState<Record<string, string>>({});
  const [savingReviewCells, setSavingReviewCells] = useState<Record<string, boolean>>({});
  const [additionalProviders, setAdditionalProviders] = useState<string[]>([]);
  const [newProviderName, setNewProviderName] = useState('');
  const [isAddAnnotatorDialogOpen, setIsAddAnnotatorDialogOpen] = useState(false);
  const aiAnnotationResultRef = useRef<AiAnnotationResponse | null>(null);

  // Review tab state
  const [reviewTextColumn, setReviewTextColumn] = useState('');
  const [reviewAnnotationColumn, setReviewAnnotationColumn] = useState('');
  const [reviewData, setReviewData] = useState<AiAnnotationNodeResult | null>(null);
  const [reviewNodeId, setReviewNodeId] = useState<string | null>(null);
  const [isReviewLoading, setIsReviewLoading] = useState(false);
  const [isReviewPaging, setIsReviewPaging] = useState(false);
  const [reviewGlobalProviders, setReviewGlobalProviders] = useState<string[]>([]);
  const [reviewGlobalCategories, setReviewGlobalCategories] = useState<string[]>([]);
  const [temporaryCategories, setTemporaryCategories] = useState<string[]>([]);
  const [isAddCategoryDialogOpen, setIsAddCategoryDialogOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [pendingCategoryCell, setPendingCategoryCell] = useState<{
    row: Record<string, unknown>;
    rowIndex: number;
    providerName: string;
    annotationColumn: string;
  } | null>(null);

  // AI annotation tab: optional target annotation column
  const [aiAnnotationColumn, setAiAnnotationColumn] = useState('');

  const {
    isLocked,
    panelSelectedNodes,
    displayNodeCount,
    nodeColumnSelections,
    activeNodeColumnSelections,
    setNodeColumnSelection,
    lockWithSnapshots,
    unlockSelection,
  } = useAnalysisLockMachine({
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    allowedDataTypes: ['string'],
    maxNodes: 1,
    docTypeOnly: true,
  });

  const displayedNodes = takeMostRecent(panelSelectedNodes, 1);
  const displayedNodeIds = displayedNodes
    .map((node, idx) => getNodeIdentifier(node, idx))
    .filter((id): id is string => Boolean(id));

  // ``tabKey`` routes colour changes through this tab's temp layer.
  // ``promoteTempColors`` is called from ``handleRun`` below so a
  // successful Run commits the preview to the global assigned store.
  const { nodeColors, handleColorChange, defaultPalette, promoteTempColors } =
    useNodeColorManagement({
      activeNodeIds: displayedNodeIds,
      tabKey: 'ai-annotator',
    });

  const effectiveSelections = (isLocked ? activeNodeColumnSelections : nodeColumnSelections)
    .filter((selection) => displayedNodeIds.includes(selection.nodeId));

  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: displayedNodes,
  });

  // Keeps each selected node tied to the text column the AI request should annotate.
  /**
   * Called by: AiAnnotatorFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleColumnChange = (nodeId: string, column: string) => {
    setNodeColumnSelection(nodeId, column);
  };

  const selectedNodeId = displayedNodeIds[0] ?? null;
  const selectedColumn = effectiveSelections[0]?.column ?? '';
  const parsedClasses = parseClasses(classesText);
  const parsedExamples = parseExamples(examplesText);

  const runDisabled =
    !currentWorkspaceId ||
    !selectedNodeId ||
    !selectedColumn ||
    !model.trim() ||
    parsedClasses.length === 0 ||
    isRunning;


  // Normalizes task responses into the single result node rendered by the annotation table.
  /**
   * Called by: AiAnnotatorFeature as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
     * Flow: read the first response node, merge response metadata into that node when present, then update result node id/state or clear it when data is missing.
   */
  const applyResponseResult = (response: AiAnnotationResponse | null) => {
    const data = response?.data;
    if (!data || typeof data !== 'object') {
      setResultNodeId(null);
      setResultNode(null);
      return;
    }

    const firstNodeId = Object.keys(data)[0];
    if (!firstNodeId) {
      setResultNodeId(null);
      setResultNode(null);
      return;
    }

    const nodeData = data[firstNodeId] ?? null;
    if (nodeData && response?.metadata) {
      nodeData.metadata = { ...(nodeData.metadata ?? {}), ...response.metadata };
    }

    setResultNodeId(firstNodeId);
    setResultNode(nodeData);
  };

  const {
    resolveTaskId,
    localTaskId,
    setLocalTaskId,
    clearResults,
    stopTask,
    isStopping,
    banner: aiAnnotationWaitingBanner,
  } = useAnalysisFeature<AiAnnotationResponse>({
    analysisType: 'ai_annotation',
    taskType: 'ai_annotation',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    isTabActive: isActiveTab,
    resultRef: aiAnnotationResultRef,
    // Loads the latest annotation result for lifecycle polling and tab hydration.
    // Called by: AiAnnotatorFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    fetchResult: async (taskId, headers) => {
      const { data } = await aiAnnotationTaskResult({
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      return data;
    },
    // Recovers the submitted request so locked selections can be restored after reloads.
    // Called by: AiAnnotatorFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    fetchRequest: async (taskId, headers) => {
      const { data } = await aiAnnotationTaskRequest({
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      return data;
    },
    // Pushes freshly fetched results into local refs and user-facing status state.
    // Called by: AiAnnotatorFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    onResultFetched: (result, _fetchedTaskId) => {
      aiAnnotationResultRef.current = result;
      applyResponseResult(result ?? null);
      setStatusMessage(result?.message ?? 'AI annotation results loaded.');
    },
    // Rehydrates persisted result payloads when the tab regains a known task.
    // Called by: AiAnnotatorFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    onHydratedResult: async (resultPayload) => {
      const hydrated = resultPayload ?? null;
      aiAnnotationResultRef.current = hydrated;
      applyResponseResult(hydrated);
      if (hydrated?.message) {
        setStatusMessage(hydrated.message);
      }
    },
    // Restores annotation request parameters enough to rebuild the analysis lock.
    // Called by: AiAnnotatorFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned. Flow: normalize inputs, derive state, then return the analysis result expected by callers.
    onHydratedRequest: async (requestPayload) => {
      const requestData = (requestPayload as Record<string, unknown> | null) ?? null;
      if (!requestData) {
        return;
      }

      const hydratedAnnotationColumn = requestData.annotation_column;
      setAiAnnotationColumn(
        typeof hydratedAnnotationColumn === 'string' ? hydratedAnnotationColumn : '',
      );

      try {
        await restoreAnalysisLockFromRequest({
          workspaceId: currentWorkspaceId,
          requestData: requestData as { node_ids?: string[]; node_columns?: Record<string, string> },
          getAuthHeaders,
          lockWithSnapshots,
          queryClient,
          maxNodes: 1,
        });
      } catch {
        // best-effort lock restoration
      }
    },
    // Resets local annotation state after the shared analysis lifecycle clears the task.
    // Called by: AiAnnotatorFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    onCleared: () => {
      aiAnnotationResultRef.current = null;
      setResultNodeId(null);
      setResultNode(null);
      setStatusMessage('AI annotation state cleared.');
      resetAnalysisSelectionAfterClear({ unlockSelection });
    },
  });

  const clearDisabled = !localTaskId && !statusMessage && !isClearing;

  // Fetches a paged result slice for the annotation table without restarting the task.
  /**
   * Called by: AiAnnotatorFeature as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
     * Flow: resolve the task id, request the selected result page, store the response ref and node result, then surface paging status or errors.
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
      setLocalTaskId(response?.metadata?.task_id ?? resolvedTaskId);
      aiAnnotationResultRef.current = response ?? null;
      applyResponseResult(response ?? null);
      setStatusMessage(response?.message ?? 'AI annotation results updated.');
    } catch (error) {
      setStatusMessage(
        `Failed to load AI annotation page: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsPaging(false);
    }
  };

  // Queries the configured provider endpoint so users can choose a concrete model id.
  /**
   * Called by: AiAnnotatorFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
     * Flow: resolve the provider base URL, request available model ids with the API key, select a valid default model, then report load success or failure.
   */
  const handleLoadModels = async () => {
    setIsLoadingModels(true);
    try {
      const baseUrl = resolveBaseUrl(endpointPreset, customBaseUrl);
      const { data: response } = await getAiAnnotationModels({
        body: { base_url: baseUrl, api_key: apiKey.trim() || null },
        headers: getAuthHeaders(),
        throwOnError: true,
      });
      const models = response?.data?.models ?? [];
      setAvailableModels(models);
      const modelIds = models.map((m) => m.id);
      if (models.length > 0 && (!model.trim() || !modelIds.includes(model))) {
        setModel(models[0]!.id);
      }
      setStatusMessage(response?.message ?? 'Model catalog loaded.');
    } catch (error) {
      setStatusMessage(`Failed to load models: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoadingModels(false);
    }
  };

  // Auto-load models when endpoint or API key changes
  useEffect(() => {
    if (!currentWorkspaceId) return;
    if (endpointPreset === 'custom' && !customBaseUrl.trim()) return;
    Promise.resolve().then(() => handleLoadModels());
    // handleLoadModels is intentionally excluded — it's an event handler whose identity changes every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpointPreset, customBaseUrl, currentWorkspaceId]);

  // Returns the parameter controls to the default annotation provider configuration.
  /**
   * Called by: AiAnnotatorFeature as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
   */
  const resetParameters = () => {
    setEndpointPreset(DEFAULT_PARAMS.endpointPreset);
    setModel(DEFAULT_PARAMS.model);
    setClassesText(DEFAULT_PARAMS.classesText);
    setExamplesText(DEFAULT_PARAMS.examplesText);
    setTemperature(DEFAULT_PARAMS.temperature);
    setTopP(DEFAULT_PARAMS.topP);
    setSeed(DEFAULT_PARAMS.seed);
    setApiKey(DEFAULT_PARAMS.apiKey);
    setCustomBaseUrl(DEFAULT_PARAMS.customBaseUrl);
    setBatchSize(DEFAULT_PARAMS.batchSize);
    setStatusMessage('Parameters reset to defaults.');
  };

  // Starts a backend detach task that materializes annotations into a new workspace node.
  /**
   * Called by: AiAnnotatorFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
 * Flow: read workspace/auth state, derive locked analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
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
          new_node_name: buildDetachNodeName(
            String(displayedNodes[0]?.name || displayedNodes[0]?.id || selectedNodeId),
            '_ai_annotation',
          ),
          annotation_column: aiAnnotationColumn.trim() ? aiAnnotationColumn : null,
          classes: parsedClasses,
          examples: parsedExamples,
          model: model.trim(),
          api_key: apiKey.trim() || null,
          base_url: resolveBaseUrl(endpointPreset, customBaseUrl),
          temperature: Number(temperature),
          top_p: Number(topP),
          seed: seed.trim() ? Number(seed) : null,
          batch_size: Number(batchSize) || 100,
        },
        headers: getAuthHeaders(),
        path: { node_id: selectedNodeId },
        throwOnError: true,
      });

      const detachTaskId = (response as { metadata?: { task_id?: string } })?.metadata?.task_id;
      setStatusMessage(
        detachTaskId
          ? `AI annotation detach started (task: ${detachTaskId}).`
          : 'AI annotation detach started.',
      );
    } catch (error) {
      setStatusMessage(`Failed to detach AI annotation: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsDetaching(false);
    }
  };

  // Submits the active node and column to the annotation backend and locks that context.
  /**
   * Called by: AiAnnotatorFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
 * Flow: read workspace/auth state, derive locked analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
 */
  const handleRun = async () => {
    if (!selectedNodeId || !selectedColumn) {
      setStatusMessage('Select one data block and text column before running.');
      return;
    }
    // Promote pending temp colours to assigned — see node-colour
    // strategy doc.
    promoteTempColors(displayedNodeIds);

    setIsRunning(true);
    try {
      const { data: response } = await runAiAnnotation({
        body: {
          node_ids: [selectedNodeId],
          node_columns: { [selectedNodeId]: selectedColumn },
          annotation_column: aiAnnotationColumn.trim() ? aiAnnotationColumn : null,
          classes: parsedClasses,
          examples: parsedExamples,
          model: model.trim(),
          api_key: apiKey.trim() || null,
          base_url: resolveBaseUrl(endpointPreset, customBaseUrl),
          temperature: Number(temperature),
          top_p: Number(topP),
          seed: seed.trim() ? Number(seed) : null,
          batch_size: Number(batchSize) || 100,
          page: 1,
          page_size: DEFAULT_PAGE_SIZE,
          descending: true,
        },
        headers: getAuthHeaders(),
        throwOnError: true,
      });

      extractAndSetTaskId(response, setLocalTaskId);
      aiAnnotationResultRef.current = response ?? null;
      applyResponseResult(response ?? null);
      setStatusMessage(response?.message ?? 'AI annotation request submitted.');

      try {
        await restoreAnalysisLockFromRequest({
          workspaceId: currentWorkspaceId,
          requestData: {
            node_ids: [selectedNodeId],
            node_columns: { [selectedNodeId]: selectedColumn },
          },
          getAuthHeaders,
          lockWithSnapshots,
          queryClient,
          maxNodes: 1,
        });
      } catch {
        // best-effort lock after run
      }
    } catch (error) {
      setStatusMessage(`Failed to run AI annotation: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsRunning(false);
    }
  };

  // Routes the Clear action through the shared analysis lifecycle while exposing local busy state.
  /**
   * Called by: AiAnnotatorFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleClear = async () => {
    setIsClearing(true);
    try {
      await clearResults();
    } catch (error) {
      setStatusMessage(`Failed to clear AI annotation: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsClearing(false);
    }
  };

  const modelNames = availableModels.map((m) => m.id);
  const resultRows = resultNode?.data ?? [];
  const resultColumns = resultNode?.columns ?? [];
  const annotationColumns = Array.isArray(resultNode?.metadata?.annotation_columns)
    ? (resultNode?.metadata?.annotation_columns as string[])
    : [];
  const inferredTextColumn =
    (selectedColumn && resultColumns.includes(selectedColumn) ? selectedColumn : null) ??
    (resultColumns.find((col) => !annotationColumns.includes(col)) ?? null);
  const availableMetadataColumns = resultColumns.filter(
    (column) => !annotationColumns.includes(column) && column !== inferredTextColumn,
  );
  const availableMetadataColumnsKey = availableMetadataColumns.join('|');

  // Drop selections that are no longer in the available set after a re-run
  // (e.g. a column got renamed or removed from the source data). No
  // auto-selection — only the user's explicit picks survive.
  useEffect(() => {
    Promise.resolve().then(() => {
      setSelectedMetadataColumns((previousSelection) => {
        const filtered = previousSelection.filter((column) => availableMetadataColumns.includes(column));
        if (filtered.length === previousSelection.length) return previousSelection;
        return filtered;
      });
    });
  }, [availableMetadataColumns, availableMetadataColumnsKey]);

  const visibleColumns = (() => {
    const prioritized = [
      ...annotationColumns,
      ...(inferredTextColumn ? [inferredTextColumn] : []),
    ];
    const visibleMetadataColumns = selectedMetadataColumns.filter((column) =>
      availableMetadataColumns.includes(column),
    );
    const unique = Array.from(new Set([...prioritized.filter(Boolean), ...visibleMetadataColumns]));
    return unique.length > 0 ? unique : resultColumns;
  })();
  const pagination = resultNode?.pagination;
  const page = pagination?.page ?? 1;
  const pageSize = pagination?.page_size ?? DEFAULT_PAGE_SIZE;
  const hasNext = Boolean(pagination?.has_next);
  const hasPrev = Boolean(pagination?.has_prev);
  const totalPages = pagination?.total_source_pages;
  const annotationColumn = annotationColumns[0] ?? `${selectedColumn || 'text'}_annotation`;

  // Builds a stable edit map key for one review table cell and annotator provider.
  /**
   * Called by: AiAnnotatorFeature as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
   */
  const buildEditKey = (rowIndex: number, providerName: string) => `${rowIndex}::${providerName}`;

  // Reads the saved annotation value from the row payload for comparison during auto-save.
  /**
   * Called by: AiAnnotatorFeature as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
     * Flow: scan the annotation column entries for the requested provider, return its saved annotation text, or fall back to an empty string.
   */
  const getPersistedAnnotationValue = (
    row: Record<string, unknown>,
    providerName: string,
    annCol: string = annotationColumn,
  ) => {
    const raw = row[annCol];
    if (!Array.isArray(raw)) {
      return '';
    }
    const found = raw.find((item) => {
      if (!item || typeof item !== 'object') {
        return false;
      }
      return String((item as Record<string, unknown>).provider ?? '') === providerName;
    }) as Record<string, unknown> | undefined;
    return found ? String(found.annotation ?? '') : '';
  };

  // Chooses the draft value when present, otherwise falling back to the persisted annotation.
  /**
   * Called by: AiAnnotatorFeature as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
   */
  const getAnnotationValue = (
    row: Record<string, unknown>,
    providerName: string,
    rowIndex: number,
    annCol: string = annotationColumn,
  ) => {
    const editKey = buildEditKey(rowIndex, providerName);
    if (Object.prototype.hasOwnProperty.call(reviewEdits, editKey)) {
      return reviewEdits[editKey] ?? '';
    }
    return getPersistedAnnotationValue(row, providerName, annCol);
  };

  // Records an in-progress review edit before the blur handler attempts to persist it.
  /**
   * Called by: AiAnnotatorFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleReviewValueChange = (rowIndex: number, providerName: string, value: string) => {
    const key = buildEditKey(rowIndex, providerName);
    setReviewEdits((prev) => ({ ...prev, [key]: value }));
  };

  // Adds a reviewer-defined provider name to the editable review grid.
  /**
   * Called by: AiAnnotatorFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleAddProvider = () => {
    const name = newProviderName.trim();
    if (!name) {
      return;
    }
    setAdditionalProviders((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setNewProviderName('');
    setIsAddAnnotatorDialogOpen(false);
  };

  // Loads source rows for the review tab while adapting node-data pagination to annotation metadata.
  /**
   * Called by: AiAnnotatorFeature as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
     * Flow: fetch the selected node page, reshape backend pagination into review metadata, then store review rows and status.
   */
  const loadReviewPage = async (nodeId: string, textCol: string, annotationCol: string, pg: number, pgSize: number) => {
    setIsReviewPaging(true);
    try {
      const { data: response } = await getNodeData({
        headers: getAuthHeaders(),
        path: { node_id: nodeId },
        query: { page: pg, page_size: pgSize },
        throwOnError: true,
      });
      const rows = response.data ?? [];
      const columns = response.columns ?? [];
      const pagination = response.pagination;
      setReviewData({
        data: rows,
        columns,
        metadata: { annotation_columns: [annotationCol] },
        pagination: pagination ? {
          page: pagination.page ?? pg,
          page_size: pagination.page_size ?? pgSize,
          total_source_rows: pagination.total_rows,
          total_source_pages: pagination.total_pages,
          result_count: rows.length,
          has_next: pagination.has_next ?? false,
          has_prev: pagination.has_prev ?? false,
        } : undefined,
      });
      setReviewNodeId(nodeId);
      setStatusMessage('Review data loaded.');
    } catch (error) {
      setStatusMessage(`Failed to load review data: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsReviewPaging(false);
    }
  };

  // Retrieves provider names already present in the selected annotation column.
  /**
   * Called by: AiAnnotatorFeature as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
     * Flow: request provider names for the annotation column, dedupe trimmed names into review options, then reset options on failure.
   */
  const loadReviewProviders = async (nodeId: string, annotationCol: string) => {
    try {
      const { data: response } = await getAiAnnotationProviders({
        headers: getAuthHeaders(),
        path: { node_id: nodeId },
        query: { annotation_column: annotationCol },
        throwOnError: true,
      });
      const providers = response?.data?.providers ?? [];
      setReviewGlobalProviders(
        Array.from(new Set(providers.map((name) => String(name).trim()).filter(Boolean))),
      );
    } catch (error) {
      setStatusMessage(
        `Failed to load annotators: ${error instanceof Error ? error.message : String(error)}`,
      );
      setReviewGlobalProviders([]);
    }
  };

  // Retrieves saved annotation categories so the review select stays aligned with existing data.
  /**
   * Called by: AiAnnotatorFeature as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
     * Flow: request saved categories for the annotation column, dedupe trimmed names into review choices, then reset choices on failure.
   */
  const loadReviewCategories = async (nodeId: string, annotationCol: string) => {
    try {
      const { data: response } = await getAiAnnotationCategories({
        headers: getAuthHeaders(),
        path: { node_id: nodeId },
        query: { annotation_column: annotationCol },
        throwOnError: true,
      });
      const categories = response?.data?.categories ?? [];
      setReviewGlobalCategories(
        Array.from(new Set(categories.map((name) => String(name).trim()).filter(Boolean))),
      );
    } catch (error) {
      setStatusMessage(
        `Failed to load annotation categories: ${error instanceof Error ? error.message : String(error)}`,
      );
      setReviewGlobalCategories([]);
    }
  };

  // Refreshes category options after local additions may have changed the review choices.
  /**
   * Called by: AiAnnotatorFeature as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
   */
  const refreshCategoryCache = async (nodeId: string, annotationCol: string) => {
    setTemporaryCategories([]);
    setReviewGlobalCategories([]);
    await loadReviewCategories(nodeId, annotationCol);
  };

  // Opens the review workflow by loading rows, providers, and categories in parallel.
  /**
   * Called by: AiAnnotatorFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleReview = async () => {
    if (!selectedNodeId || !reviewTextColumn || !reviewAnnotationColumn) {
      setStatusMessage('Select a data block, text column, and annotation column to review.');
      return;
    }
    setIsReviewLoading(true);
    try {
      await Promise.all([
        loadReviewPage(selectedNodeId, reviewTextColumn, reviewAnnotationColumn, 1, DEFAULT_PAGE_SIZE),
        loadReviewProviders(selectedNodeId, reviewAnnotationColumn),
        refreshCategoryCache(selectedNodeId, reviewAnnotationColumn),
      ]);
    } finally {
      setIsReviewLoading(false);
    }
  };

  // Applies a category menu choice, including the sentinel that opens the add-category dialog.
  /**
   * Called by: AiAnnotatorFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleCategorySelected = async (
    row: Record<string, unknown>,
    rowIndex: number,
    providerName: string,
    annotationCol: string,
    selectedValue: string,
  ) => {
    if (selectedValue === '__add_new_category__') {
      setPendingCategoryCell({ row, rowIndex, providerName, annotationColumn: annotationCol });
      setNewCategoryName('');
      setIsAddCategoryDialogOpen(true);
      return;
    }

    const nextValue = selectedValue === '__empty__' ? '' : selectedValue;
    handleReviewValueChange(rowIndex, providerName, nextValue);
    await handleReviewInputBlur(row, rowIndex, providerName, annotationCol, nextValue);
  };

  // Commits a newly named category to the pending review cell and persists the edit.
  /**
   * Called by: AiAnnotatorFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleConfirmAddCategory = async () => {
    const name = newCategoryName.trim();
    if (!name || !pendingCategoryCell) {
      return;
    }

    setTemporaryCategories((prev) => (prev.includes(name) ? prev : [...prev, name]));
    handleReviewValueChange(pendingCategoryCell.rowIndex, pendingCategoryCell.providerName, name);
    await handleReviewInputBlur(
      pendingCategoryCell.row,
      pendingCategoryCell.rowIndex,
      pendingCategoryCell.providerName,
      pendingCategoryCell.annotationColumn,
      name,
    );

    setPendingCategoryCell(null);
    setNewCategoryName('');
    setIsAddCategoryDialogOpen(false);
  };

  // Auto-saves a review cell when its draft differs from the persisted annotation value.
  /**
   * Called by: AiAnnotatorFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
 * Flow: read workspace/auth state, derive locked analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
 */
  const handleReviewInputBlur = async (
    row: Record<string, unknown>,
    rowIndex: number,
    providerName: string,
    annCol: string,
    nextValue: string,
  ) => {
    if (!reviewNodeId || !reviewAnnotationColumn) {
      return;
    }

    const editKey = buildEditKey(rowIndex, providerName);
    const persistedValue = getPersistedAnnotationValue(row, providerName, annCol);
    const trimmedNextValue = nextValue;

    if (trimmedNextValue === persistedValue) {
      setReviewEdits((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, editKey)) {
          return prev;
        }
        const { [editKey]: _, ...rest } = prev;
        return rest;
      });
      return;
    }

    if (savingReviewCells[editKey]) {
      return;
    }

    setSavingReviewCells((prev) => ({ ...prev, [editKey]: true }));
    try {
      await saveAiAnnotation({
        body: {
          annotation_column: reviewAnnotationColumn,
          edits: [{ row_index: rowIndex, provider: providerName, annotation: trimmedNextValue }],
        },
        headers: getAuthHeaders(),
        path: { node_id: reviewNodeId },
        throwOnError: true,
      });

      setReviewData((prev) => {
        if (!prev) {
          return prev;
        }
        const pagination = prev.pagination;
        const currentPage = pagination?.page ?? 1;
        const currentPageSize = pagination?.page_size ?? DEFAULT_PAGE_SIZE;
        const pageOffset = (Math.max(currentPage, 1) - 1) * currentPageSize;

        const updatedRows = prev.data.map((existingRow, localIndex) => {
          const globalIndex = pageOffset + localIndex;
          if (globalIndex !== rowIndex) {
            return existingRow;
          }

          const raw = existingRow[annCol];
          const existingEntries = Array.isArray(raw)
            ? raw
              .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
              .map((item) => ({
                provider: String(item.provider ?? ''),
                annotation: String(item.annotation ?? ''),
              }))
            : [];

          let replaced = false;
          const nextEntries = existingEntries.map((entry) => {
            if (entry.provider === providerName) {
              replaced = true;
              return { provider: entry.provider, annotation: trimmedNextValue };
            }
            return entry;
          });

          if (!replaced) {
            nextEntries.push({ provider: providerName, annotation: trimmedNextValue });
          }

          return {
            ...existingRow,
            [annCol]: nextEntries,
          };
        });

        return {
          ...prev,
          data: updatedRows,
        };
      });

      setReviewEdits((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, editKey)) {
          return prev;
        }
        const { [editKey]: _, ...rest } = prev;
        return rest;
      });
    } catch (error) {
      setStatusMessage(`Failed to auto-save review edit: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSavingReviewCells((prev) => {
        const { [editKey]: _, ...rest } = prev;
        return rest;
      });
    }
  };

  // Shared column infos for selector UIs in both tabs
  const currentNodeColumnInfos = selectedNodeId ? getColumnInfos(displayedNodes[0]) : [];
  const aiStringColumns = currentNodeColumnInfos.filter((ci) => normalizeTypeName(ci.dataType) === 'string');
  const aiAnnotationColumns = currentNodeColumnInfos.filter((ci) => normalizeTypeName(ci.dataType) === 'annotation');
  const reviewStringColumns = aiStringColumns;
  const reviewAnnotationColumns = aiAnnotationColumns;

  const reviewRunDisabled =
    !currentWorkspaceId || !selectedNodeId || !reviewTextColumn || !reviewAnnotationColumn || isReviewLoading;

  useEffect(() => {
    Promise.resolve().then(() => setReviewEdits({}));
  }, [resultNodeId, page, pageSize]);


  return (
    <div className="space-y-4">
      {aiAnnotationWaitingBanner ? (
        <AnalysisTaskBanner
          analysisName="AI Annotation"
          status={aiAnnotationWaitingBanner.status}
          taskId={aiAnnotationWaitingBanner.taskId}
          message={aiAnnotationWaitingBanner.message}
          className="mt-4"
        />
      ) : null}

      <AnalysisCardLayout
        title="AI Annotation and Review"
        info={{
          targetKey: 'ai-annotator.overview',
          label: 'About AI Annotation and Review',
          tooltip: 'Learn what AI annotation is and how it can help you.',
        }}
        actions={panelTab === 'ai-annotation' ? {
          onRun: handleRun,
          // Stops the active annotation task from the shared layout action.
          // Called by: AiAnnotatorFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
          onStop: () => {
            void stopTask();
          },
          onClear: handleClear,
          runDisabled,
          clearDisabled,
          isRunning,
          isStopping,
          isClearing,
          hasResult: Boolean(localTaskId),
          extraContent: (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleLoadModels}
                disabled={isLoadingModels || isRunning}
              >
                {isLoadingModels ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading Models
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Refresh Models
                  </>
                )}
              </Button>

              <Button type="button" variant="outline" onClick={resetParameters} disabled={isRunning || isClearing}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Reset Parameters
              </Button>
            </div>
          ),
        } : {
          onRun: handleReview,
          onClear: handleClear,
          runDisabled: reviewRunDisabled,
          clearDisabled,
          isRunning: isReviewLoading,
          isClearing,
          hasResult: Boolean(reviewData),
          runLabel: isReviewLoading ? 'Reviewing' : 'Review',
        }}
      >
        <p className="mb-4 text-sm font-medium text-red-600 dark:text-red-400">
          This tool is under development and not ready to be used. In order to use GenAI assisted coding,
          you will need to have a valid API key from a commercial provider, or deploy a local GenAI model
          and setup the endpoint correctly.
        </p>
        <Tabs value={panelTab} onValueChange={(value) => setPanelTab(value as 'ai-annotation' | 'review')}>
          <TabsList className="mb-4">
            <TabsTrigger value="ai-annotation">AI Annotation</TabsTrigger>
            <TabsTrigger value="review">Review</TabsTrigger>
          </TabsList>

          <TabsContent value="ai-annotation" className="mt-0">
            <div className="space-y-4">
              <section className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Commonly Used Parameters</h3>
                  <p className="text-xs text-muted-foreground">Choose one node, text column, model, and prompt schema.</p>
                </div>

              <NodeSelectionPanel
                selectedNodes={displayedNodes}
                nodeColumnSelections={[]}
                onColumnChange={() => {}}
                nodeColors={nodeColors}
                onColorChange={handleColorChange}
                getNodeColumns={getColumnInfos}
                defaultPalette={defaultPalette}
                maxCompare={1}
                className="rounded-lg border border-dashed border-muted-foreground/40 bg-muted/30 p-4"
                showShape
                showColorPicker
                showColumnPicker={false}
                disabled={isLocked}
                locked={isLocked}
                originalCount={displayNodeCount}
                renderExtraNodeContent={() => (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs font-medium text-muted-foreground" htmlFor="ai-text-column">Text Column</Label>
                      <Select
                        value={selectedColumn}
                        onValueChange={(value) => {
                          if (selectedNodeId) {
                            handleColumnChange(selectedNodeId, value);
                          }
                        }}
                        disabled={isLocked}
                      >
                        <SelectTrigger id="ai-text-column" className="w-full text-sm">
                          <SelectValue placeholder="Select text column" />
                        </SelectTrigger>
                        <SelectContent>
                          {aiStringColumns.map((ci) => (
                            <SelectItem key={ci.name} value={ci.name}>{ci.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-medium text-muted-foreground" htmlFor="ai-annotation-column">Annotation Column</Label>
                      <Select
                        value={aiAnnotationColumn || '__none__'}
                        onValueChange={(value) => setAiAnnotationColumn(value === '__none__' ? '' : value)}
                        disabled={isLocked}
                      >
                        <SelectTrigger id="ai-annotation-column" className="w-full text-sm">
                          <SelectValue placeholder="Select annotation column" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Create new annotation column</SelectItem>
                          {aiAnnotationColumns.map((ci) => (
                            <SelectItem key={ci.name} value={ci.name}>{ci.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              />

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="ai-annotator-endpoint-preset">Endpoint</Label>
                    <Select value={endpointPreset} onValueChange={(value) => setEndpointPreset(value as EndpointPreset)}>
                      <SelectTrigger id="ai-annotator-endpoint-preset">
                        <SelectValue placeholder="Select endpoint" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="lmstudio">http://127.0.0.1:1234 (LM Studio)</SelectItem>
                        <SelectItem value="custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className={`space-y-2 ${endpointPreset === 'custom' ? '' : 'md:col-span-2'}`}>
                    <Label htmlFor="ai-annotator-model">Model</Label>
                    <Select value={model} onValueChange={setModel}>
                      <SelectTrigger id="ai-annotator-model">
                        <SelectValue placeholder={isLoadingModels ? 'Loading models…' : 'Click "Refresh Models" to load'} />
                      </SelectTrigger>
                      <SelectContent>
                        {modelNames.map((modelName) => (
                          <SelectItem key={modelName} value={modelName}>{modelName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {endpointPreset === 'custom' ? (
                    <div className="space-y-2">
                      <Label htmlFor="ai-annotator-custom-url">Custom Base URL</Label>
                      <Input
                        id="ai-annotator-custom-url"
                        value={customBaseUrl}
                        onChange={(event) => setCustomBaseUrl(event.target.value)}
                        placeholder="e.g. http://localhost:11434/v1"
                      />
                    </div>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ai-annotator-api-key">API Key</Label>
                  <Input
                    id="ai-annotator-api-key"
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={endpointPreset === 'openai' ? 'Required for OpenAI' : 'Leave blank if not needed'}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ai-annotator-classes">Classes (one per line, `name: description`)</Label>
                  <textarea
                    id="ai-annotator-classes"
                    value={classesText}
                    onChange={(event) => setClassesText(event.target.value)}
                    className="min-h-27.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    placeholder="support: Supportive stance"
                  />
                </div>
              </section>

              <section className="space-y-4">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto px-0 text-sm"
                  onClick={() => setShowAdvanced((value) => !value)}
                >
                  <Wrench className="mr-2 h-4 w-4" />
                  Advanced Parameters
                  {showAdvanced ? <ChevronUp className="ml-2 h-4 w-4" /> : <ChevronDown className="ml-2 h-4 w-4" />}
                </Button>

                {showAdvanced ? (
                  <div className="space-y-4 rounded-md border border-border/60 bg-muted/20 p-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                      <div className="space-y-2">
                        <Label htmlFor="ai-annotator-temperature">Temperature</Label>
                        <Input
                          id="ai-annotator-temperature"
                          type="number"
                          step="0.1"
                          min="0"
                          value={temperature}
                          onChange={(event) => setTemperature(event.target.value)}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="ai-annotator-top-p">Top P</Label>
                        <Input
                          id="ai-annotator-top-p"
                          type="number"
                          step="0.05"
                          min="0"
                          max="1"
                          value={topP}
                          onChange={(event) => setTopP(event.target.value)}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="ai-annotator-seed">Seed</Label>
                        <Input
                          id="ai-annotator-seed"
                          type="number"
                          value={seed}
                          onChange={(event) => setSeed(event.target.value)}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="ai-annotator-batch-size">Batch Size</Label>
                        <Input
                          id="ai-annotator-batch-size"
                          type="number"
                          min="1"
                          value={batchSize}
                          onChange={(event) => setBatchSize(event.target.value)}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="ai-annotator-examples">Examples (one per line, query to class format)</Label>
                      <textarea
                        id="ai-annotator-examples"
                        value={examplesText}
                        onChange={(event) => setExamplesText(event.target.value)}
                        className="min-h-27.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        placeholder="This policy is fair => support"
                      />
                    </div>
                  </div>
                ) : null}
              </section>
            </div>
          </TabsContent>

          <TabsContent value="review" className="mt-0">
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Review Annotations</h3>
                <p className="text-xs text-muted-foreground">Select a node, text column, and annotation column to review and edit annotations.</p>
              </div>

              <NodeSelectionPanel
                selectedNodes={displayedNodes}
                nodeColumnSelections={[]}
                onColumnChange={() => {}}
                nodeColors={nodeColors}
                onColorChange={handleColorChange}
                getNodeColumns={getColumnInfos}
                defaultPalette={defaultPalette}
                maxCompare={1}
                className="rounded-lg border border-dashed border-muted-foreground/40 bg-muted/30 p-4"
                showShape
                showColorPicker
                showColumnPicker={false}
                disabled={isLocked}
                locked={isLocked}
                originalCount={displayNodeCount}
                renderExtraNodeContent={() => (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs font-medium text-muted-foreground" htmlFor="review-text-column">Text Column</Label>
                      <Select value={reviewTextColumn} onValueChange={setReviewTextColumn} disabled={isLocked}>
                        <SelectTrigger id="review-text-column" className="w-full text-sm">
                          <SelectValue placeholder="Select text column" />
                        </SelectTrigger>
                        <SelectContent>
                          {reviewStringColumns.map((ci) => (
                            <SelectItem key={ci.name} value={ci.name}>{ci.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-medium text-muted-foreground" htmlFor="review-annotation-column">Annotation Column</Label>
                      <Select value={reviewAnnotationColumn} onValueChange={setReviewAnnotationColumn} disabled={isLocked}>
                        <SelectTrigger id="review-annotation-column" className="w-full text-sm">
                          <SelectValue placeholder="Select annotation column" />
                        </SelectTrigger>
                        <SelectContent>
                          {reviewAnnotationColumns.map((ci) => (
                            <SelectItem key={ci.name} value={ci.name}>{ci.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              />
            </div>
          </TabsContent>
        </Tabs>

        {statusMessage ? (
          <div className="mt-4 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {statusMessage}
            {localTaskId ? <span className="ml-2 font-mono text-xs">Task: {localTaskId}</span> : null}
          </div>
        ) : null}
      </AnalysisCardLayout>

      {/* AI Annotation result panel */}
      {panelTab === 'ai-annotation' && resultNode && resultNodeId ? (
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>Annotation Results</CardTitle>
                <CardDescription>
                  Node: <span className="font-mono text-xs">{resultNodeId}</span>
                </CardDescription>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={handleDetach}
                disabled={isDetaching || isRunning || !selectedNodeId || !selectedColumn || parsedClasses.length === 0}
              >
                {isDetaching ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Adding to Workspace...
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Add to Workspace
                  </>
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-4">
              <MetadataColumnSelector
                availableColumns={availableMetadataColumns}
                selectedColumns={selectedMetadataColumns}
                onSelectedColumnsChange={setSelectedMetadataColumns}
              />
            </div>

            <div className="rounded-lg border border-border bg-card">
              <ScrollArea scrollbars="both" className="max-h-[70vh]">
                <div className="min-w-max">
                  <Table className="min-w-180" disableContainer>
                    <TableHeader className="bg-muted sticky top-0 z-10">
                      <TableRow>
                        {visibleColumns.map((columnName) => (
                          <TableHead key={columnName} className="whitespace-nowrap">
                            {columnName}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {resultRows.length > 0 ? (
                        resultRows.map((row, rowIndex) => (
                          <TableRow key={`${rowIndex}`}>
                            {visibleColumns.map((columnName) => (
                              <TableCell key={columnName} className="align-top">
                                {stringifyCell(row[columnName])}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={Math.max(visibleColumns.length, 1)} className="h-24 text-center text-muted-foreground">
                            No annotation rows returned for this page.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </ScrollArea>
            </div>

            <AnalysisPagination
              page={page}
              pageSize={pageSize}
              hasNext={hasNext}
              hasPrev={hasPrev}
              totalPages={totalPages}
              onPageChange={(nextPage) => {
                void loadResultPage(nextPage, pageSize);
              }}
              onPageSizeChange={(nextPageSize) => {
                void loadResultPage(1, nextPageSize);
              }}
              pageSizeOptions={[5, 10, 20, 50, 100]}
              loading={isPaging}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* Review result panel */}
      {panelTab === 'review' && reviewData && reviewNodeId ? (() => {
        const rvRows = reviewData.data ?? [];
        const rvPagination = reviewData.pagination;
        const rvPage = rvPagination?.page ?? 1;
        const rvPageSize = rvPagination?.page_size ?? DEFAULT_PAGE_SIZE;
        const rvHasNext = Boolean(rvPagination?.has_next);
        const rvHasPrev = Boolean(rvPagination?.has_prev);
        const rvTotalPages = rvPagination?.total_source_pages;

        const rvAnnotationCol = reviewAnnotationColumn;
        const rvDiscoveredProviders = Array.from(
          new Set(
            rvRows.flatMap((row) => {
              const raw = row[rvAnnotationCol];
              if (!Array.isArray(raw)) return [];
              return raw
                .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
                .map((item) => String(item.provider ?? '').trim())
                .filter(Boolean);
            }),
          ),
        );
        const rvProviders = Array.from(
          new Set([
            ...reviewGlobalProviders,
            ...rvDiscoveredProviders,
            ...additionalProviders,
          ]),
        ).filter(Boolean);
        const rvDiscoveredCategories = Array.from(
          new Set(
            rvRows.flatMap((row) => {
              const raw = row[rvAnnotationCol];
              if (!Array.isArray(raw)) return [];
              return raw
                .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
                .map((item) => String(item.annotation ?? '').trim())
                .filter(Boolean);
            }),
          ),
        );
        const rvCategoryOptions = Array.from(
          new Set([
            ...reviewGlobalCategories,
            ...rvDiscoveredCategories,
            ...temporaryCategories,
          ]),
        ).filter(Boolean);

        return (
          <Card>
            <CardHeader className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle>Review Annotations</CardTitle>
                  <CardDescription>
                    Node: <span className="font-mono text-xs">{reviewNodeId}</span>
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-border bg-card">
                <ScrollArea scrollbars="both" className="max-h-[70vh]">
                  <div className="min-w-max">
                    <Table className="min-w-180" disableContainer>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="bg-muted/90 backdrop-blur-sm border-b border-border/80">
                          <TableHead className="whitespace-nowrap border-r border-border/70 bg-muted/90 py-2">
                            <div className="flex items-center justify-center gap-2">
                              <span className="font-semibold tracking-tight">text</span>
                              <span className="rounded-full border border-border/70 bg-background/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                1 column
                              </span>
                            </div>
                          </TableHead>
                          <TableHead colSpan={rvProviders.length + 1} className="border-b-2 border-border/80 bg-muted/90 py-2">
                            <div className="flex items-center justify-center gap-2">
                              <span className="font-semibold tracking-tight">{rvAnnotationCol}</span>
                            </div>
                          </TableHead>
                        </TableRow>
                        <TableRow className="bg-muted/80 backdrop-blur-sm border-b border-border/80">
                          <TableHead className="whitespace-nowrap border-r border-border/70 bg-muted/80">
                            {reviewTextColumn}
                          </TableHead>
                          {rvProviders.map((providerName) => (
                            <TableHead key={providerName} className="whitespace-nowrap border-r border-border/60">
                              {providerName}
                            </TableHead>
                          ))}
                          <TableHead className="w-12 min-w-12 text-center border-l border-border/70">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 rounded-full border border-border/60 hover:border-border"
                              onClick={() => setIsAddAnnotatorDialogOpen(true)}
                              aria-label="Add annotator"
                              title="Add annotator"
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rvRows.length > 0 ? (
                          rvRows.map((row, rowIdx) => {
                            const rowIndex = (Math.max(rvPage, 1) - 1) * rvPageSize + rowIdx;
                            return (
                              <TableRow key={`${rowIndex}`}>
                                <TableCell className="align-top max-w-xl whitespace-pre-wrap wrap-break-word">
                                  {stringifyCell(row[reviewTextColumn])}
                                </TableCell>
                                {rvProviders.map((providerName) => (
                                  <TableCell key={`${rowIndex}-${providerName}`} className="align-top min-w-40">
                                    <Select
                                      value={getAnnotationValue(row, providerName, rowIndex, rvAnnotationCol) || '__empty__'}
                                      onValueChange={(value) => {
                                        void handleCategorySelected(
                                          row,
                                          rowIndex,
                                          providerName,
                                          rvAnnotationCol,
                                          value,
                                        );
                                      }}
                                      disabled={Boolean(savingReviewCells[buildEditKey(rowIndex, providerName)])}
                                    >
                                      <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Select category" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="__add_new_category__">+ Add a new category</SelectItem>
                                        <SelectItem value="__empty__">(empty)</SelectItem>
                                        {rvCategoryOptions.map((category) => (
                                          <SelectItem key={category} value={category}>{category}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </TableCell>
                                ))}
                                <TableCell className="w-12" />
                              </TableRow>
                            );
                          })
                        ) : (
                          <TableRow>
                            <TableCell colSpan={Math.max(rvProviders.length + 2, 1)} className="h-24 text-center text-muted-foreground">
                              No annotation rows available for review.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </ScrollArea>
              </div>

              <AnalysisPagination
                page={rvPage}
                pageSize={rvPageSize}
                hasNext={rvHasNext}
                hasPrev={rvHasPrev}
                totalPages={rvTotalPages}
                onPageChange={(nextPage) => {
                  void Promise.all([
                    loadReviewPage(reviewNodeId, reviewTextColumn, reviewAnnotationColumn, nextPage, rvPageSize),
                    refreshCategoryCache(reviewNodeId, reviewAnnotationColumn),
                  ]);
                }}
                onPageSizeChange={(nextPageSize) => {
                  void Promise.all([
                    loadReviewPage(reviewNodeId, reviewTextColumn, reviewAnnotationColumn, 1, nextPageSize),
                    refreshCategoryCache(reviewNodeId, reviewAnnotationColumn),
                  ]);
                }}
                pageSizeOptions={[5, 10, 20, 50, 100]}
                loading={isReviewPaging}
              />

              <AlertDialog open={isAddAnnotatorDialogOpen} onOpenChange={setIsAddAnnotatorDialogOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Add Annotator</AlertDialogTitle>
                    <AlertDialogDescription>
                      Enter the annotator name to add a new review column.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <Input
                    value={newProviderName}
                    onChange={(event) => setNewProviderName(event.target.value)}
                    placeholder="e.g. userA"
                    autoFocus
                  />
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleAddProvider}>Add</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog
                open={isAddCategoryDialogOpen}
                onOpenChange={(open) => {
                  setIsAddCategoryDialogOpen(open);
                  if (!open) {
                    setPendingCategoryCell(null);
                    setNewCategoryName('');
                  }
                }}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Add a New Category</AlertDialogTitle>
                    <AlertDialogDescription>
                      This category is temporary in the frontend and will reset on page change.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <Input
                    value={newCategoryName}
                    onChange={(event) => setNewCategoryName(event.target.value)}
                    placeholder="e.g. mixed"
                    autoFocus
                  />
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void handleConfirmAddCategory()}>
                      Add Category
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        );
      })() : null}
    </div>
  );
}

export default AiAnnotatorFeature;
