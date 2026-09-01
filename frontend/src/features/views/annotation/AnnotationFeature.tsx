import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Analysis, AnnotationResult, AnnotationRunAllResult } from '@/api';
import { sqlIdentifier, sqlTable } from '@/api';
import { Button } from '@/components/ui/button';
import { useGuidance } from '@/features/guidance/GuidanceContext';
import { CONTEXTUAL_HINT_IDS } from '@/features/guidance/registry';
import { useProgressiveContextualHints } from '@/features/guidance/useProgressiveContextualHints';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
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
import {
  submitAnnotationRunAllWithProviderCredential,
  submitTabAnalysisWithProviderCredential,
} from '@/features/provider-credentials/providerCredentialRequests';
import { useProviderCredentials } from '@/features/provider-credentials/useProviderCredentials';
import { AnalysisCardLayout } from '@/features/views/common/components/AnalysisCardLayout';
import { RunAllReviewTable } from '@/features/views/common/components/RunAllReviewTable';
import { DEFAULT_INTERCODER_RELIABILITY_METRIC } from '@/features/views/common/columnComparisonModel';
import type { NodeInputColumnAddonArgs } from '@/features/views/common/components/NodeInputsPanel';
import { NodeInputsPanel } from '@/features/views/common/components/NodeInputsPanel';
import type { NodeInputConstraints } from '@/features/views/common/nodeInputs';
import { nodeInputsFromSelections, useTabNodeInputs } from '@/features/views/common/nodeInputs';
import type { AnalysisTabFeatureProps } from '@/features/views/common/tabs/AnalysisTabsHost';
import { DEFAULT_TAB_INPUT_SET_ID } from '@/features/views/common/tabs/tabStateOps';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useNodeColumnInfos } from '@/features/workspace/common/hooks/useNodeColumnInfos';
import { cn } from '@/lib/utils';
import { queryKeys } from '@/lib/queryKeys';
import { isArrowStringField } from '@/lib/arrow/arrowTable';
import { getAnalysisOutputResource } from '../common/analysisApi';
import { ANALYSIS_TASK_TYPES } from '../common/analysisIds';
import AnalysisTaskBanner from '../common/components/AnalysisTaskBanner';
import { type AnalysisRequestOfKind, useAnalysisFeature } from '../common/hooks/useAnalysisFeature';
import { usePersistNodeDocumentColumn } from '../common/hooks/usePersistNodeDocumentColumn';
import { useNodeColorControls } from '../common/hooks/useNodeColorControls';
import { GREY } from '../common/vizPalette';
import { hasParameterDiff } from '../common/parameterComparison';
import { getRerunActionState } from '../common/rerunActionState';
import {
  getAnalysisActionLifecycle,
  hasClearRequiredAnalysis,
} from '../common/analysisActionLifecycle';
import { canAnnotate, canListModels, resolveAnnotationProviderConfiguration } from './aiProviders';
import { AnnotationAiPreviewPanel } from './components/AnnotationAiPreviewPanel';
import { AnnotationAiSettings } from './components/AnnotationAiSettings';
import { AnnotationClassDescriptionsEditor } from './components/AnnotationClassDescriptionsEditor';
import { AnnotationExampleSamplingControls } from './components/AnnotationExampleSamplingControls';
import { AnnotationInferenceSettings } from './components/AnnotationInferenceSettings';
import {
  AnnotationPromptInput,
  DEFAULT_ANNOTATION_PROMPT,
} from './components/AnnotationPromptInput';
import { AnnotationResultsPanel } from './components/AnnotationResultsPanel';
import { CreateStringColumnDialog } from './components/CreateStringColumnDialog';
import { useAnnotationAiPreview } from './hooks/useAnnotationAiPreview';
import { useAnnotationClassDescriptions } from './hooks/useAnnotationClassDescriptions';
import { useAnnotationTabSettings } from './hooks/useAnnotationTabSettings';

const SOURCE_NODE_CONSTRAINTS: NodeInputConstraints = {
  fieldPredicate: isArrowStringField,
  maxNodes: 1,
};
const CLASS_DESCRIPTION_NODE_CONSTRAINTS: NodeInputConstraints = {
  fieldPredicate: isArrowStringField,
  maxNodes: 1,
};
const CLASS_DESCRIPTION_SELECTOR_ID = 'classDescriptions';
// Optional example selector used only in AI mode: one string node whose text +
// annotation columns can later seed few-shot examples for AI annotation.
const EXAMPLE_NODE_SELECTOR_ID = 'exampleNodes';
const EXAMPLE_NODE_CONSTRAINTS: NodeInputConstraints = {
  fieldPredicate: isArrowStringField,
  maxNodes: 1,
};
const CREATE_ANNOTATION_COLUMN_ACTION = '__create_annotation_column__';
const DEFAULT_ANNOTATION_COLUMN_NAME = 'annotation';

interface ManualReviewSnapshot {
  nodeId: string;
  sourceColumns: string[];
  sourceColor: string;
  rowCount: number;
  textColumn: string;
  annotationColumn: string;
  classNodeId: string | null;
  classColumn: string | null;
  descriptionColumn: string | null;
  correctionColumn: string | null;
}

type CreateColumnDialogState =
  | { kind: 'annotation'; nodeId: string; columns: string[] }
  | { kind: 'correction'; nodeId: string; annotationColumn: string; columns: string[] };

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

const derivedDataBlockName = (sourceName: string, suffix: string): string =>
  `${sourceName.trim() || 'data_block'}_${suffix}`.slice(0, 500);

/**
 * Small select used for Annotation-specific companion columns next to the
 * shared NodeInputsPanel column picker.
 *
 * Used by: AnnotationFeature's source and Codebook selectors because
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
      <Label className="block text-label-secondary font-medium text-description">{label}</Label>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger aria-label={label} className="w-full text-body">
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
 * selection plus a Codebook setup card with an inline editable table.
 *
 * Rendered by: the viewComponents tabbed loader through AnalysisTabsHost so
 * Annotation shares the same workflow shell as other analysis-style views.
 *
 * Flow: bind both selectors to named input sets on the active tab, render
 * Annotation-specific companion column pickers, create/select a backend
 * Codebook Data Block when requested, and load/save editable code rows.
 */
function AnnotationFeature({ host }: AnalysisTabFeatureProps) {
  const { reachContextualHint } = useGuidance();
  const {
    latestPreview,
    latestRunAll,
    activeAnalysis,
    analyses,
    refreshAnalyses,
    inputSets: tabInputSets,
    setInputSet: onTabInputSetChange,
    settings: tabSettings,
    setSetting: onTabSettingChange,
  } = host;
  const tabTaskId = latestPreview?.id ?? null;
  const [descriptionColumns, setDescriptionColumns] = useState<Record<string, string>>({});
  const [createColumnDialog, setCreateColumnDialog] = useState<CreateColumnDialogState | null>(
    null,
  );
  const [newColumnName, setNewColumnName] = useState('');
  const [createColumnError, setCreateColumnError] = useState<string | null>(null);
  const [manualReviewSnapshot, setManualReviewSnapshot] = useState<ManualReviewSnapshot | null>(
    null,
  );
  const [isCreatingColumn, setIsCreatingColumn] = useState(false);
  const [isStartingManualReview, setIsStartingManualReview] = useState(false);
  const [isCreatingClassTable, setIsCreatingClassTable] = useState(false);
  // Tab-persisted AI settings live in their own hook so this feature body can
  // focus on selector, run, and results orchestration. API keys stay behind the
  // credential facade, never in tab settings.
  const {
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
    annotationComparisonColumns,
    setAnnotationComparisonColumns,
    annotationReliabilityMetrics,
    setAnnotationReliabilityMetric,
    annotationMetadataColumns,
    setAnnotationMetadataColumns,
    annotationTableHeight,
    setAnnotationTableHeight,
  } = useAnnotationTabSettings({
    tabSettings,
    onTabSettingChange,
    excludedRoleColumns: host.correctionColumns,
  });
  const providerCredentials = useProviderCredentials();
  const selectedAiProvider =
    providerCredentials.annotationProviders.find(
      (configuration) => configuration.id === aiProviderConfigurationId,
    ) ?? null;

  useEffect(() => {
    if (selectedAiProvider) return;
    const fallback = resolveAnnotationProviderConfiguration(
      providerCredentials.annotationProviders,
      aiProviderConfigurationId,
      aiProviderType,
    );
    if (fallback) {
      selectAiProvider(fallback.id, fallback.provider, aiProviderModels[fallback.id] ?? '');
    } else if (aiProviderConfigurationId) {
      clearAiProvider();
    }
  }, [
    aiProviderConfigurationId,
    aiProviderModels,
    aiProviderType,
    clearAiProvider,
    providerCredentials.annotationProviders,
    selectAiProvider,
    selectedAiProvider,
  ]);
  // Annotation-column choice per example node (plain columns only — no "Start
  // new annotation" option, since examples reference existing labels).
  const [exampleAnnotationColumns, setExampleAnnotationColumns] = useState<Record<string, string>>(
    {},
  );
  const { currentWorkspaceId, nodes } = useWorkspaceData();
  const {
    polarsExpressionApply,
    createSqlDataBlock,
    setNodeColor: persistNodeColor,
  } = useWorkspaceActions();
  const persistDocumentColumn = usePersistNodeDocumentColumn({
    workspaceId: currentWorkspaceId,
  });

  const sourceNodeInputs = useTabNodeInputs({
    selectorId: DEFAULT_TAB_INPUT_SET_ID,
    tabInputSets,
    onTabInputSetChange,
    constraints: SOURCE_NODE_CONSTRAINTS,
    deferNodeInputPlacement: true,
  });
  const handleSourceTextColumnChange = (nodeId: string, column: string) => {
    sourceNodeInputs.setColumn(nodeId, column);
    void persistDocumentColumn(nodeId, column);
  };
  const annotationRunAll =
    latestRunAll?.request.kind === 'annotation_run_all' ? latestRunAll : null;
  const annotationRunAllSource =
    annotationRunAll?.request.kind === 'annotation_run_all'
      ? annotationRunAll.request.source
      : null;
  const classNodeInputs = useTabNodeInputs({
    selectorId: CLASS_DESCRIPTION_SELECTOR_ID,
    tabInputSets,
    onTabInputSetChange,
    constraints: CLASS_DESCRIPTION_NODE_CONSTRAINTS,
    deferNodeInputPlacement: true,
  });
  // Optional few-shot example node, surfaced only in AI mode. Persists in its own
  // input set so it round-trips with the rest of the tab state.
  const exampleNodeInputs = useTabNodeInputs({
    selectorId: EXAMPLE_NODE_SELECTOR_ID,
    tabInputSets,
    onTabInputSetChange,
    constraints: EXAMPLE_NODE_CONSTRAINTS,
    deferNodeInputPlacement: true,
  });
  const handleExampleTextColumnChange = (nodeId: string, column: string) => {
    exampleNodeInputs.setColumn(nodeId, column);
    void persistDocumentColumn(nodeId, column);
  };

  const renderAnnotationColumnPicker = ({ nodeId, columns }: NodeInputColumnAddonArgs) => {
    const value = annotationTargets[nodeId] ?? '';
    const selectedColumnOption = value && !columns.includes(value) ? [{ value, label: value }] : [];
    return (
      <AnnotationColumnPicker
        label="Annotation Column"
        value={value}
        placeholder="Select annotation column"
        disabled={controlsLocked}
        options={[
          { value: CREATE_ANNOTATION_COLUMN_ACTION, label: 'Start new annotation' },
          ...selectedColumnOption,
          ...columns.map((column) => ({ value: column, label: column })),
        ]}
        onValueChange={(next) => {
          if (next === CREATE_ANNOTATION_COLUMN_ACTION) {
            setNewColumnName('');
            setCreateColumnError(null);
            setCreateColumnDialog({ kind: 'annotation', nodeId, columns });
            return;
          }
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
  // Reuse the editor's Codebook query for AI Preview gating. The hook
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
  // Source node drives manual and AI annotation through one selected, existing
  // annotation column. Creating a column is a separate immediate Data Block edit.
  const sourceNode = sourceNodeInputs.resolvedNodes[0] ?? null;
  const sourceColumns = sourceNode?.columnOptions.map((option) => option.name) ?? [];
  const { defaultPalette, nodeColors, setNodeColor, ensureNodeColors } = useNodeColorControls({
    nodeIds: sourceNode ? [sourceNode.id] : [],
    nodes: sourceNode ? [sourceNode.node] : [],
    persistNodeColor,
  });
  const sourceColor = sourceNode ? nodeColors[sourceNode.id] : undefined;
  const resolvedAnnotationColumn = sourceNode ? (annotationTargets[sourceNode.id] ?? '') : '';
  const selectedAnnotationColumnExists =
    resolvedAnnotationColumn.length > 0 && sourceColumns.includes(resolvedAnnotationColumn);
  const storedAiCorrectionColumn = sourceNode ? (host.correctionColumns[sourceNode.id] ?? '') : '';
  const aiCorrectionColumn =
    storedAiCorrectionColumn &&
    sourceColumns.includes(storedAiCorrectionColumn) &&
    storedAiCorrectionColumn !== sourceNode?.column &&
    storedAiCorrectionColumn !== resolvedAnnotationColumn
      ? storedAiCorrectionColumn
      : null;
  const defaultColumnName =
    createColumnDialog?.kind === 'correction'
      ? `${createColumnDialog.annotationColumn}.correction`
      : DEFAULT_ANNOTATION_COLUMN_NAME;

  // AI-mode preview wiring. Resolve the selected named provider configuration
  // and prompt (user text or the grayed default). The
  // Preview button is gated on having a runnable provider/model/key plus a class
  // node with both columns chosen AND at least one class row — the backend needs a
  // non-empty class list to classify into, so previewing an empty class node would
  // only ever return blanks.
  const resolvedSystemPrompt = aiPrompt.trim() || DEFAULT_ANNOTATION_PROMPT;
  const hasClassNodeForAi = Boolean(
    classDescriptionNode && classDescriptionClassColumn && classDescriptionDescriptionColumn,
  );
  const canPreviewAi =
    Boolean(sourceNode) &&
    selectedAnnotationColumnExists &&
    hasClassNodeForAi &&
    aiClassCount > 0 &&
    canAnnotate(selectedAiProvider, aiModel);

  // Creating an annotation or correction column is the same identity-preserving
  // Data Block edit; only the selected role differs after creation.
  const handleCreateColumn = async () => {
    if (!createColumnDialog || !currentWorkspaceId) return;
    const columnName = newColumnName.trim() || defaultColumnName;
    const currentColumns =
      sourceNodeInputs.resolvedNodes
        .find((node) => node.id === createColumnDialog.nodeId)
        ?.columnOptions.map((option) => option.name) ?? createColumnDialog.columns;
    if (currentColumns.includes(columnName)) {
      setCreateColumnError(`A column named "${columnName}" already exists.`);
      return;
    }
    setCreateColumnError(null);
    setIsCreatingColumn(true);
    try {
      await polarsExpressionApply(
        createColumnDialog.nodeId,
        {
          context: 'with_columns',
          expressions: [
            {
              expression: {
                op: 'cast',
                operand: { op: 'literal', value: null },
                dtype: 'string',
                strict: false,
              },
              alias: columnName,
            },
          ],
          group_by: [],
          name: null,
        },
        'update',
      );
      if (createColumnDialog.kind === 'annotation') {
        setAnnotationTarget(createColumnDialog.nodeId, columnName);
      } else {
        await host.setCorrectionColumn(createColumnDialog.nodeId, columnName);
        setManualReviewSnapshot((current) =>
          current?.nodeId === createColumnDialog.nodeId
            ? {
                ...current,
                correctionColumn: columnName,
                sourceColumns: [...current.sourceColumns, columnName],
              }
            : current,
        );
      }
      setCreateColumnDialog(null);
      setNewColumnName('');
    } catch (error) {
      const role = createColumnDialog.kind;
      console.warn(`[annotation] Failed to create ${role} column:`, error);
      toast.error(error instanceof Error ? error.message : `Could not create the ${role} column.`);
    } finally {
      setIsCreatingColumn(false);
    }
  };

  const setLiveCorrectionColumn = (nodeId: string, column: string | null) => {
    void host.setCorrectionColumn(nodeId, column).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not save the correction column.');
    });
  };

  const openCorrectionColumnDialog = (
    nodeId: string,
    annotationColumn: string,
    columns: string[],
  ) => {
    setNewColumnName('');
    setCreateColumnError(null);
    setCreateColumnDialog({ kind: 'correction', nodeId, annotationColumn, columns });
  };

  const handleUseCorrectionColumnAsExample = (
    nodeId: string,
    textColumn: string,
    correctionColumn: string | null,
  ) => {
    if (!correctionColumn) return;
    onTabInputSetChange(
      EXAMPLE_NODE_SELECTOR_ID,
      nodeInputsFromSelections([{ nodeId, column: textColumn }]),
    );
    setExampleAnnotationColumns((current) => ({
      ...current,
      [nodeId]: correctionColumn,
    }));
  };

  const handleCreateClassTable = async () => {
    if (!sourceNode || !currentWorkspaceId) return;
    setIsCreatingClassTable(true);
    try {
      const sourceColumn = sqlIdentifier(sourceNode.column);
      const created = await createSqlDataBlock(
        [sourceNode.id],
        `SELECT CAST(${sourceColumn} AS VARCHAR) AS ${sqlIdentifier('class')}, CAST(${sourceColumn} AS VARCHAR) AS ${sqlIdentifier('description')} FROM ${sqlTable(sourceNode.id)} LIMIT 0`,
        derivedDataBlockName(sourceNode.name, 'codebook'),
      );
      onTabInputSetChange(
        CLASS_DESCRIPTION_SELECTOR_ID,
        nodeInputsFromSelections([{ nodeId: created.id, column: 'class' }]),
      );
      setDescriptionColumns((current) => ({ ...current, [created.id]: 'description' }));
      toast.success('Created an empty Codebook Data Block.');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not create the Codebook Data Block.',
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
  const exampleNode = exampleNodeInputs.resolvedNodes[0] ?? null;
  const exampleAnnotationColumn = exampleNode
    ? (exampleAnnotationColumns[exampleNode.id] ?? '')
    : '';
  const hasCompleteExample = Boolean(exampleNode && exampleAnnotationColumn);
  // Preview creation captures every selector and setting in one immutable root
  // Analysis. Run All later executes only from that snapshot.
  const currentAiRequest: AnalysisRequestOfKind<'annotation'> | null =
    sourceNode &&
    currentWorkspaceId &&
    selectedAiProvider &&
    selectedAnnotationColumnExists &&
    classDescriptionNode &&
    classDescriptionClassColumn &&
    classDescriptionDescriptionColumn &&
    canPreviewAi
      ? {
          kind: 'annotation',
          node_id: sourceNode.id,
          text_column: sourceNode.column,
          annotation_column: resolvedAnnotationColumn,
          correction_column: aiCorrectionColumn,
          class_node_id: classDescriptionNode.id,
          class_column: classDescriptionClassColumn,
          description_column: classDescriptionDescriptionColumn,
          ...(hasCompleteExample && exampleNode
            ? {
                example_node_id: exampleNode.id,
                example_text_column: exampleNode.column,
                example_annotation_column: exampleAnnotationColumn,
              }
            : {}),
          classes: aiClasses,
          provider_configuration_id: selectedAiProvider.id,
          provider: selectedAiProvider.provider,
          provider_base_url: selectedAiProvider.base_url,
          model: aiModel,
          instruction: resolvedSystemPrompt,
          temperature: aiTemperature,
          max_retries_per_batch: aiMaxRetriesPerBatch,
          max_examples_per_class: aiMaxExamplesPerClass,
          example_sampling_method: aiExampleSamplingMethod,
          example_random_seed: aiExampleRandomSeed,
          reasoning_enabled: aiReasoningEnabled,
          reasoning_effort: normalizedReasoningEffort,
        }
      : null;

  const {
    request: serverAiRequest,
    result: aiResult,
    isRunning: isAiRunning,
    isSubmittingRunAll,
    isStopping: isAiStopping,
    runAnalysis,
    taskStatus: aiTaskStatus,
    banner: aiBanner,
    clearResults: clearAiResults,
    stopTask: stopAiTask,
  } = useAnalysisFeature<AnnotationResult, AnalysisRequestOfKind<'annotation'>>({
    taskType: ANALYSIS_TASK_TYPES.annotation,
    workspaceId: currentWorkspaceId,
    tabId: host.tabId,
    hydrationTaskId: tabTaskId,
    requestHydration:
      !latestPreview && annotationRunAll && annotationRunAllSource
        ? {
            analysisId: annotationRunAll.id,
            request: { ...annotationRunAllSource, kind: 'annotation' },
          }
        : null,
    controlAnalysisId: activeAnalysis?.id ?? null,
    tabAnalysisIds: analyses.map((analysis) => analysis.id),
    fetchResult: async (analysisId) => {
      if (!currentWorkspaceId) throw new Error('No workspace selected');
      const result = await getAnalysisOutputResource(currentWorkspaceId, analysisId);
      if (result.kind !== 'annotation') {
        throw new Error('Annotation Analysis returned the wrong Result kind');
      }
      return result;
    },
    onRequest: (request) => {
      setAnnotationMode('ai');
      onTabInputSetChange(
        DEFAULT_TAB_INPUT_SET_ID,
        nodeInputsFromSelections([{ nodeId: request.node_id, column: request.text_column }]),
      );
      setAnnotationTarget(request.node_id, request.annotation_column);
      onTabInputSetChange(
        CLASS_DESCRIPTION_SELECTOR_ID,
        nodeInputsFromSelections([{ nodeId: request.class_node_id, column: request.class_column }]),
      );
      setDescriptionColumns((current) => ({
        ...current,
        [request.class_node_id]: request.description_column,
      }));
      if (
        request.example_node_id &&
        request.example_text_column &&
        request.example_annotation_column
      ) {
        const exampleNodeId = request.example_node_id;
        const exampleTextColumn = request.example_text_column;
        const exampleAnnotationColumn = request.example_annotation_column;
        onTabInputSetChange(
          EXAMPLE_NODE_SELECTOR_ID,
          nodeInputsFromSelections([{ nodeId: exampleNodeId, column: exampleTextColumn }]),
        );
        setExampleAnnotationColumns((current) => ({
          ...current,
          [exampleNodeId]: exampleAnnotationColumn,
        }));
      } else {
        onTabInputSetChange(EXAMPLE_NODE_SELECTOR_ID, []);
      }
      persistAiProviderModels({
        ...aiProviderModels,
        [request.provider_configuration_id]: request.model,
      });
      selectAiProvider(request.provider_configuration_id, request.provider, request.model);
      setAiPrompt(request.instruction);
      commitAiPrompt(request.instruction);
      commitAiTemperature(request.temperature ?? 0);
      commitAiMaxRetriesPerBatch(request.max_retries_per_batch ?? 2);
      commitAiMaxExamplesPerClass(request.max_examples_per_class ?? 10);
      setAiExampleSamplingMethod(request.example_sampling_method ?? 'random');
      commitAiExampleRandomSeed(request.example_random_seed ?? 0);
      if (!latestPreview && annotationRunAll?.request.kind === 'annotation_run_all') {
        commitAiBatchSize(annotationRunAll.request.batch_size ?? 20);
        setAiProcessingMode(annotationRunAll.request.processing_mode ?? 'reprocess_all');
      }
      setAiReasoningEnabled(request.reasoning_enabled ?? false);
      setAiReasoningEffort(request.reasoning_effort ?? 'medium');
    },
    onCleared: refreshAnalyses,
  });
  const previewCorrectionColumn = serverAiRequest
    ? (host.correctionColumns[serverAiRequest.node_id] ?? null)
    : null;
  const reviewCorrectionColumn = annotationRunAllSource
    ? (host.correctionColumns[annotationRunAllSource.node_id] ?? null)
    : null;
  const resultSourceIds = Array.from(
    new Set(
      [serverAiRequest?.node_id, annotationRunAllSource?.node_id].filter(
        (nodeId): nodeId is string => Boolean(nodeId),
      ),
    ),
  );
  const resultSourceNodes = nodes.filter((node) => resultSourceIds.includes(node.id));
  const { columnInfoCache: resultColumnInfoCache } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: resultSourceNodes,
  });
  const reviewSourceNode = annotationRunAllSource
    ? (nodes.find((node) => node.id === annotationRunAllSource.node_id) ?? null)
    : null;
  const reviewSourceColumns = annotationRunAllSource
    ? (resultColumnInfoCache[annotationRunAllSource.node_id]?.map((column) => column.name) ?? [])
    : [];
  const requiresClear = hasClearRequiredAnalysis(analyses);
  const analysisActionLifecycle = getAnalysisActionLifecycle({
    isPreviewing: isAiRunning,
    isSubmittingRunAll,
    runAllState: annotationRunAll?.state ?? null,
    hasActiveAnalysis: Boolean(activeAnalysis),
    requiresClear,
  });
  const aiActionState = getRerunActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    isRunnable: Boolean(currentAiRequest),
    hasAttachedAnalysis: Boolean(tabTaskId),
    hasAnyAnalysis: analyses.length > 0,
    analysisState: aiTaskStatus.tasks[0]?.state ?? null,
    hasChanges: !serverAiRequest || hasParameterDiff(currentAiRequest, serverAiRequest),
    requiresClear,
    isBusy: analysisActionLifecycle.parametersLocked,
  });
  const currentRunAllSignature = currentAiRequest
    ? {
        source: currentAiRequest,
        batch_size: aiBatchSize,
        processing_mode: aiProcessingMode,
      }
    : null;
  const serverRunAllSignature =
    annotationRunAll?.request.kind === 'annotation_run_all'
      ? {
          source: annotationRunAll.request.source,
          batch_size: annotationRunAll.request.batch_size,
          processing_mode: annotationRunAll.request.processing_mode,
        }
      : null;
  const runAllActionState = getRerunActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    isRunnable: Boolean(currentRunAllSignature),
    hasAttachedAnalysis: Boolean(annotationRunAll),
    hasAnyAnalysis: analyses.length > 0,
    analysisState: annotationRunAll?.state ?? null,
    hasChanges:
      !serverRunAllSignature || hasParameterDiff(currentRunAllSignature, serverRunAllSignature),
    requiresClear,
    isBusy: analysisActionLifecycle.parametersLocked,
  });
  const selectedProviderNeedsKey = Boolean(
    selectedAiProvider && !canListModels(selectedAiProvider),
  );
  const providerDisabledReason = selectedProviderNeedsKey
    ? 'Add an API key in Settings → AI before running Annotation'
    : aiActionState.runDisabledReason;
  const controlsLocked =
    analysisActionLifecycle.parametersLocked || isCreatingColumn || isStartingManualReview;

  const runFreshAiAnalysis = async () => {
    if (!currentAiRequest || !currentWorkspaceId) return;
    await runAnalysis<Analysis>({
      action: 'preview',
      prepare: ensureNodeColors,
      submit: async () => {
        const { data } = await submitTabAnalysisWithProviderCredential({
          workspaceId: currentWorkspaceId,
          tabId: host.tabId,
          request: currentAiRequest,
          executionScope: 'preview',
        });
        return data;
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'Could not run Annotation Analysis.');
      },
    });
  };

  const handleRunAll = async () => {
    if (
      !currentWorkspaceId ||
      !sourceNode ||
      !selectedAiProvider ||
      !currentAiRequest ||
      Boolean(activeAnalysis) ||
      analysisActionLifecycle.isRunningAll
    ) {
      return;
    }
    await runAnalysis<Analysis>({
      action: 'run_all',
      prepare: ensureNodeColors,
      submit: async () => {
        const { data } = await submitAnnotationRunAllWithProviderCredential({
          workspaceId: currentWorkspaceId,
          tabId: host.tabId,
          providerConfigurationId: selectedAiProvider.id,
          source: currentAiRequest,
          batchSize: aiBatchSize,
          processingMode: aiProcessingMode,
        });
        return data;
      },
      onSuccess: () => {
        toast.success('Annotation Run All started.');
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'Could not start Annotation Run All.');
      },
    });
  };

  const handleManualReviewToggle = async () => {
    if (manualReviewSnapshot) {
      setManualReviewSnapshot(null);
      return;
    }
    if (!sourceNode || !selectedAnnotationColumnExists) return;
    setIsStartingManualReview(true);
    try {
      await ensureNodeColors();
      setManualReviewSnapshot({
        nodeId: sourceNode.id,
        sourceColumns: [...sourceColumns],
        sourceColor: sourceColor ?? GREY,
        rowCount: sourceNode.node.shape?.[0] ?? 0,
        textColumn: sourceNode.column,
        annotationColumn: resolvedAnnotationColumn,
        classNodeId: classDescriptionNode?.id ?? null,
        classColumn: classDescriptionClassColumn,
        descriptionColumn: classDescriptionDescriptionColumn,
        correctionColumn: aiCorrectionColumn,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the Data Block color.');
    } finally {
      setIsStartingManualReview(false);
    }
  };

  // Prediction pages are always recomputed from the durable Preview snapshot.
  const aiPreview = useAnnotationAiPreview({
    workspaceId: currentWorkspaceId ?? null,
    analysisId: aiResult ? tabTaskId : null,
    providerConfigurationId: serverAiRequest?.provider_configuration_id ?? null,
    nodeId: serverAiRequest?.node_id ?? '',
    textColumn: serverAiRequest?.text_column ?? '',
    annotationColumn: serverAiRequest?.annotation_column ?? '',
    enabled: Boolean(aiResult),
  });
  const annotationRunAllResult = useQuery<AnnotationRunAllResult | null>({
    queryKey:
      currentWorkspaceId && annotationRunAll
        ? queryKeys.analysisResult(currentWorkspaceId, annotationRunAll.id)
        : ['inactive', 'annotation-run-all-result'],
    enabled: Boolean(currentWorkspaceId && annotationRunAll?.state === 'succeeded'),
    queryFn: async () => {
      if (!currentWorkspaceId || !annotationRunAll) return null;
      const result = await getAnalysisOutputResource(currentWorkspaceId, annotationRunAll.id);
      if (result.kind !== 'annotation_run_all') {
        throw new Error('Annotation Run All returned the wrong Result kind');
      }
      return result;
    },
  });

  const sourceReady = Boolean(sourceNode && selectedAnnotationColumnExists);
  const codebookReady = Boolean(
    classDescriptionNode && classDescriptionClassColumn && classDescriptionDescriptionColumn,
  );
  const aiRunAllReady = Boolean(
    annotationRunAll?.state === 'succeeded' && annotationRunAllSource && reviewSourceNode,
  );
  useProgressiveContextualHints([
    CONTEXTUAL_HINT_IDS.annotation.source,
    ...(sourceReady ? [CONTEXTUAL_HINT_IDS.annotation.codebook] : []),
    ...(sourceReady && codebookReady ? [CONTEXTUAL_HINT_IDS.annotation.mode] : []),
    ...(annotationMode === 'manual' && sourceReady && codebookReady
      ? [CONTEXTUAL_HINT_IDS.annotation.manualStart]
      : []),
    ...(annotationMode === 'manual' && manualReviewSnapshot
      ? [CONTEXTUAL_HINT_IDS.annotation.manualResults]
      : []),
    ...(annotationMode === 'ai' && sourceReady && codebookReady
      ? [CONTEXTUAL_HINT_IDS.annotation.aiSetup]
      : []),
    ...(annotationMode === 'ai' && aiResult && serverAiRequest && !aiRunAllReady
      ? [CONTEXTUAL_HINT_IDS.annotation.aiPreviewResults]
      : []),
    ...(annotationMode === 'ai' && aiRunAllReady
      ? [CONTEXTUAL_HINT_IDS.annotation.aiRunAllResults]
      : []),
  ]);

  return (
    <section aria-label="Annotation Setup" className="space-y-5">
      <div className="relative">
        <section aria-label="Annotation Parameter Panel">
          <AnalysisCardLayout
            title="Annotation"
            info={{
              targetKey: 'annotation.overview',
              label: 'About Annotation',
              tooltip: 'Learn what manual and AI annotation are for.',
            }}
            help={{
              targetKey: 'analysis.annotation.parameters',
              label: 'Annotation setup',
              tooltip: 'Set up the source, Codebook, mode, and review workflow.',
            }}
            parametersLocked={analysisActionLifecycle.parametersLocked}
            actions={
              annotationMode === 'ai'
                ? {
                    onPreview: runFreshAiAnalysis,
                    onRunAll: handleRunAll,
                    onStop: activeAnalysis ? stopAiTask : undefined,
                    onClear: async () => {
                      await clearAiResults();
                      await host.clearCorrectionColumns();
                    },
                    previewDisabled:
                      analysisActionLifecycle.previewDisabled ||
                      aiActionState.runDisabled ||
                      isCreatingColumn ||
                      analysisActionLifecycle.isPreviewing,
                    previewDisabledReason: isCreatingColumn
                      ? 'Wait for the column to finish creating'
                      : providerDisabledReason,
                    runAllDisabled:
                      !currentAiRequest ||
                      analysisActionLifecycle.runAllDisabled ||
                      runAllActionState.runDisabled,
                    runAllDisabledReason: selectedProviderNeedsKey
                      ? 'Add an API key in Settings → AI before running Annotation'
                      : runAllActionState.runDisabledReason,
                    clearDisabled: aiActionState.clearDisabled,
                    clearDisabledReason: aiActionState.clearDisabledReason,
                    isPreviewing: analysisActionLifecycle.isPreviewing,
                    isRunningAll: analysisActionLifecycle.isRunningAll,
                    isStopping: isAiStopping,
                  }
                : undefined
            }
            footer={
              annotationMode === 'manual' ? (
                <DisabledReasonTooltip
                  reason={
                    !manualReviewSnapshot && (!sourceNode || !selectedAnnotationColumnExists)
                      ? 'Select an Annotation Data Block and annotation column first'
                      : undefined
                  }
                >
                  <Button
                    type="button"
                    disabled={
                      !manualReviewSnapshot &&
                      (!sourceNode || !selectedAnnotationColumnExists || isStartingManualReview)
                    }
                    onClick={() => {
                      void handleManualReviewToggle();
                    }}
                  >
                    {manualReviewSnapshot ? 'Close' : 'Start'}
                  </Button>
                </DisabledReasonTooltip>
              ) : undefined
            }
            footerGuidanceTarget={
              annotationMode === 'manual' ? 'annotation-manual-start' : undefined
            }
          >
            <div className="@container/annotation-selectors">
              <div
                data-testid="annotation-node-selector-grid"
                className="grid gap-5 @min-[640px]/annotation-selectors:grid-cols-2"
              >
                <section
                  aria-label="Main Data Block Setup"
                  className="rounded-lg border bg-editor/60 p-4"
                >
                  <h3 data-guidance="annotation-source" className="mb-3 text-body font-semibold">
                    Annotation Data Block
                  </h3>
                  <NodeInputsPanel
                    title="Selected Data Blocks"
                    resolvedNodes={sourceNodeInputs.resolvedNodes}
                    availableNodes={sourceNodeInputs.availableNodes}
                    canAddMore={sourceNodeInputs.canAddMore}
                    maxNodes={1}
                    onAddNodes={sourceNodeInputs.addNodes}
                    onRemoveNode={sourceNodeInputs.removeNode}
                    onClear={sourceNodeInputs.clear}
                    onColumnChange={handleSourceTextColumnChange}
                    columnLabel="Text Column"
                    defaultPalette={defaultPalette}
                    nodeColors={nodeColors}
                    onNodeColorChange={setNodeColor}
                    renderColumnAddon={renderAnnotationColumnPicker}
                    disabled={controlsLocked}
                  />
                </section>

                <section aria-label="Codebook Setup" className="rounded-lg border bg-editor/60 p-4">
                  <div
                    data-guidance="annotation-codebook"
                    className="mb-3 flex items-center justify-between gap-2"
                  >
                    <h3 className="text-body font-semibold">Codebook</h3>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!sourceNode || controlsLocked || isCreatingClassTable}
                      onClick={() => {
                        void handleCreateClassTable();
                      }}
                    >
                      {isCreatingClassTable ? 'Creating...' : 'Create New'}
                    </Button>
                  </div>
                  <div>
                    <NodeInputsPanel
                      title="Codebook Data Block"
                      resolvedNodes={classNodeInputs.resolvedNodes}
                      availableNodes={classNodeInputs.availableNodes}
                      canAddMore={classNodeInputs.canAddMore}
                      maxNodes={1}
                      onAddNodes={classNodeInputs.addNodes}
                      onRemoveNode={classNodeInputs.removeNode}
                      onClear={classNodeInputs.clear}
                      onColumnChange={classNodeInputs.setColumn}
                      columnLabel="Code Column"
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
              </div>
            </div>

            <section
              data-guidance="annotation-mode"
              aria-label="Annotation Mode"
              className="mt-5 rounded-lg border bg-editor/60 p-4"
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'text-body font-medium',
                    annotationMode === 'manual' ? 'text-foreground' : 'text-description',
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
                  }}
                />
                <span
                  className={cn(
                    'text-body font-medium',
                    annotationMode === 'ai' ? 'text-foreground' : 'text-description',
                  )}
                >
                  AI
                </span>
              </div>
              {annotationMode === 'ai' ? (
                <div className="mt-4">
                  <AnnotationAiSettings
                    configurations={providerCredentials.annotationProviders}
                    selectedConfigurationId={aiProviderConfigurationId}
                    onProviderChange={(configuration, model) => {
                      selectAiProvider(configuration.id, configuration.provider, model);
                    }}
                    onModelChange={setAiModel}
                    onModelCommit={(configurationId, model) => {
                      persistAiProviderModels({
                        ...aiProviderModels,
                        [configurationId]: model,
                      });
                    }}
                    providerModels={aiProviderModels}
                    model={aiModel}
                    disabled={controlsLocked}
                    onAdvancedOpenChange={(open) => {
                      if (open) {
                        reachContextualHint(CONTEXTUAL_HINT_IDS.annotation.aiAdvanced);
                      }
                    }}
                    advanced={
                      <>
                        <div className="space-y-2">
                          <Label
                            htmlFor="annotation-ai-prompt"
                            className="block text-label-secondary font-medium text-description"
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
                          provider={selectedAiProvider?.provider ?? null}
                          temperature={aiTemperature}
                          onTemperatureCommit={commitAiTemperature}
                          maxRetriesPerBatch={aiMaxRetriesPerBatch}
                          onMaxRetriesPerBatchCommit={commitAiMaxRetriesPerBatch}
                          batchSize={aiBatchSize}
                          onBatchSizeCommit={commitAiBatchSize}
                          processingMode={aiProcessingMode}
                          onProcessingModeChange={setAiProcessingMode}
                          reasoningEnabled={aiReasoningEnabled}
                          onReasoningEnabledChange={setAiReasoningEnabled}
                          reasoningEffort={aiReasoningEffort}
                          onReasoningEffortChange={setAiReasoningEffort}
                          disabled={controlsLocked}
                        />
                      </>
                    }
                  >
                    <div className="space-y-2">
                      <Label className="block text-label-secondary font-medium text-description">
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
                        onRemoveNode={exampleNodeInputs.removeNode}
                        onClear={exampleNodeInputs.clear}
                        onColumnChange={handleExampleTextColumnChange}
                        columnLabel="Text Column"
                        renderColumnAddon={renderExampleAnnotationColumnPicker}
                        disabled={controlsLocked}
                      />
                      <AnnotationExampleSamplingControls
                        maxExamplesPerClass={aiMaxExamplesPerClass}
                        onMaxExamplesPerClassCommit={commitAiMaxExamplesPerClass}
                        samplingMethod={aiExampleSamplingMethod}
                        onSamplingMethodChange={setAiExampleSamplingMethod}
                        randomSeed={aiExampleRandomSeed}
                        onRandomSeedCommit={commitAiExampleRandomSeed}
                        disabled={controlsLocked || !hasCompleteExample}
                      />
                    </div>
                  </AnnotationAiSettings>
                </div>
              ) : null}
            </section>
          </AnalysisCardLayout>
        </section>
      </div>
      <CreateStringColumnDialog
        open={Boolean(createColumnDialog)}
        title={
          createColumnDialog?.kind === 'correction'
            ? 'Create correction column'
            : 'Create annotation column'
        }
        description={
          createColumnDialog?.kind === 'correction'
            ? 'Add an empty string column to this Data Block and select it for user corrections.'
            : 'Add an empty string column to this Data Block and select it for annotation.'
        }
        inputId={
          createColumnDialog?.kind === 'correction'
            ? 'annotation-correction-column-name'
            : 'annotation-column-name'
        }
        inputLabel={
          createColumnDialog?.kind === 'correction' ? 'Correction column name' : 'Column name'
        }
        value={newColumnName}
        placeholder={defaultColumnName}
        error={createColumnError}
        pending={isCreatingColumn}
        onValueChange={(value) => {
          setNewColumnName(value);
          setCreateColumnError(null);
        }}
        onClose={() => {
          setCreateColumnDialog(null);
          setNewColumnName('');
          setCreateColumnError(null);
        }}
        onSubmit={() => {
          void handleCreateColumn();
        }}
      />
      {annotationMode === 'ai' && aiBanner ? (
        <AnalysisTaskBanner
          analysisName="Annotation"
          status={aiBanner.status}
          taskId={aiBanner.taskId}
          message={aiBanner.message}
        />
      ) : null}
      {annotationMode === 'ai' &&
      annotationRunAll &&
      (annotationRunAll.state === 'queued' || annotationRunAll.state === 'running') ? (
        <AnalysisTaskBanner
          analysisName="Annotation Run All"
          status={annotationRunAll.state}
          taskId={annotationRunAll.id}
          message={annotationRunAll.progress.message ?? undefined}
        />
      ) : null}
      {annotationMode === 'ai' && annotationRunAll?.state === 'failed' ? (
        <div
          role="alert"
          className="mt-4 rounded-md border border-error/40 bg-error/5 px-4 py-3 text-body text-error"
        >
          {annotationRunAll.error?.message ?? 'Annotation Run All failed.'}
        </div>
      ) : null}
      {annotationMode === 'manual' && manualReviewSnapshot ? (
        <AnnotationResultsPanel
          key={`${manualReviewSnapshot.nodeId}:${manualReviewSnapshot.annotationColumn}`}
          workspaceId={currentWorkspaceId ?? null}
          nodeId={manualReviewSnapshot.nodeId}
          sourceColumns={manualReviewSnapshot.sourceColumns}
          sourceColor={manualReviewSnapshot.sourceColor}
          rowCount={manualReviewSnapshot.rowCount}
          textColumn={manualReviewSnapshot.textColumn}
          annotationColumn={manualReviewSnapshot.annotationColumn}
          classNodeId={manualReviewSnapshot.classNodeId}
          classColumn={manualReviewSnapshot.classColumn}
          descriptionColumn={manualReviewSnapshot.descriptionColumn}
          comparisonColumns={annotationComparisonColumns[manualReviewSnapshot.nodeId] ?? []}
          onComparisonColumnsChange={(columns) => {
            setAnnotationComparisonColumns(manualReviewSnapshot.nodeId, columns);
          }}
          reliabilityMetric={
            annotationReliabilityMetrics[manualReviewSnapshot.nodeId] ??
            DEFAULT_INTERCODER_RELIABILITY_METRIC
          }
          onReliabilityMetricChange={(metric) => {
            setAnnotationReliabilityMetric(manualReviewSnapshot.nodeId, metric);
          }}
          metadataColumns={annotationMetadataColumns[manualReviewSnapshot.nodeId] ?? []}
          onMetadataColumnsChange={(columns) => {
            setAnnotationMetadataColumns(manualReviewSnapshot.nodeId, columns);
          }}
          tableHeight={annotationTableHeight}
          onTableHeightChange={setAnnotationTableHeight}
          correction={{
            column: manualReviewSnapshot.correctionColumn,
            onColumnChange: (column) => {
              setLiveCorrectionColumn(manualReviewSnapshot.nodeId, column);
              setManualReviewSnapshot((current) =>
                current?.nodeId === manualReviewSnapshot.nodeId
                  ? { ...current, correctionColumn: column }
                  : current,
              );
            },
            onCreate: () => {
              openCorrectionColumnDialog(
                manualReviewSnapshot.nodeId,
                manualReviewSnapshot.annotationColumn,
                manualReviewSnapshot.sourceColumns,
              );
            },
            disabled: isCreatingColumn,
          }}
        />
      ) : null}
      {annotationMode === 'ai' &&
      annotationRunAll?.state === 'succeeded' &&
      annotationRunAllSource &&
      currentWorkspaceId &&
      reviewSourceNode ? (
        <>
          {(annotationRunAllResult.data?.failed_row_count ?? 0) > 0 ? (
            <div
              role="status"
              className="mt-5 rounded-md border border-warning bg-warning-background px-4 py-3 text-body"
            >
              Annotation completed with {annotationRunAllResult.data?.failed_row_count} failed row
              {annotationRunAllResult.data?.failed_row_count === 1 ? '' : 's'} across{' '}
              {annotationRunAllResult.data?.failed_batch_count} failed batch
              {annotationRunAllResult.data?.failed_batch_count === 1 ? '' : 'es'}. Failed rows kept
              their existing values when reprocessing and remain blank when filling missing values.
            </div>
          ) : null}
          <RunAllReviewTable
            workspaceId={currentWorkspaceId}
            nodeId={annotationRunAllSource.node_id}
            sql={`SELECT * FROM ${sqlTable(annotationRunAllSource.node_id)}`}
            sourceColumns={reviewSourceColumns}
            sourceColor={reviewSourceNode.color ?? GREY}
            rowCount={reviewSourceNode.shape?.[0] ?? 0}
            title="Annotation"
            guidanceTarget="annotation-ai-run-all-results"
            requiredColumns={[
              annotationRunAllSource.text_column,
              annotationRunAllSource.annotation_column,
            ]}
            comparisonColumn={annotationRunAllSource.annotation_column}
            comparisonColumns={annotationComparisonColumns[annotationRunAllSource.node_id] ?? []}
            onComparisonColumnsChange={(columns) => {
              setAnnotationComparisonColumns(annotationRunAllSource.node_id, columns);
            }}
            reliabilityMetric={
              annotationReliabilityMetrics[annotationRunAllSource.node_id] ??
              DEFAULT_INTERCODER_RELIABILITY_METRIC
            }
            onReliabilityMetricChange={(metric) => {
              setAnnotationReliabilityMetric(annotationRunAllSource.node_id, metric);
            }}
            metadataColumns={annotationMetadataColumns[annotationRunAllSource.node_id] ?? []}
            onMetadataColumnsChange={(columns) => {
              setAnnotationMetadataColumns(annotationRunAllSource.node_id, columns);
            }}
            tableHeight={annotationTableHeight}
            onTableHeightChange={setAnnotationTableHeight}
            correction={{
              column: reviewCorrectionColumn,
              classOptions: annotationRunAllSource.classes.map((item) => item.name),
              onColumnChange: (column) => {
                setLiveCorrectionColumn(annotationRunAllSource.node_id, column);
              },
              onCreate: () => {
                openCorrectionColumnDialog(
                  annotationRunAllSource.node_id,
                  annotationRunAllSource.annotation_column,
                  reviewSourceColumns,
                );
              },
              onUseAsExample: () => {
                handleUseCorrectionColumnAsExample(
                  annotationRunAllSource.node_id,
                  annotationRunAllSource.text_column,
                  reviewCorrectionColumn,
                );
              },
              disabled: isCreatingColumn,
            }}
          />
        </>
      ) : annotationMode === 'ai' && aiResult && serverAiRequest ? (
        <AnnotationAiPreviewPanel
          preview={aiPreview}
          sourceColor={nodeColors[serverAiRequest.node_id] ?? sourceColor ?? GREY}
          comparison={{
            columns: annotationComparisonColumns[serverAiRequest.node_id] ?? [],
            onColumnsChange: (columns) => {
              setAnnotationComparisonColumns(serverAiRequest.node_id, columns);
            },
            metric:
              annotationReliabilityMetrics[serverAiRequest.node_id] ??
              DEFAULT_INTERCODER_RELIABILITY_METRIC,
            onMetricChange: (metric) => {
              setAnnotationReliabilityMetric(serverAiRequest.node_id, metric);
            },
          }}
          metadata={{
            columns: annotationMetadataColumns[serverAiRequest.node_id] ?? [],
            onColumnsChange: (columns) => {
              setAnnotationMetadataColumns(serverAiRequest.node_id, columns);
            },
          }}
          tableHeight={annotationTableHeight}
          onTableHeightChange={setAnnotationTableHeight}
          correction={{
            nodeId: serverAiRequest.node_id,
            column: previewCorrectionColumn,
            classOptions: serverAiRequest.classes.map((item) => item.name),
            onColumnChange: (column) => {
              setLiveCorrectionColumn(serverAiRequest.node_id, column);
            },
            onCreate: () => {
              openCorrectionColumnDialog(
                serverAiRequest.node_id,
                serverAiRequest.annotation_column,
                aiPreview.sourceColumns,
              );
            },
            onUseAsExample: () => {
              handleUseCorrectionColumnAsExample(
                serverAiRequest.node_id,
                serverAiRequest.text_column,
                previewCorrectionColumn,
              );
            },
            disabled: isCreatingColumn,
          }}
        />
      ) : null}
    </section>
  );
}

export default AnnotationFeature;
