import React, { useEffect, useRef, useState } from 'react';
import NodeSelectionPanel from '../../../components/NodeSelectionPanel';
import { useAuth } from '../../../hooks/useAuth';
import useNodeColumnInfos from '../../../hooks/useNodeColumnInfos';
import { useWorkspaceData } from '../../../hooks/useWorkspaceData';
import { type AiAnnotationResponse, textApi } from '../../../api/text';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { AnalysisCardLayout } from '../common/components/AnalysisCardLayout';
import AnalysisTaskBanner from '../../../components/tabs/AnalysisTaskBanner';
import { useUIStore } from '../../../stores/uiStore';
import { getNodeIdentifier, useAnalysisFeature, useAnalysisLockMachine } from '../common';
import { ChevronDown, ChevronUp, Loader2, RotateCcw, Sparkles, Wrench } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { ScrollArea } from '../../../components/ui/scroll-area';
import { AnalysisPagination } from '../../../components/AnalysisPagination';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';

const DEFAULT_PARAMS = {
  provider: 'openai' as 'openai' | 'gemini' | 'anthropic' | 'ollama',
  model: 'gpt-4o-mini',
  technique: 'zero_shot' as 'zero_shot' | 'few_shot' | 'chain_of_thought',
  classesText: 'support: Supportive stance\ncritical: Critical stance',
  examplesText: '',
  modifier: 'no_modifier' as 'no_modifier' | 'self_consistency',
  temperature: '1.0',
  topP: '1.0',
  nCompletions: '1',
  seed: '42',
  apiKey: '',
  endpoint: '',
  enableReasoning: false,
  maxReasoningChars: '150',
  reasoningEffort: 'medium' as 'low' | 'medium' | 'high',
};

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

type AiAnnotationNodeResult = {
  data: Array<Record<string, unknown>>;
  columns: string[];
  metadata?: Record<string, unknown>;
  pagination?: {
    page: number;
    page_size: number;
    total_source_rows?: number;
    total_source_pages?: number;
    result_count?: number;
    has_next: boolean;
    has_prev: boolean;
  };
};

const DEFAULT_PAGE_SIZE = 5;

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

const AiAnnotatorFeature: React.FC = () => {
  const { currentWorkspaceId } = useWorkspaceData();
  const { getAuthHeaders } = useAuth();
  const currentView = useUIStore((state) => state.currentView);
  const isActiveTab = currentView === 'ai-annotator';
  const [provider, setProvider] = useState(DEFAULT_PARAMS.provider);
  const [model, setModel] = useState(DEFAULT_PARAMS.model);
  const [technique, setTechnique] = useState(DEFAULT_PARAMS.technique);
  const [classesText, setClassesText] = useState(DEFAULT_PARAMS.classesText);
  const [examplesText, setExamplesText] = useState(DEFAULT_PARAMS.examplesText);

  const [modifier, setModifier] = useState(DEFAULT_PARAMS.modifier);
  const [temperature, setTemperature] = useState(DEFAULT_PARAMS.temperature);
  const [topP, setTopP] = useState(DEFAULT_PARAMS.topP);
  const [nCompletions, setNCompletions] = useState(DEFAULT_PARAMS.nCompletions);
  const [seed, setSeed] = useState(DEFAULT_PARAMS.seed);
  const [apiKey, setApiKey] = useState(DEFAULT_PARAMS.apiKey);
  const [endpoint, setEndpoint] = useState(DEFAULT_PARAMS.endpoint);
  const [enableReasoning, setEnableReasoning] = useState(DEFAULT_PARAMS.enableReasoning);
  const [maxReasoningChars, setMaxReasoningChars] = useState(DEFAULT_PARAMS.maxReasoningChars);
  const [reasoningEffort, setReasoningEffort] = useState(DEFAULT_PARAMS.reasoningEffort);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, string[]>>({});
  const [resultNodeId, setResultNodeId] = useState<string | null>(null);
  const [resultNode, setResultNode] = useState<AiAnnotationNodeResult | null>(null);
  const [isPaging, setIsPaging] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const [activeTab, setActiveTab] = useState<'annotation' | 'review'>('annotation');
  const [isDetaching, setIsDetaching] = useState(false);
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  const [reviewEdits, setReviewEdits] = useState<Record<string, string>>({});
  const [additionalProviders, setAdditionalProviders] = useState<string[]>([]);
  const [newProviderName, setNewProviderName] = useState('');
  const aiAnnotationResultRef = useRef<AiAnnotationResponse | null>(null);

  const {
    isLocked,
    panelSelectedNodes,
    displayNodeCount,
    nodeColumnSelections,
    activeNodeColumnSelections,
    setNodeColumnSelection,
  } = useAnalysisLockMachine({
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    allowedDataTypes: ['string'],
    maxNodes: 1,
    docTypeOnly: true,
  });

  const displayedNodes = panelSelectedNodes.slice(0, 1);
  const displayedNodeIds = displayedNodes
    .map((node, idx) => getNodeIdentifier(node, idx))
    .filter((id): id is string => Boolean(id));

  const effectiveSelections = (isLocked ? activeNodeColumnSelections : nodeColumnSelections)
    .filter((selection) => displayedNodeIds.includes(selection.nodeId))
    .slice(0, 1);

  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: displayedNodes,
  });

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

  const clearDisabled = !taskId && !statusMessage && !isClearing;

  const applyResponseResult = (response: { data?: Record<string, AiAnnotationNodeResult> | null } | null) => {
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

    setResultNodeId(firstNodeId);
    setResultNode(data[firstNodeId] ?? null);
  };

  const {
    resolveTaskId,
    setLocalTaskId,
    clearResults,
    banner: aiAnnotationWaitingBanner,
  } = useAnalysisFeature<AiAnnotationResponse>({
    analysisType: 'ai_annotation',
    taskType: 'ai_annotation',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    isTabActive: isActiveTab,
    resultRef: aiAnnotationResultRef,
    fetchResult: async (taskId, headers) => textApi.getAiAnnotationTaskResult(taskId, headers),
    fetchRequest: async (taskId, headers) => textApi.getAiAnnotationTaskRequest(taskId, headers),
    onResultFetched: (result, fetchedTaskId) => {
      aiAnnotationResultRef.current = result;
      setTaskId(fetchedTaskId);
      applyResponseResult(result ?? null);
      setStatusMessage(result?.message ?? 'AI annotation results loaded.');
    },
    onHydratedResult: async (resultPayload) => {
      const hydrated = resultPayload ?? null;
      aiAnnotationResultRef.current = hydrated;
      setTaskId(hydrated?.metadata?.task_id ?? null);
      applyResponseResult(hydrated);
      if (hydrated?.message) {
        setStatusMessage(hydrated.message);
      }
    },
    onHydratedRequest: async (requestPayload) => {
      const requestData = (requestPayload as Record<string, unknown> | null) ?? null;
      if (!requestData) {
        return;
      }

      const nodeIds = Array.isArray(requestData.node_ids) ? (requestData.node_ids as string[]) : [];
      const requestNodeColumns =
        requestData.node_columns && typeof requestData.node_columns === 'object'
          ? (requestData.node_columns as Record<string, string>)
          : {};

      const hydratedNodeId = nodeIds[0];
      if (hydratedNodeId && requestNodeColumns[hydratedNodeId]) {
        setNodeColumnSelection(hydratedNodeId, requestNodeColumns[hydratedNodeId]);
      }
    },
    onCleared: () => {
      aiAnnotationResultRef.current = null;
      setTaskId(null);
      setResultNodeId(null);
      setResultNode(null);
      setStatusMessage('AI annotation state cleared.');
    },
  });

  const loadResultPage = async (page: number, pageSize: number) => {
    const resolvedTaskId = taskId ?? (await resolveTaskId());
    if (!resolvedTaskId) {
      return;
    }
    setIsPaging(true);
    try {
      const response = await textApi.postAiAnnotationTaskResult(
        resolvedTaskId,
        {
          page,
          page_size: pageSize,
        },
        getAuthHeaders(),
      );
      setTaskId(response?.metadata?.task_id ?? resolvedTaskId);
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

  const handleLoadModels = async () => {
    setIsLoadingModels(true);
    try {
      const response = await textApi.aiAnnotationModels(getAuthHeaders());
      const providers = response?.data?.providers ?? {};
      const next: Record<string, string[]> = {};
      Object.entries(providers).forEach(([providerKey, providerInfo]) => {
        const models = (providerInfo?.models ?? [])
          .map((entry) => entry?.name || entry?.full_name || '')
          .filter((value) => Boolean(value));
        next[providerKey] = models;
      });
      setModelsByProvider(next);
      const candidate = next[provider]?.[0];
      if (candidate && !model.trim()) {
        setModel(candidate);
      }
      setStatusMessage(response?.message ?? 'Model catalog loaded.');
    } catch (error) {
      setStatusMessage(`Failed to load models: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const resetParameters = () => {
    setProvider(DEFAULT_PARAMS.provider);
    setModel(DEFAULT_PARAMS.model);
    setTechnique(DEFAULT_PARAMS.technique);
    setClassesText(DEFAULT_PARAMS.classesText);
    setExamplesText(DEFAULT_PARAMS.examplesText);
    setModifier(DEFAULT_PARAMS.modifier);
    setTemperature(DEFAULT_PARAMS.temperature);
    setTopP(DEFAULT_PARAMS.topP);
    setNCompletions(DEFAULT_PARAMS.nCompletions);
    setSeed(DEFAULT_PARAMS.seed);
    setApiKey(DEFAULT_PARAMS.apiKey);
    setEndpoint(DEFAULT_PARAMS.endpoint);
    setEnableReasoning(DEFAULT_PARAMS.enableReasoning);
    setMaxReasoningChars(DEFAULT_PARAMS.maxReasoningChars);
    setReasoningEffort(DEFAULT_PARAMS.reasoningEffort);
    setStatusMessage('Parameters reset to defaults.');
  };

  const handleDetach = async () => {
    if (!selectedNodeId || !selectedColumn) {
      setStatusMessage('Select one data block and text column before detaching.');
      return;
    }

    setIsDetaching(true);
    try {
      const response = await textApi.aiAnnotationDetach(
        selectedNodeId,
        {
          column: selectedColumn,
          classes: parsedClasses,
          examples: parsedExamples,
          technique,
          modifier,
          provider,
          model: model.trim(),
          api_key: apiKey.trim() || null,
          endpoint: endpoint.trim() || null,
          temperature: Number(temperature),
          top_p: Number(topP),
          n_completions: Number(nCompletions),
          seed: seed.trim() ? Number(seed) : null,
          reasoning_effort: reasoningEffort,
          enable_reasoning: enableReasoning,
          max_reasoning_chars: Number(maxReasoningChars),
        },
        getAuthHeaders(),
      );

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

  const handleRun = async () => {
    if (!selectedNodeId || !selectedColumn) {
      setStatusMessage('Select one data block and text column before running.');
      return;
    }

    setIsRunning(true);
    try {
      const response = await textApi.aiAnnotation(
        {
          node_ids: [selectedNodeId],
          node_columns: { [selectedNodeId]: selectedColumn },
          classes: parsedClasses,
          examples: parsedExamples,
          technique,
          modifier,
          provider,
          model: model.trim(),
          api_key: apiKey.trim() || null,
          endpoint: endpoint.trim() || null,
          temperature: Number(temperature),
          top_p: Number(topP),
          n_completions: Number(nCompletions),
          seed: seed.trim() ? Number(seed) : null,
          reasoning_effort: reasoningEffort,
          enable_reasoning: enableReasoning,
          max_reasoning_chars: Number(maxReasoningChars),
          page: 1,
          page_size: DEFAULT_PAGE_SIZE,
          descending: true,
        },
        getAuthHeaders(),
      );

      const nextTaskId = response?.metadata?.task_id ?? null;
      setTaskId(nextTaskId);
      setLocalTaskId(nextTaskId);
      aiAnnotationResultRef.current = response ?? null;
      applyResponseResult(response ?? null);
      setStatusMessage(response?.message ?? 'AI annotation request submitted.');
    } catch (error) {
      setStatusMessage(`Failed to run AI annotation: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsRunning(false);
    }
  };

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

  const providerModels = modelsByProvider[provider] ?? [];
  const resultRows = resultNode?.data ?? [];
  const resultColumns = resultNode?.columns ?? [];
  const annotationColumns = Array.isArray(resultNode?.metadata?.annotation_columns)
    ? (resultNode?.metadata?.annotation_columns as string[])
    : [];
  const inferredTextColumn =
    (selectedColumn && resultColumns.includes(selectedColumn) ? selectedColumn : null) ??
    (resultColumns.find((col) => !annotationColumns.includes(col)) ?? null);
  const visibleColumns = (() => {
    if (showMetadata) {
      return resultColumns;
    }

    const prioritized = [
      ...(inferredTextColumn ? [inferredTextColumn] : []),
      ...annotationColumns,
    ];
    const unique = Array.from(new Set(prioritized.filter(Boolean)));
    return unique.length > 0 ? unique : resultColumns;
  })();
  const pagination = resultNode?.pagination;
  const page = pagination?.page ?? 1;
  const pageSize = pagination?.page_size ?? DEFAULT_PAGE_SIZE;
  const hasNext = Boolean(pagination?.has_next);
  const hasPrev = Boolean(pagination?.has_prev);
  const totalPages = pagination?.total_source_pages;
  const annotationColumn = annotationColumns[0] ?? `${selectedColumn || 'text'}_annotation`;

  const discoveredProviders = Array.from(
    new Set(
      resultRows.flatMap((row) => {
        const raw = row[annotationColumn];
        if (!Array.isArray(raw)) {
          return [];
        }
        return raw
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
          .map((item) => String(item.provider ?? '').trim())
          .filter(Boolean);
      }),
    ),
  );

  const reviewProviders = Array.from(new Set([...discoveredProviders, ...additionalProviders])).filter(Boolean);

  const buildEditKey = (rowIndex: number, providerName: string) => `${rowIndex}::${providerName}`;

  const getAnnotationValue = (
    row: Record<string, unknown>,
    providerName: string,
    rowIndex: number,
  ) => {
    const editKey = buildEditKey(rowIndex, providerName);
    if (Object.prototype.hasOwnProperty.call(reviewEdits, editKey)) {
      return reviewEdits[editKey] ?? '';
    }

    const raw = row[annotationColumn];
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

  const handleReviewValueChange = (rowIndex: number, providerName: string, value: string) => {
    const key = buildEditKey(rowIndex, providerName);
    setReviewEdits((prev) => ({ ...prev, [key]: value }));
  };

  const handleAddProvider = () => {
    const name = newProviderName.trim();
    if (!name) {
      return;
    }
    setAdditionalProviders((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setNewProviderName('');
  };

  const handleSaveEdits = async () => {
    if (!resultNodeId) {
      return;
    }

    const edits = Object.entries(reviewEdits)
      .map(([key, annotation]) => {
        const [rowIndexRaw, providerName] = key.split('::');
        const rowIndex = Number(rowIndexRaw);
        if (!Number.isFinite(rowIndex) || !providerName) {
          return null;
        }
        return {
          row_index: rowIndex,
          provider: providerName,
          annotation,
        };
      })
      .filter((item): item is { row_index: number; provider: string; annotation: string } => Boolean(item));

    if (edits.length === 0) {
      setStatusMessage('No review edits to save.');
      return;
    }

    setIsSavingEdits(true);
    try {
      const response = await textApi.aiAnnotationSave(
        resultNodeId,
        {
          annotation_column: annotationColumn,
          edits,
        },
        getAuthHeaders(),
      );

      setStatusMessage(
        (response as { message?: string })?.message ?? 'AI annotation edits saved.',
      );
      setReviewEdits({});
      await loadResultPage(page, pageSize);
    } catch (error) {
      setStatusMessage(`Failed to save AI annotation edits: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSavingEdits(false);
    }
  };

  useEffect(() => {
    setReviewEdits({});
  }, [resultNodeId, page, pageSize]);

  useEffect(() => {
    if (annotationColumns.length === 0 && activeTab === 'review') {
      setActiveTab('annotation');
    }
  }, [activeTab, annotationColumns.length]);

  return (
    <div className="space-y-6">
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
        title="AI Annotator Parameters"
        actions={{
          onRun: handleRun,
          onClear: handleClear,
          runDisabled,
          clearDisabled,
          isRunning,
          isClearing,
          hasResult: Boolean(taskId),
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
                    Load Models
                  </>
                )}
              </Button>

              <Button type="button" variant="outline" onClick={resetParameters} disabled={isRunning || isClearing}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Reset Parameters
              </Button>
            </div>
          ),
        }}
      >
        <div className="space-y-6">
          <section className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Commonly Used Parameters</h3>
              <p className="text-xs text-muted-foreground">Choose one node, text column, model, and prompt schema.</p>
            </div>

          <NodeSelectionPanel
            selectedNodes={displayedNodes}
            nodeColumnSelections={effectiveSelections}
            onColumnChange={handleColumnChange}
            nodeColors={{}}
            onColorChange={() => {}}
            getNodeColumns={getColumnInfos}
            defaultPalette={[]}
            maxCompare={1}
            className="rounded-lg border border-dashed border-muted-foreground/40 bg-muted/30 p-4"
            showShape
            showColorPicker={false}
            disabled={isLocked}
            locked={isLocked}
            allowedDataTypes={['string']}
            originalCount={displayNodeCount}
          />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="ai-annotator-provider">Provider</Label>
                <Select value={provider} onValueChange={(value) => setProvider(value as 'openai' | 'gemini' | 'anthropic' | 'ollama')}>
                  <SelectTrigger id="ai-annotator-provider">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="gemini">Gemini</SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="ollama">Ollama</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="ai-annotator-model">Model</Label>
                <Input
                  id="ai-annotator-model"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder={providerModels[0] || 'e.g. gpt-4o-mini'}
                  list="ai-annotator-model-suggestions"
                />
                <datalist id="ai-annotator-model-suggestions">
                  {providerModels.map((modelName) => (
                    <option key={modelName} value={modelName} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ai-annotator-technique">Technique</Label>
                <Select value={technique} onValueChange={(value) => setTechnique(value as 'zero_shot' | 'few_shot' | 'chain_of_thought')}>
                  <SelectTrigger id="ai-annotator-technique">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zero_shot">Zero-shot</SelectItem>
                    <SelectItem value="few_shot">Few-shot</SelectItem>
                    <SelectItem value="chain_of_thought">Chain-of-thought</SelectItem>
                  </SelectContent>
                </Select>
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
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="ai-annotator-modifier">Modifier</Label>
                    <Select value={modifier} onValueChange={(value) => setModifier(value as 'no_modifier' | 'self_consistency')}>
                      <SelectTrigger id="ai-annotator-modifier">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="no_modifier">No modifier</SelectItem>
                        <SelectItem value="self_consistency">Self consistency</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

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
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="ai-annotator-n-completions">N completions</Label>
                    <Input
                      id="ai-annotator-n-completions"
                      type="number"
                      min="1"
                      value={nCompletions}
                      onChange={(event) => setNCompletions(event.target.value)}
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
                    <Label htmlFor="ai-annotator-max-reasoning">Max reasoning chars</Label>
                    <Input
                      id="ai-annotator-max-reasoning"
                      type="number"
                      min="1"
                      value={maxReasoningChars}
                      onChange={(event) => setMaxReasoningChars(event.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="ai-annotator-api-key">API Key (optional override)</Label>
                    <Input
                      id="ai-annotator-api-key"
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder="Leave blank to use defaults"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ai-annotator-endpoint">Endpoint (optional)</Label>
                    <Input
                      id="ai-annotator-endpoint"
                      value={endpoint}
                      onChange={(event) => setEndpoint(event.target.value)}
                      placeholder="e.g. http://localhost:11434/v1"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="ai-annotator-reasoning-effort">Reasoning effort</Label>
                    <Select value={reasoningEffort} onValueChange={(value) => setReasoningEffort(value as 'low' | 'medium' | 'high')}>
                      <SelectTrigger id="ai-annotator-reasoning-effort">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ai-annotator-enable-reasoning">Enable reasoning</Label>
                    <Select
                      value={enableReasoning ? 'yes' : 'no'}
                      onValueChange={(value) => setEnableReasoning(value === 'yes')}
                    >
                      <SelectTrigger id="ai-annotator-enable-reasoning">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="no">No</SelectItem>
                        <SelectItem value="yes">Yes</SelectItem>
                      </SelectContent>
                    </Select>
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

          {statusMessage ? (
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              {statusMessage}
              {taskId ? <span className="ml-2 font-mono text-xs">Task: {taskId}</span> : null}
            </div>
          ) : null}
        </div>
      </AnalysisCardLayout>

      {resultNode && resultNodeId ? (
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
                variant="outline"
                onClick={handleDetach}
                disabled={isDetaching || isRunning || !selectedNodeId || !selectedColumn || parsedClasses.length === 0}
              >
                {isDetaching ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Detaching...
                  </>
                ) : (
                  'Detach'
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'annotation' | 'review')}>
              <TabsList>
                <TabsTrigger value="annotation">Annotation</TabsTrigger>
                <TabsTrigger value="review" disabled={annotationColumns.length === 0}>
                  Review
                </TabsTrigger>
              </TabsList>

              <TabsContent value="annotation" className="space-y-4">
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={showMetadata}
                      onChange={(event) => setShowMetadata(event.target.checked)}
                    />
                    <span>Show metadata</span>
                  </label>
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
              </TabsContent>

              <TabsContent value="review" className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={newProviderName}
                    onChange={(event) => setNewProviderName(event.target.value)}
                    placeholder="Add provider"
                    className="w-48"
                  />
                  <Button type="button" variant="outline" onClick={handleAddProvider}>
                    Add Provider
                  </Button>
                  <Button type="button" onClick={handleSaveEdits} disabled={isSavingEdits || Object.keys(reviewEdits).length === 0}>
                    {isSavingEdits ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save Edits'
                    )}
                  </Button>
                </div>

                <div className="rounded-lg border border-border bg-card">
                  <ScrollArea scrollbars="both" className="max-h-[70vh]">
                    <div className="min-w-max">
                      <Table className="min-w-180" disableContainer>
                        <TableHeader className="bg-muted sticky top-0 z-10">
                          <TableRow>
                            {inferredTextColumn ? <TableHead className="whitespace-nowrap">{inferredTextColumn}</TableHead> : null}
                            {reviewProviders.map((providerName) => (
                              <TableHead key={providerName} className="whitespace-nowrap">
                                {providerName}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {resultRows.length > 0 ? (
                            resultRows.map((row, rowIdx) => {
                              const rowIndex = (Math.max(page, 1) - 1) * pageSize + rowIdx;
                              return (
                                <TableRow key={`${rowIndex}`}>
                                  {inferredTextColumn ? (
                                    <TableCell className="align-top max-w-xl whitespace-pre-wrap wrap-break-word">
                                      {stringifyCell(row[inferredTextColumn])}
                                    </TableCell>
                                  ) : null}
                                  {reviewProviders.map((providerName) => (
                                    <TableCell key={`${rowIndex}-${providerName}`} className="align-top min-w-40">
                                      <Input
                                        value={getAnnotationValue(row, providerName, rowIndex)}
                                        onChange={(event) =>
                                          handleReviewValueChange(rowIndex, providerName, event.target.value)
                                        }
                                      />
                                    </TableCell>
                                  ))}
                                </TableRow>
                              );
                            })
                          ) : (
                            <TableRow>
                              <TableCell colSpan={Math.max(reviewProviders.length + 1, 1)} className="h-24 text-center text-muted-foreground">
                                No annotation rows available for review.
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </ScrollArea>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};

export default AiAnnotatorFeature;
