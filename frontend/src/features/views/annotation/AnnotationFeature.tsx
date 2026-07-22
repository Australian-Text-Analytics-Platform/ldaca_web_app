import { useState } from 'react';
import type { Analysis, AnnotationAnalysisRequest, AnnotationResult } from '@/api';
import { sqlIdentifier, sqlTable } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { AnalysisCardLayout } from '@/features/views/common/components/AnalysisCardLayout';
import { NodeInputsPanel } from '@/features/views/common/components/NodeInputsPanel';
import type { NodeInputColumnAddonArgs } from '@/features/views/common/components/NodeInputsPanel';
import { AnnotationAiPreviewPanel } from './components/AnnotationAiPreviewPanel';
import { AnnotationAiSettings } from './components/AnnotationAiSettings';
import { AnnotationClassDescriptionsEditor } from './components/AnnotationClassDescriptionsEditor';
import { AnnotationInferenceSettings } from './components/AnnotationInferenceSettings';
import {
  AnnotationPromptInput,
  DEFAULT_ANNOTATION_PROMPT,
} from './components/AnnotationPromptInput';
import { AnnotationResultsPanel } from './components/AnnotationResultsPanel';
import { canAnnotate, getBuiltinProvider, type BuiltinAnnotationAiProviderId } from './aiProviders';
import { useAnnotationTabSettings } from './hooks/useAnnotationTabSettings';
import { nodeInputsFromSelections, useTabNodeInputs } from '@/features/views/common/nodeInputs';
import type { NodeInputConstraints } from '@/features/views/common/nodeInputs';
import { DEFAULT_TAB_INPUT_SET_ID } from '@/features/views/common/tabs/tabStateOps';
import type { AnalysisTabFeatureProps } from '@/features/views/common/tabs/AnalysisTabsHost';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAnnotationClassDescriptions } from './hooks/useAnnotationClassDescriptions';
import { useAnnotationAiPreviewSession } from './hooks/useAnnotationAiPreviewSession';
import { useProviderCredentials } from '@/features/provider-credentials/useProviderCredentials';
import { submitTabAnalysisWithProviderCredential } from '@/features/provider-credentials/providerCredentialRequests';
import { useAnalysisFeature } from '../common/hooks/useAnalysisFeature';
import { getAnalysisOutputResource } from '../common/analysisApi';
import { ANALYSIS_TASK_TYPES } from '../common/analysisIds';
import { runAnalysisTaskEnvelope } from '../common/tasks/runAnalysisTaskEnvelope';
import { executeAnalysisRerun } from '../common/rerunAnalysis';
import { getRerunActionState } from '../common/rerunActionState';
import { hasParameterDiff } from '../common/parameterComparison';
import AnalysisTaskBanner from '../common/components/AnalysisTaskBanner';

const SOURCE_NODE_CONSTRAINTS: NodeInputConstraints = {
  allowedDataTypes: ['string'],
  maxNodes: 1,
};
const CLASS_DESCRIPTION_NODE_CONSTRAINTS: NodeInputConstraints = {
  allowedDataTypes: ['string'],
  maxNodes: 1,
};
const CLASS_DESCRIPTION_SELECTOR_ID = 'classDescriptions';
// Optional example selector used only in AI mode: one string node whose text +
// annotation columns can later seed few-shot examples for AI annotation.
const EXAMPLE_NODE_SELECTOR_ID = 'exampleNodes';
const EXAMPLE_NODE_CONSTRAINTS: NodeInputConstraints = {
  allowedDataTypes: ['string'],
  maxNodes: 1,
};
const START_NEW_ANNOTATION_VALUE = '__start_new_annotation__';
interface ColumnPickerProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  placeholder: string;
  onValueChange: (value: string) => void;
  /** Locks the picker while an annotation run is active. */
  disabled?: boolean;
}

const resolveDescriptionColumn = (columns: string[], classColumn: string): string =>
  columns.find((column) => column === 'description') ??
  columns.find((column) => column !== classColumn) ??
  columns[0] ??
  '';

/**
 * Pick the next free annotation column name: "annotation", then "annotation_1",
 * "annotation_2", ... skipping any names already present on the source node.
 *
 * Used by: AnnotationFeature to seed the grayed "New Column Name" placeholder so
 * starting a fresh annotation doesn't collide with existing columns.
 */
const computeDefaultAnnotationColumnName = (columns: string[]): string => {
  if (!columns.includes('annotation')) return 'annotation';
  let suffix = 1;
  while (columns.includes(`annotation_${String(suffix)}`)) suffix += 1;
  return `annotation_${String(suffix)}`;
};

const derivedDataBlockName = (sourceName: string, suffix: string): string =>
  `${sourceName.trim() || 'data_block'}_${suffix}`.slice(0, 500);

/**
 * Small select used for Annotation-specific companion columns next to the
 * shared NodeInputsPanel column picker.
 *
 * Used by: AnnotationFeature's source and class-description selectors because
 * each selected node needs one extra column choice while the primary column
 * remains owned by NodeInputsPanel.
 */
function AnnotationColumnPicker({
  label,
  value,
  options,
  placeholder,
  onValueChange,
  disabled = false,
}: ColumnPickerProps) {
  return (
    <div className="space-y-1">
      <Label className="block text-xs font-medium text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger aria-label={label} className="w-full text-sm">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Annotation setup panel. This redesign slice exposes source node/column
 * selection plus a class-description setup card with an inline editable table.
 *
 * Rendered by: the viewComponents tabbed loader through AnalysisTabsHost so
 * Annotation shares the same workflow shell as other analysis-style views.
 *
 * Flow: bind both selectors to named input sets on the active tab, render
 * Annotation-specific companion column pickers, create/select a backend
 * class-description node when requested, and load/save editable class rows.
 */
function AnnotationFeature({ host }: AnalysisTabFeatureProps) {
  const {
    taskId: tabTaskId,
    setTaskId: onTabTaskChange,
    inputSets: tabInputSets,
    setInputSet: onTabInputSetChange,
    settings: tabSettings,
    setSetting: onTabSettingChange,
  } = host;
  const [descriptionColumns, setDescriptionColumns] = useState<Record<string, string>>({});
  const [newColumnNames, setNewColumnNames] = useState<Record<string, string>>({});
  const [hasRun, setHasRun] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isCreatingClassTable, setIsCreatingClassTable] = useState(false);
  // Tab-persisted AI settings live in their own hook so this feature body can
  // focus on selector, run, and results orchestration. API keys stay behind the
  // credential facade, never in tab settings.
  const {
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
    annotationTargets,
    setAnnotationTarget,
  } = useAnnotationTabSettings({ tabSettings, onTabSettingChange });
  const providerCredentials = useProviderCredentials();
  // Annotation-column choice per example node (plain columns only — no "Start
  // new annotation" option, since examples reference existing labels).
  const [exampleAnnotationColumns, setExampleAnnotationColumns] = useState<Record<string, string>>(
    {},
  );
  const { currentWorkspaceId } = useWorkspaceData();
  const { polarsExpressionApply, createSqlDataBlock } = useWorkspaceActions();

  // Manual results and an open AI preview pin the draft that produced the
  // visible rows. Preview openness is intentionally component-local; the
  // durable AI Analysis request remains the reload authority for completed runs.
  const isLocked = hasRun || isStarting || (annotationMode === 'ai' && isPreviewing);

  // Annotation has multiple valid selector targets in the same feature panel.
  // Graph/sidebar "+" requests stay pending so each visible NodeInputsPanel can
  // offer its own dashed chooser target instead of the source selector claiming
  // the request directly.
  const sourceNodeInputs = useTabNodeInputs({
    selectorId: DEFAULT_TAB_INPUT_SET_ID,
    tabInputSets,
    onTabInputSetChange,
    constraints: SOURCE_NODE_CONSTRAINTS,
    consumeNodeInputRequests: false,
  });
  const classNodeInputs = useTabNodeInputs({
    selectorId: CLASS_DESCRIPTION_SELECTOR_ID,
    tabInputSets,
    onTabInputSetChange,
    constraints: CLASS_DESCRIPTION_NODE_CONSTRAINTS,
    consumeNodeInputRequests: false,
  });
  // Optional few-shot example node, surfaced only in AI mode. Persists in its own
  // input set so it round-trips with the rest of the tab state.
  const exampleNodeInputs = useTabNodeInputs({
    selectorId: EXAMPLE_NODE_SELECTOR_ID,
    tabInputSets,
    onTabInputSetChange,
    constraints: EXAMPLE_NODE_CONSTRAINTS,
    consumeNodeInputRequests: false,
  });

  const renderAnnotationColumnPicker = ({ nodeId, columns }: NodeInputColumnAddonArgs) => {
    const value = annotationTargets[nodeId] ?? START_NEW_ANNOTATION_VALUE;
    return (
      <AnnotationColumnPicker
        label="Annotation Column"
        value={value}
        placeholder="Select annotation column"
        disabled={controlsLocked}
        options={[
          { value: START_NEW_ANNOTATION_VALUE, label: 'Start new annotation' },
          ...columns.map((column) => ({ value: column, label: column })),
        ]}
        onValueChange={(next) => {
          setAnnotationTarget(nodeId, next);
        }}
      />
    );
  };

  const renderDescriptionColumnPicker = ({ nodeId, columns, column }: NodeInputColumnAddonArgs) => {
    const fallback = resolveDescriptionColumn(columns, column);
    const value = descriptionColumns[nodeId] ?? fallback;
    return (
      <AnnotationColumnPicker
        label="Description Column"
        value={value}
        placeholder="Select description column"
        disabled={controlsLocked}
        options={columns.map((column) => ({ value: column, label: column }))}
        onValueChange={(next) => {
          setDescriptionColumns((current) => ({ ...current, [nodeId]: next }));
        }}
      />
    );
  };

  const renderNewAnnotationColumnInput = ({ nodeId, columns }: NodeInputColumnAddonArgs) => {
    const annotationColumn = annotationTargets[nodeId] ?? START_NEW_ANNOTATION_VALUE;
    if (annotationColumn !== START_NEW_ANNOTATION_VALUE) return null;
    const defaultName = computeDefaultAnnotationColumnName(columns);
    const inputId = `annotation-new-column-name-${nodeId}`;
    return (
      <div className="flex flex-col gap-1">
        <Label htmlFor={inputId} className="block text-xs font-medium text-muted-foreground">
          New Column Name
        </Label>
        <Input
          id={inputId}
          aria-label="New Column Name"
          value={newColumnNames[nodeId] ?? ''}
          placeholder={defaultName}
          disabled={controlsLocked}
          onChange={(event) => {
            const { value } = event.target;
            setNewColumnNames((current) => ({ ...current, [nodeId]: value }));
          }}
        />
      </div>
    );
  };

  // Annotation-column picker for the AI example selector. Mirrors the source
  // selector's addon but offers only existing columns (no "Start new
  // annotation"), since examples point at columns that already hold labels.
  const renderExampleAnnotationColumnPicker = ({ nodeId, columns }: NodeInputColumnAddonArgs) => {
    const value = exampleAnnotationColumns[nodeId] ?? '';
    return (
      <AnnotationColumnPicker
        label="Annotation Column"
        value={value}
        placeholder="Select annotation column"
        disabled={controlsLocked}
        options={columns.map((column) => ({ value: column, label: column }))}
        onValueChange={(next) => {
          setExampleAnnotationColumns((current) => ({ ...current, [nodeId]: next }));
        }}
      />
    );
  };

  const classDescriptionNode = classNodeInputs.resolvedNodes[0] ?? null;
  const classDescriptionClassColumn =
    classDescriptionNode?.column ?? classNodeInputs.inputs[0]?.column ?? null;
  const classDescriptionColumns =
    classDescriptionNode?.columnOptions.map((option) => option.name) ?? [];
  const classDescriptionDescriptionColumn =
    classDescriptionNode && classDescriptionClassColumn
      ? (descriptionColumns[classDescriptionNode.id] ??
        resolveDescriptionColumn(classDescriptionColumns, classDescriptionClassColumn))
      : null;
  // Reuse the editor's class-description query for AI Preview gating. The hook
  // owns the disabled key/fetcher/normalization, so this parent only decides
  // whether there is at least one non-empty class name to predict into.
  const classDescriptions = useAnnotationClassDescriptions({
    workspaceId: currentWorkspaceId ?? null,
    nodeId: classDescriptionNode?.id ?? null,
    classColumn: classDescriptionClassColumn,
    descriptionColumn: classDescriptionDescriptionColumn,
  });
  // Count only non-empty class names: an empty class node (or one whose rows are all
  // blank) offers nothing to classify into, so Preview must stay disabled until at
  // least one real class exists.
  const aiClassCount = classDescriptions.rows.filter((row) => row.class.trim().length > 0).length;
  // Source node drives the run action: "Start new annotation" begins a fresh
  // pass, while picking an existing column resumes annotating that column.
  const sourceNode = sourceNodeInputs.resolvedNodes[0] ?? null;
  const sourceAnnotationColumn = sourceNode
    ? (annotationTargets[sourceNode.id] ?? START_NEW_ANNOTATION_VALUE)
    : START_NEW_ANNOTATION_VALUE;
  const isStartNewAnnotation = sourceAnnotationColumn === START_NEW_ANNOTATION_VALUE;
  const sourceColumns = sourceNode?.columnOptions.map((option) => option.name) ?? [];
  const defaultNewColumnName = computeDefaultAnnotationColumnName(sourceColumns);
  const newColumnName = sourceNode ? (newColumnNames[sourceNode.id] ?? '') : '';
  const resolvedAnnotationColumn = isStartNewAnnotation
    ? newColumnName.trim() || defaultNewColumnName
    : sourceAnnotationColumn;

  // AI-mode preview wiring. Resolve the selected provider (built-in or custom),
  // its persisted key, and the prompt (user text or the grayed default). The
  // Preview button is gated on having a runnable provider/model/key plus a class
  // node with both columns chosen AND at least one class row — the backend needs a
  // non-empty class list to classify into, so previewing an empty class node would
  // only ever return blanks.
  const resolvedAiProvider = getBuiltinProvider(aiProvider);
  const configuredProviders = providerCredentials.annotation as Partial<
    Record<BuiltinAnnotationAiProviderId, boolean>
  >;
  const providerConfigured = configuredProviders[resolvedAiProvider.id] === true;
  const resolvedSystemPrompt = aiPrompt.trim() || DEFAULT_ANNOTATION_PROMPT;
  const hasClassNodeForAi = Boolean(
    classDescriptionNode && classDescriptionClassColumn && classDescriptionDescriptionColumn,
  );
  const canPreviewAi =
    Boolean(sourceNode) &&
    hasClassNodeForAi &&
    aiClassCount > 0 &&
    canAnnotate(resolvedAiProvider, providerConfigured, aiModel);

  // Manual Start creates the nullable string column as one ordinary Data Block
  // edit. Later dropdown changes are independent set_cell edits, so the normal
  // Data View Undo/Redo history applies to both operations.
  const handleRunAnnotation = async (): Promise<boolean> => {
    if (!sourceNode || !currentWorkspaceId) return false;
    if (!isStartNewAnnotation) {
      setHasRun(true);
      return true;
    }
    const columnName = resolvedAnnotationColumn;
    setIsStarting(true);
    try {
      await polarsExpressionApply(
        sourceNode.id,
        {
          context: 'with_columns',
          expressions: [
            { code: `pl.lit(None, dtype=pl.String).alias(${JSON.stringify(columnName)})` },
          ],
          group_by: [],
          name: null,
        },
        'update',
      );
      setAnnotationTarget(sourceNode.id, columnName);
      setHasRun(true);
      return true;
    } catch (error) {
      console.warn('[annotation] Failed to start annotation:', error);
      toast.error(error instanceof Error ? error.message : 'Could not start annotation');
      return false;
    } finally {
      setIsStarting(false);
    }
  };

  // Reset: clear the results and unlock the setup, but keep the source node
  // pointed at the column Start created — the card returns to resume mode on
  // that same column, not to "Start new annotation". Clicking the button again
  // (now "Resume") simply re-reveals the results for that column.
  const handleReset = () => {
    setHasRun(false);
  };

  const handleCreateClassTable = async () => {
    if (!sourceNode || !currentWorkspaceId) return;
    setIsCreatingClassTable(true);
    try {
      const sourceColumn = sqlIdentifier(sourceNode.column);
      const created = await createSqlDataBlock(
        [sourceNode.id],
        `SELECT CAST(${sourceColumn} AS VARCHAR) AS ${sqlIdentifier('class')}, CAST(${sourceColumn} AS VARCHAR) AS ${sqlIdentifier('description')} FROM ${sqlTable(sourceNode.id)} LIMIT 0`,
        derivedDataBlockName(sourceNode.name, 'annotation_classes'),
      );
      onTabInputSetChange(
        CLASS_DESCRIPTION_SELECTOR_ID,
        nodeInputsFromSelections([{ nodeId: created.id, column: 'class' }]),
      );
      setDescriptionColumns((current) => ({ ...current, [created.id]: 'description' }));
      toast.success('Created an empty class-description Data Block.');
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not create the class-description Data Block.',
      );
    } finally {
      setIsCreatingClassTable(false);
    }
  };

  const aiClasses = classDescriptions.rows.reduce<{ name: string; description: string }[]>(
    (rows, row) => {
      const name = row.class.trim();
      if (!name || rows.some((item) => item.name === name)) return rows;
      rows.push({ name, description: row.description });
      return rows;
    },
    [],
  );
  const normalizedReasoningEffort: 'low' | 'medium' | 'high' =
    aiReasoningEffort === 'low' || aiReasoningEffort === 'high' ? aiReasoningEffort : 'medium';
  // Full AI runs always derive a new Data Block. Selecting an existing source
  // column remains a manual-only resume operation because the worker never
  // mutates or overwrites its immutable input snapshot.
  const currentAiRequest: AnnotationAnalysisRequest | null =
    sourceNode &&
    currentWorkspaceId &&
    isStartNewAnnotation &&
    !sourceColumns.includes(resolvedAnnotationColumn) &&
    canPreviewAi
      ? {
          kind: 'annotation',
          node_id: sourceNode.id,
          text_column: sourceNode.column,
          annotation_column: resolvedAnnotationColumn,
          classes: aiClasses,
          provider: resolvedAiProvider.requestProviderId,
          model: aiModel,
          instruction: resolvedSystemPrompt,
          temperature: aiTemperature,
          reasoning_enabled: aiReasoningEnabled,
          reasoning_effort: normalizedReasoningEffort,
          output_node_name: derivedDataBlockName(
            sourceNode.name,
            `annotated_${resolvedAnnotationColumn}`,
          ),
        }
      : null;

  const {
    request: rawServerAiRequest,
    result: aiResult,
    isRunning: isAiRunning,
    isStopping: isAiStopping,
    setIsRunning: setIsAiRunning,
    setLocalTaskId: setLocalAiTaskId,
    runningRef: aiRunningRef,
    lastFetchedRef: aiLastFetchedRef,
    taskStatus: aiTaskStatus,
    banner: aiBanner,
    clearResults: clearAiResults,
    stopTask: stopAiTask,
  } = useAnalysisFeature<AnnotationResult, AnnotationAnalysisRequest>({
    taskType: ANALYSIS_TASK_TYPES.annotation,
    workspaceId: currentWorkspaceId,
    tabId: host.tabId,
    hydrationTaskId: tabTaskId,
    fetchResult: async (analysisId) => {
      if (!currentWorkspaceId) throw new Error('No workspace selected');
      const result = await getAnalysisOutputResource(currentWorkspaceId, analysisId);
      if (result.kind !== 'annotation') {
        throw new Error('Annotation Analysis returned the wrong Result kind');
      }
      return result;
    },
    onRequest: (request) => {
      const hydrated = request;
      setAnnotationMode('ai');
      onTabInputSetChange(
        DEFAULT_TAB_INPUT_SET_ID,
        nodeInputsFromSelections([{ nodeId: hydrated.node_id, column: hydrated.text_column }]),
      );
      setAnnotationTarget(hydrated.node_id, START_NEW_ANNOTATION_VALUE);
      setNewColumnNames((current) => ({
        ...current,
        [hydrated.node_id]: hydrated.annotation_column,
      }));
      persistAiProviderModels({ ...aiProviderModels, [hydrated.provider]: hydrated.model });
      selectAiProvider(hydrated.provider, hydrated.model);
      setAiPrompt(hydrated.instruction);
      commitAiPrompt(hydrated.instruction);
      commitAiTemperature(hydrated.temperature ?? 0);
      setAiReasoningEnabled(hydrated.reasoning_enabled ?? false);
      setAiReasoningEffort(hydrated.reasoning_effort ?? 'medium');
    },
    onCleared: (_, options) => {
      setIsPreviewing(false);
      if (!options?.preserveLocalState) onTabTaskChange(null);
    },
  });
  const serverAiRequest = rawServerAiRequest;
  const aiActionState = getRerunActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    isRunnable: Boolean(currentAiRequest),
    hasAttachedAnalysis: Boolean(tabTaskId),
    analysisState: aiTaskStatus.tasks[0]?.state ?? null,
    hasChanges: !serverAiRequest || hasParameterDiff(currentAiRequest, serverAiRequest),
    isBusy: isAiRunning,
  });
  const controlsLocked = isLocked || isAiRunning;

  const runFreshAiAnalysis = async () => {
    if (!currentAiRequest || !currentWorkspaceId || aiRunningRef.current) return;
    await runAnalysisTaskEnvelope<Analysis>({
      lastFetchedRef: aiLastFetchedRef,
      runningRef: aiRunningRef,
      setIsRunning: setIsAiRunning,
      setLocalTaskId: setLocalAiTaskId,
      onTaskIdAssigned: onTabTaskChange,
      resetBeforeRun: () => {
        setIsPreviewing(false);
      },
      submit: async () => {
        const { data } = await submitTabAnalysisWithProviderCredential({
          workspaceId: currentWorkspaceId,
          tabId: host.tabId,
          request: currentAiRequest,
        });
        return data;
      },
      onSuccess: () => undefined,
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'Could not run Annotation Analysis.');
      },
    });
  };

  const handleRunOrUpdateAi = async () => {
    await executeAnalysisRerun({
      hasAttachedAnalysis: Boolean(tabTaskId),
      clearResults: clearAiResults,
      runFreshAnalysis: runFreshAiAnalysis,
    });
  };

  // Preview is a cancellable Query projection only. Opening or closing it never
  // creates a column, changes a Data Block, or changes the attached Analysis.
  const aiPreviewSession = useAnnotationAiPreviewSession({
    workspaceId: currentWorkspaceId ?? null,
    nodeId: sourceNode?.id ?? null,
    textColumn: sourceNode?.column ?? '',
    annotationColumn: resolvedAnnotationColumn,
    classNodeId: classDescriptionNode?.id ?? null,
    classColumn: classDescriptionClassColumn,
    descriptionColumn: classDescriptionDescriptionColumn,
    providerId: resolvedAiProvider.requestProviderId,
    model: aiModel,
    systemPrompt: resolvedSystemPrompt,
    temperature: aiTemperature,
    reasoningEnabled: aiReasoningEnabled,
    reasoningEffort: aiReasoningEffort,
    credentialRevision: providerCredentials.revision,
    isOpen: isPreviewing,
    targetValid: true,
    onOpenChange: setIsPreviewing,
    prepareOpen: () => Promise.resolve(canPreviewAi),
    onExplicitClose: () => undefined,
  });

  /** Opens a prepared session or performs the explicit clear-and-unlock close. */
  /** Passed to: the AI-mode footer button. */
  const handleToggleAiPreview = async () => {
    if (isPreviewing) {
      aiPreviewSession.commands.close();
      return;
    }
    await aiPreviewSession.commands.open();
  };
  const aiOutputNodeId = aiResult?.output_node_ids[0] ?? null;
  const aiResultRequest = serverAiRequest ?? currentAiRequest;

  return (
    <section aria-label="Annotation Setup" className="space-y-5">
      <div className="relative">
        <section aria-label="Annotation Parameter Panel">
          <AnalysisCardLayout
            title="Annotation"
            actions={
              annotationMode === 'ai'
                ? {
                    onRun: handleRunOrUpdateAi,
                    onStop: stopAiTask,
                    onClear: async () => {
                      await clearAiResults();
                    },
                    runDisabled: aiActionState.runDisabled,
                    runDisabledReason: !isStartNewAnnotation
                      ? 'AI Annotation creates a new Data Block; choose Start new annotation'
                      : aiActionState.runDisabledReason,
                    clearDisabled: aiActionState.clearDisabled,
                    isRunning: isAiRunning,
                    isStopping: isAiStopping,
                    hasResult: Boolean(aiResult),
                    runLabel: aiActionState.runLabel,
                    extraContent: (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={
                          isPreviewing
                            ? !aiPreviewSession.commands.canToggle
                            : !canPreviewAi || isStarting || isAiRunning
                        }
                        onClick={() => {
                          void handleToggleAiPreview();
                        }}
                      >
                        {isPreviewing ? 'Close preview' : 'Preview'}
                      </Button>
                    ),
                  }
                : undefined
            }
            footer={
              annotationMode === 'manual' ? (
                <Button
                  type="button"
                  disabled={!sourceNode || isStarting}
                  onClick={() => {
                    if (hasRun) {
                      handleReset();
                    } else {
                      void handleRunAnnotation();
                    }
                  }}
                >
                  {hasRun ? 'Reset' : isStartNewAnnotation ? 'Start' : 'Resume'}
                </Button>
              ) : undefined
            }
          >
            <div>
              <NodeInputsPanel
                title="Selected Data Blocks"
                resolvedNodes={sourceNodeInputs.resolvedNodes}
                availableNodes={sourceNodeInputs.availableNodes}
                graphSelectedIds={sourceNodeInputs.graphSelectedIds}
                recentPresets={sourceNodeInputs.recentPresets}
                canAddMore={sourceNodeInputs.canAddMore}
                maxNodes={1}
                onAddNodes={sourceNodeInputs.addNodes}
                getAddRejection={sourceNodeInputs.getAddRejection}
                onRemoveNode={sourceNodeInputs.removeNode}
                onClear={sourceNodeInputs.clear}
                onColumnChange={sourceNodeInputs.setColumn}
                columnLabel="Text Column"
                renderColumnAddon={renderAnnotationColumnPicker}
                renderExtraNodeContent={renderNewAnnotationColumnInput}
                disabled={controlsLocked}
              />
            </div>

            <section
              aria-label="Class Description Setup"
              className="mt-5 rounded-lg border bg-background/60 p-4"
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-semibold">Class Descriptions</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!sourceNode || controlsLocked || isCreatingClassTable}
                  onClick={() => {
                    void handleCreateClassTable();
                  }}
                >
                  {isCreatingClassTable ? 'Creating...' : 'Create empty Data Block'}
                </Button>
              </div>
              <div>
                <NodeInputsPanel
                  title="Class Description Node"
                  resolvedNodes={classNodeInputs.resolvedNodes}
                  availableNodes={classNodeInputs.availableNodes}
                  canAddMore={classNodeInputs.canAddMore}
                  maxNodes={1}
                  onAddNodes={classNodeInputs.addNodes}
                  getAddRejection={classNodeInputs.getAddRejection}
                  onRemoveNode={classNodeInputs.removeNode}
                  onClear={classNodeInputs.clear}
                  onColumnChange={classNodeInputs.setColumn}
                  columnLabel="Class Column"
                  disabled={controlsLocked}
                  renderColumnAddon={renderDescriptionColumnPicker}
                />
              </div>
              <AnnotationClassDescriptionsEditor
                key={[
                  classDescriptionNode?.id ?? 'none',
                  classDescriptionClassColumn ?? 'none',
                  classDescriptionDescriptionColumn ?? 'none',
                ].join(':')}
                workspaceId={currentWorkspaceId ?? null}
                nodeId={classDescriptionNode?.id ?? null}
                classColumn={classDescriptionClassColumn}
                descriptionColumn={classDescriptionDescriptionColumn}
              />
            </section>

            <section
              aria-label="Annotation Mode"
              className="mt-5 rounded-lg border bg-background/60 p-4"
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'text-sm font-medium',
                    annotationMode === 'manual' ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  Manual
                </span>
                <Switch
                  checked={annotationMode === 'ai'}
                  disabled={controlsLocked}
                  aria-label="Toggle AI annotation mode"
                  onCheckedChange={(checked) => {
                    setAnnotationMode(checked ? 'ai' : 'manual');
                    // Leaving AI mode closes the preview so it does not linger when
                    // the AI footer button is no longer visible to toggle it off.
                    if (!checked) setIsPreviewing(false);
                  }}
                />
                <span
                  className={cn(
                    'text-sm font-medium',
                    annotationMode === 'ai' ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  AI
                </span>
              </div>
              {annotationMode === 'ai' ? (
                <div className="mt-4">
                  <AnnotationAiSettings
                    workspaceId={currentWorkspaceId ?? null}
                    provider={aiProvider}
                    onProviderChange={selectAiProvider}
                    configuredProviders={configuredProviders}
                    credentialRevision={providerCredentials.revision}
                    providerModels={aiProviderModels}
                    model={aiModel}
                    disabled={controlsLocked}
                  >
                    <div className="space-y-2">
                      <Label className="block text-xs font-medium text-muted-foreground">
                        Example Data Block
                        <span className="ml-1 font-normal">(optional)</span>
                      </Label>
                      <NodeInputsPanel
                        title="Example Node"
                        resolvedNodes={exampleNodeInputs.resolvedNodes}
                        availableNodes={exampleNodeInputs.availableNodes}
                        canAddMore={exampleNodeInputs.canAddMore}
                        maxNodes={1}
                        onAddNodes={exampleNodeInputs.addNodes}
                        getAddRejection={exampleNodeInputs.getAddRejection}
                        onRemoveNode={exampleNodeInputs.removeNode}
                        onClear={exampleNodeInputs.clear}
                        onColumnChange={exampleNodeInputs.setColumn}
                        columnLabel="Text Column"
                        renderColumnAddon={renderExampleAnnotationColumnPicker}
                        disabled={controlsLocked}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label
                        htmlFor="annotation-ai-prompt"
                        className="block text-xs font-medium text-muted-foreground"
                      >
                        Prompt
                        <span className="ml-1 font-normal">(optional)</span>
                      </Label>
                      <AnnotationPromptInput
                        id="annotation-ai-prompt"
                        value={aiPrompt}
                        onChange={setAiPrompt}
                        onCommit={commitAiPrompt}
                        defaultPrompt={DEFAULT_ANNOTATION_PROMPT}
                        disabled={controlsLocked}
                      />
                    </div>
                    <AnnotationInferenceSettings
                      temperature={aiTemperature}
                      onTemperatureCommit={commitAiTemperature}
                      reasoningEnabled={aiReasoningEnabled}
                      onReasoningEnabledChange={setAiReasoningEnabled}
                      reasoningEffort={aiReasoningEffort}
                      onReasoningEffortChange={setAiReasoningEffort}
                      disabled={controlsLocked}
                    />
                  </AnnotationAiSettings>
                </div>
              ) : null}
            </section>
          </AnalysisCardLayout>
        </section>
      </div>
      {annotationMode === 'ai' && aiBanner ? (
        <AnalysisTaskBanner
          analysisName="Annotation"
          status={aiBanner.status}
          taskId={aiBanner.taskId}
          message={aiBanner.message}
        />
      ) : null}
      {annotationMode === 'manual' && hasRun && sourceNode ? (
        <AnnotationResultsPanel
          key={`${sourceNode.id}:${resolvedAnnotationColumn}`}
          workspaceId={currentWorkspaceId ?? null}
          nodeId={sourceNode.id}
          textColumn={sourceNode.column}
          annotationColumn={resolvedAnnotationColumn}
          classNodeId={classDescriptionNode?.id ?? null}
          classColumn={classDescriptionClassColumn}
          descriptionColumn={classDescriptionDescriptionColumn}
        />
      ) : null}
      {annotationMode === 'ai' && aiResult && aiOutputNodeId && aiResultRequest ? (
        <AnnotationResultsPanel
          key={`${aiOutputNodeId}:${aiResult.annotation_column}`}
          workspaceId={currentWorkspaceId ?? null}
          nodeId={aiOutputNodeId}
          textColumn={aiResultRequest.text_column}
          annotationColumn={aiResult.annotation_column}
          classNodeId={classDescriptionNode?.id ?? null}
          classColumn={classDescriptionClassColumn}
          descriptionColumn={classDescriptionDescriptionColumn}
        />
      ) : null}
      {annotationMode === 'ai' && isPreviewing && sourceNode ? (
        <AnnotationAiPreviewPanel session={aiPreviewSession} />
      ) : null}
    </section>
  );
}

export default AnnotationFeature;
