import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Analysis, AnnotationAnalysisRequest, AnnotationResult } from '@/api';
import { sqlIdentifier, sqlTable } from '@/api';
import { Button } from '@/components/ui/button';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { cn } from '@/lib/utils';
import { queryKeys } from '@/lib/queryKeys';
import { getAnalysisOutputResource } from '../common/analysisApi';
import { ANALYSIS_TASK_TYPES } from '../common/analysisIds';
import AnalysisTaskBanner from '../common/components/AnalysisTaskBanner';
import { useAnalysisFeature } from '../common/hooks/useAnalysisFeature';
import { usePersistNodeDocumentColumn } from '../common/hooks/usePersistNodeDocumentColumn';
import { useNodeColorControls } from '../common/hooks/useNodeColorControls';
import { GREY } from '../common/vizPalette';
import { hasParameterDiff } from '../common/parameterComparison';
import { acceptPlaceholderOnTab } from '../common/placeholderTabFill';
import { getRerunActionState } from '../common/rerunActionState';
import { getAnalysisActionLifecycle } from '../common/analysisActionLifecycle';
import { runAnalysisTaskEnvelope } from '../common/tasks/runAnalysisTaskEnvelope';
import { canAnnotate, resolveAnnotationProviderConfiguration } from './aiProviders';
import { AnnotationAiPreviewPanel } from './components/AnnotationAiPreviewPanel';
import { AnnotationAiSettings } from './components/AnnotationAiSettings';
import { AnnotationClassDescriptionsEditor } from './components/AnnotationClassDescriptionsEditor';
import { AnnotationInferenceSettings } from './components/AnnotationInferenceSettings';
import {
  AnnotationPromptInput,
  DEFAULT_ANNOTATION_PROMPT,
} from './components/AnnotationPromptInput';
import { AnnotationResultsPanel } from './components/AnnotationResultsPanel';
import { useAnnotationAiPreview } from './hooks/useAnnotationAiPreview';
import { useAnnotationClassDescriptions } from './hooks/useAnnotationClassDescriptions';
import { useAnnotationTabSettings } from './hooks/useAnnotationTabSettings';

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
const CREATE_ANNOTATION_COLUMN_ACTION = '__create_annotation_column__';
const CREATE_CORRECTION_COLUMN_ACTION = '__create_correction_column__';
const NO_CORRECTION_COLUMN_ACTION = '__no_correction_column__';
const DEFAULT_ANNOTATION_COLUMN_NAME = 'annotation';
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
  const [annotationColumnDialog, setAnnotationColumnDialog] = useState<{
    nodeId: string;
    columns: string[];
  } | null>(null);
  const [newAnnotationColumnName, setNewAnnotationColumnName] = useState('');
  const [annotationColumnError, setAnnotationColumnError] = useState<string | null>(null);
  const [isCorrectionColumnDialogOpen, setIsCorrectionColumnDialogOpen] = useState(false);
  const [newCorrectionColumnName, setNewCorrectionColumnName] = useState('');
  const [correctionColumnError, setCorrectionColumnError] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const [isCreatingAnnotationColumn, setIsCreatingAnnotationColumn] = useState(false);
  const [isCreatingCorrectionColumn, setIsCreatingCorrectionColumn] = useState(false);
  const [isSubmittingRunAll, setIsSubmittingRunAll] = useState(false);
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
    annotationDifferenceFilterColumns,
    setAnnotationDifferenceFilterColumns,
    annotationComparisonColumns,
    setAnnotationComparisonColumns,
    annotationReliabilityMetrics,
    setAnnotationReliabilityMetric,
    annotationMetadataColumns,
    setAnnotationMetadataColumns,
    annotationHiddenCorrectionColumns,
    setAnnotationCorrectionVisible,
  } = useAnnotationTabSettings({ tabSettings, onTabSettingChange });
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
  const { currentWorkspaceId } = useWorkspaceData();
  const queryClient = useQueryClient();
  const {
    polarsExpressionApply,
    createSqlDataBlock,
    setNodeColor: persistNodeColor,
  } = useWorkspaceActions();
  const persistDocumentColumn = usePersistNodeDocumentColumn({
    workspaceId: currentWorkspaceId,
  });

  // Manual results lock their source selectors while the editable table is open.
  // Column creation also locks them until the in-place schema edit settles.
  const isLocked = hasRun || isCreatingAnnotationColumn || isCreatingCorrectionColumn;

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
            setNewAnnotationColumnName('');
            setAnnotationColumnError(null);
            setAnnotationColumnDialog({ nodeId, columns });
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
  const correctionColumnOptions = sourceColumns.filter(
    (column) => column !== sourceNode?.column && column !== resolvedAnnotationColumn,
  );
  const defaultCorrectionColumnName = `${resolvedAnnotationColumn || DEFAULT_ANNOTATION_COLUMN_NAME}.correction`;

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

  // Creating a new annotation column is an immediate, identity-preserving Data
  // Block edit. Manual cell changes then use the same Undo/Redo history.
  const handleCreateAnnotationColumn = async () => {
    if (!annotationColumnDialog || !currentWorkspaceId) return;
    const columnName = newAnnotationColumnName.trim() || DEFAULT_ANNOTATION_COLUMN_NAME;
    const currentColumns =
      sourceNodeInputs.resolvedNodes
        .find((node) => node.id === annotationColumnDialog.nodeId)
        ?.columnOptions.map((option) => option.name) ?? annotationColumnDialog.columns;
    if (currentColumns.includes(columnName)) {
      setAnnotationColumnError(`A column named "${columnName}" already exists.`);
      return;
    }
    setAnnotationColumnError(null);
    setIsCreatingAnnotationColumn(true);
    try {
      await polarsExpressionApply(
        annotationColumnDialog.nodeId,
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
      setAnnotationTarget(annotationColumnDialog.nodeId, columnName);
      setAnnotationColumnDialog(null);
      setNewAnnotationColumnName('');
    } catch (error) {
      console.warn('[annotation] Failed to create annotation column:', error);
      toast.error(
        error instanceof Error ? error.message : 'Could not create the annotation column.',
      );
    } finally {
      setIsCreatingAnnotationColumn(false);
    }
  };

  const handleCreateCorrectionColumn = async () => {
    if (!sourceNode || !currentWorkspaceId) return;
    const columnName = newCorrectionColumnName.trim() || defaultCorrectionColumnName;
    if (sourceColumns.includes(columnName)) {
      setCorrectionColumnError(`A column named "${columnName}" already exists.`);
      return;
    }
    setCorrectionColumnError(null);
    setIsCreatingCorrectionColumn(true);
    try {
      await polarsExpressionApply(
        sourceNode.id,
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
      await host.setCorrectionColumn(sourceNode.id, columnName);
      setIsCorrectionColumnDialogOpen(false);
      setNewCorrectionColumnName('');
    } catch (error) {
      console.warn('[annotation] Failed to create correction column:', error);
      toast.error(
        error instanceof Error ? error.message : 'Could not create the correction column.',
      );
    } finally {
      setIsCreatingCorrectionColumn(false);
    }
  };

  const useCorrectionColumnAsExample = () => {
    if (!sourceNode || !aiCorrectionColumn) return;
    onTabInputSetChange(
      EXAMPLE_NODE_SELECTOR_ID,
      nodeInputsFromSelections([{ nodeId: sourceNode.id, column: sourceNode.column }]),
    );
    setExampleAnnotationColumns((current) => ({
      ...current,
      [sourceNode.id]: aiCorrectionColumn,
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
  const exampleNode = exampleNodeInputs.resolvedNodes[0] ?? null;
  const exampleAnnotationColumn = exampleNode
    ? (exampleAnnotationColumns[exampleNode.id] ?? '')
    : '';
  const hasCompleteExample = Boolean(exampleNode && exampleAnnotationColumn);
  // Preview creation captures every selector and setting in one immutable root
  // Analysis. Run All later executes only from that snapshot.
  const currentAiRequest: AnnotationAnalysisRequest | null =
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
          reasoning_enabled: aiReasoningEnabled,
          reasoning_effort: normalizedReasoningEffort,
        }
      : null;

  const {
    request: serverAiRequest,
    result: aiResult,
    isRunning: isAiRunning,
    isStopping: isAiStopping,
    setIsRunning: setIsAiRunning,
    setLocalTaskId: setLocalAiTaskId,
    runningRef: aiRunningRef,
    taskStatus: aiTaskStatus,
    banner: aiBanner,
    clearResults: clearAiResults,
    stopTask: stopAiTask,
  } = useAnalysisFeature<AnnotationResult, AnnotationAnalysisRequest>({
    taskType: ANALYSIS_TASK_TYPES.annotation,
    workspaceId: currentWorkspaceId,
    tabId: host.tabId,
    hydrationTaskId: tabTaskId,
    requestHydration:
      !latestPreview && annotationRunAll && annotationRunAllSource
        ? {
            analysisId: annotationRunAll.id,
            request: annotationRunAllSource,
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
      void host.setCorrectionColumn(request.node_id, request.correction_column ?? null);
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
      if (!latestPreview && annotationRunAll?.request.kind === 'annotation_run_all') {
        commitAiBatchSize(annotationRunAll.request.batch_size ?? 20);
        setAiProcessingMode(annotationRunAll.request.processing_mode ?? 'reprocess_all');
      }
      setAiReasoningEnabled(request.reasoning_enabled ?? false);
      setAiReasoningEffort(request.reasoning_effort ?? 'medium');
    },
    onCleared: refreshAnalyses,
  });
  const previewCorrectionColumn = serverAiRequest?.correction_column ?? null;
  const reviewCorrectionColumn = annotationRunAllSource?.correction_column ?? null;
  const aiActionState = getRerunActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    isRunnable: Boolean(currentAiRequest),
    hasAttachedAnalysis: Boolean(tabTaskId),
    analysisState: aiTaskStatus.tasks[0]?.state ?? null,
    hasChanges: !serverAiRequest || hasParameterDiff(currentAiRequest, serverAiRequest),
    isBusy: isAiRunning,
  });
  const analysisActionLifecycle = getAnalysisActionLifecycle({
    isPreviewing: isAiRunning,
    isSubmittingRunAll,
    runAllState: annotationRunAll?.state ?? null,
    hasActiveAnalysis: Boolean(activeAnalysis),
  });
  const controlsLocked = isLocked || isAiRunning || isStartingManualReview;

  const runFreshAiAnalysis = async () => {
    if (!currentAiRequest || !currentWorkspaceId || aiRunningRef.current) return;
    try {
      await ensureNodeColors();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the Data Block color.');
      return;
    }
    await runAnalysisTaskEnvelope<Analysis>({
      runningRef: aiRunningRef,
      setIsRunning: setIsAiRunning,
      setLocalTaskId: setLocalAiTaskId,
      onSubmitted: refreshAnalyses,
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
    setIsSubmittingRunAll(true);
    try {
      await ensureNodeColors();
      await submitAnnotationRunAllWithProviderCredential({
        workspaceId: currentWorkspaceId,
        tabId: host.tabId,
        providerConfigurationId: selectedAiProvider.id,
        source: currentAiRequest,
        batchSize: aiBatchSize,
        processingMode: aiProcessingMode,
      });
      refreshAnalyses();
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workspaceAnalyses(currentWorkspaceId),
      });
      toast.success('Annotation Run All started.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start Annotation Run All.');
    } finally {
      setIsSubmittingRunAll(false);
    }
  };

  const handleManualReviewToggle = async () => {
    if (hasRun) {
      setHasRun(false);
      return;
    }
    setIsStartingManualReview(true);
    try {
      await ensureNodeColors();
      setHasRun(true);
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

  return (
    <section aria-label="Annotation Setup" className="space-y-5">
      <div className="relative">
        <section aria-label="Annotation Parameter Panel">
          <AnalysisCardLayout
            title="Annotation"
            parametersLocked={annotationMode === 'ai' && analysisActionLifecycle.parametersLocked}
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
                      isCreatingAnnotationColumn ||
                      isCreatingCorrectionColumn ||
                      analysisActionLifecycle.isPreviewing,
                    previewDisabledReason:
                      isCreatingAnnotationColumn || isCreatingCorrectionColumn
                        ? 'Wait for the column to finish creating'
                        : aiActionState.runDisabledReason,
                    runAllDisabled: !currentAiRequest || analysisActionLifecycle.runAllDisabled,
                    runAllDisabledReason: aiActionState.runDisabledReason,
                    clearDisabled:
                      analyses.length === 0 ||
                      analysisActionLifecycle.isPreviewing ||
                      analysisActionLifecycle.isRunningAll ||
                      Boolean(activeAnalysis),
                    clearDisabledReason:
                      analyses.length === 0 ? 'There are no results to clear' : undefined,
                    isPreviewing: analysisActionLifecycle.isPreviewing,
                    isRunningAll: analysisActionLifecycle.isRunningAll,
                    isStopping: isAiStopping,
                    hasResult: Boolean(aiResult),
                    previewLabel: analysisActionLifecycle.parametersLocked
                      ? 'Preview'
                      : tabTaskId
                        ? 'Update Preview'
                        : 'Preview',
                  }
                : undefined
            }
            footer={
              annotationMode === 'manual' ? (
                <DisabledReasonTooltip
                  reason={
                    !sourceNode || !selectedAnnotationColumnExists
                      ? 'Select an Annotation Data Block and annotation column first'
                      : undefined
                  }
                >
                  <Button
                    type="button"
                    disabled={
                      !sourceNode || !selectedAnnotationColumnExists || isStartingManualReview
                    }
                    onClick={() => {
                      void handleManualReviewToggle();
                    }}
                  >
                    {hasRun ? 'Clear' : 'Resume'}
                  </Button>
                </DisabledReasonTooltip>
              ) : undefined
            }
          >
            <div className="@container/annotation-selectors">
              <div
                data-testid="annotation-node-selector-grid"
                className="grid gap-5 @min-[640px]/annotation-selectors:grid-cols-2"
              >
                <section
                  aria-label="Main Data Block Setup"
                  className="rounded-lg border bg-background/60 p-4"
                >
                  <h3 className="mb-3 text-base font-semibold">Annotation Data Block</h3>
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
                    onColumnChange={handleSourceTextColumnChange}
                    columnLabel="Text Column"
                    defaultPalette={defaultPalette}
                    nodeColors={nodeColors}
                    onNodeColorChange={setNodeColor}
                    renderColumnAddon={renderAnnotationColumnPicker}
                    disabled={controlsLocked}
                  />
                </section>

                <section
                  aria-label="Class Description Setup"
                  className="rounded-lg border bg-background/60 p-4"
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
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
                      {isCreatingClassTable ? 'Creating...' : 'Create New'}
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
              </div>
            </div>

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
                    advanced={
                      <>
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
                      <Label
                        htmlFor="annotation-ai-correction-column"
                        className="block text-sm font-medium"
                      >
                        User Correction Column
                      </Label>
                      <Select
                        value={aiCorrectionColumn ?? NO_CORRECTION_COLUMN_ACTION}
                        disabled={controlsLocked || !sourceNode || !selectedAnnotationColumnExists}
                        onValueChange={(next) => {
                          if (!sourceNode) return;
                          if (next === CREATE_CORRECTION_COLUMN_ACTION) {
                            setNewCorrectionColumnName('');
                            setCorrectionColumnError(null);
                            setIsCorrectionColumnDialogOpen(true);
                            return;
                          }
                          void host
                            .setCorrectionColumn(
                              sourceNode.id,
                              next === NO_CORRECTION_COLUMN_ACTION ? null : next,
                            )
                            .catch((error: unknown) => {
                              toast.error(
                                error instanceof Error
                                  ? error.message
                                  : 'Could not save the correction column.',
                              );
                            });
                        }}
                      >
                        <SelectTrigger
                          id="annotation-ai-correction-column"
                          aria-label="User Correction Column"
                          className="w-full"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value={CREATE_CORRECTION_COLUMN_ACTION}>
                              Add new column
                            </SelectItem>
                            <SelectItem value={NO_CORRECTION_COLUMN_ACTION}>
                              No correction column
                            </SelectItem>
                            {correctionColumnOptions.map((column) => (
                              <SelectItem key={column} value={column}>
                                {column}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!sourceNode || !aiCorrectionColumn || controlsLocked}
                        onClick={useCorrectionColumnAsExample}
                      >
                        Use the correction column as the example
                      </Button>
                    </div>
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
                        onColumnChange={handleExampleTextColumnChange}
                        columnLabel="Text Column"
                        renderColumnAddon={renderExampleAnnotationColumnPicker}
                        disabled={controlsLocked}
                      />
                    </div>
                  </AnnotationAiSettings>
                </div>
              ) : null}
            </section>
          </AnalysisCardLayout>
        </section>
      </div>
      <Dialog
        open={Boolean(annotationColumnDialog)}
        onOpenChange={(open) => {
          if (open || isCreatingAnnotationColumn) return;
          setAnnotationColumnDialog(null);
          setNewAnnotationColumnName('');
          setAnnotationColumnError(null);
        }}
      >
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateAnnotationColumn();
            }}
          >
            <DialogHeader>
              <DialogTitle>Create annotation column</DialogTitle>
              <DialogDescription>
                Add an empty string column to this Data Block and select it for annotation.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="annotation-column-name">Column name</Label>
              <Input
                id="annotation-column-name"
                aria-label="Column name"
                value={newAnnotationColumnName}
                placeholder={DEFAULT_ANNOTATION_COLUMN_NAME}
                maxLength={500}
                disabled={isCreatingAnnotationColumn}
                onChange={(event) => {
                  setNewAnnotationColumnName(event.target.value);
                  setAnnotationColumnError(null);
                }}
                onKeyDown={(event) => {
                  acceptPlaceholderOnTab({
                    event,
                    value: newAnnotationColumnName,
                    setValue: setNewAnnotationColumnName,
                  });
                }}
              />
              {annotationColumnError ? (
                <p role="alert" className="text-sm text-destructive">
                  {annotationColumnError}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isCreatingAnnotationColumn}
                onClick={() => {
                  setAnnotationColumnDialog(null);
                  setNewAnnotationColumnName('');
                  setAnnotationColumnError(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isCreatingAnnotationColumn}>
                {isCreatingAnnotationColumn ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={isCorrectionColumnDialogOpen}
        onOpenChange={(open) => {
          if (open || isCreatingCorrectionColumn) return;
          setIsCorrectionColumnDialogOpen(false);
          setNewCorrectionColumnName('');
          setCorrectionColumnError(null);
        }}
      >
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateCorrectionColumn();
            }}
          >
            <DialogHeader>
              <DialogTitle>Create correction column</DialogTitle>
              <DialogDescription>
                Add an empty string column to this Data Block and select it for user corrections.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="annotation-correction-column-name">Column name</Label>
              <Input
                id="annotation-correction-column-name"
                aria-label="Correction column name"
                value={newCorrectionColumnName}
                placeholder={defaultCorrectionColumnName}
                maxLength={500}
                disabled={isCreatingCorrectionColumn}
                onChange={(event) => {
                  setNewCorrectionColumnName(event.target.value);
                  setCorrectionColumnError(null);
                }}
                onKeyDown={(event) => {
                  acceptPlaceholderOnTab({
                    event,
                    value: newCorrectionColumnName,
                    setValue: setNewCorrectionColumnName,
                  });
                }}
              />
              {correctionColumnError ? (
                <p role="alert" className="text-sm text-destructive">
                  {correctionColumnError}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isCreatingCorrectionColumn}
                onClick={() => {
                  setIsCorrectionColumnDialogOpen(false);
                  setNewCorrectionColumnName('');
                  setCorrectionColumnError(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isCreatingCorrectionColumn}>
                {isCreatingCorrectionColumn ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
      {annotationMode === 'manual' && hasRun && sourceNode ? (
        <AnnotationResultsPanel
          key={`${sourceNode.id}:${resolvedAnnotationColumn}`}
          workspaceId={currentWorkspaceId ?? null}
          nodeId={sourceNode.id}
          sourceColumns={sourceColumns}
          sourceColor={sourceColor ?? GREY}
          rowCount={sourceNode.node.shape?.[0] ?? 0}
          textColumn={sourceNode.column}
          annotationColumn={resolvedAnnotationColumn}
          classNodeId={classDescriptionNode?.id ?? null}
          classColumn={classDescriptionClassColumn}
          descriptionColumn={classDescriptionDescriptionColumn}
          comparisonColumns={annotationComparisonColumns[sourceNode.id] ?? []}
          onComparisonColumnsChange={(columns) => {
            setAnnotationComparisonColumns(sourceNode.id, columns);
          }}
          differenceFilterColumns={annotationDifferenceFilterColumns[sourceNode.id] ?? []}
          onDifferenceFilterColumnsChange={(columns) => {
            setAnnotationDifferenceFilterColumns(sourceNode.id, columns);
          }}
          reliabilityMetric={
            annotationReliabilityMetrics[sourceNode.id] ?? DEFAULT_INTERCODER_RELIABILITY_METRIC
          }
          onReliabilityMetricChange={(metric) => {
            setAnnotationReliabilityMetric(sourceNode.id, metric);
          }}
          metadataColumns={annotationMetadataColumns[sourceNode.id] ?? []}
          onMetadataColumnsChange={(columns) => {
            setAnnotationMetadataColumns(sourceNode.id, columns);
          }}
        />
      ) : null}
      {annotationMode === 'ai' &&
      annotationRunAll?.state === 'succeeded' &&
      annotationRunAllSource &&
      currentWorkspaceId &&
      sourceNode ? (
        <RunAllReviewTable
          workspaceId={currentWorkspaceId}
          nodeId={sourceNode.id}
          sql={`SELECT * FROM ${sqlTable(sourceNode.id)}`}
          sourceColumns={sourceColumns}
          sourceColor={sourceColor ?? GREY}
          rowCount={sourceNode.node.shape?.[0] ?? 0}
          title="Annotation"
          requiredColumns={[
            annotationRunAllSource.text_column,
            annotationRunAllSource.annotation_column,
            ...(reviewCorrectionColumn ? [reviewCorrectionColumn] : []),
          ]}
          comparisonColumn={annotationRunAllSource.annotation_column}
          comparisonColumns={annotationComparisonColumns[sourceNode.id] ?? []}
          onComparisonColumnsChange={(columns) => {
            setAnnotationComparisonColumns(sourceNode.id, columns);
          }}
          differenceFilterColumns={annotationDifferenceFilterColumns[sourceNode.id] ?? []}
          onDifferenceFilterColumnsChange={(columns) => {
            setAnnotationDifferenceFilterColumns(sourceNode.id, columns);
          }}
          reliabilityMetric={
            annotationReliabilityMetrics[sourceNode.id] ?? DEFAULT_INTERCODER_RELIABILITY_METRIC
          }
          onReliabilityMetricChange={(metric) => {
            setAnnotationReliabilityMetric(sourceNode.id, metric);
          }}
          metadataColumns={annotationMetadataColumns[sourceNode.id] ?? []}
          onMetadataColumnsChange={(columns) => {
            setAnnotationMetadataColumns(sourceNode.id, columns);
          }}
          correction={
            reviewCorrectionColumn
              ? {
                  column: reviewCorrectionColumn,
                  visible: !(annotationHiddenCorrectionColumns[sourceNode.id] ?? []).includes(
                    reviewCorrectionColumn,
                  ),
                  onVisibleChange: (visible) => {
                    setAnnotationCorrectionVisible(sourceNode.id, reviewCorrectionColumn, visible);
                  },
                }
              : undefined
          }
        />
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
          correction={{
            nodeId: serverAiRequest.node_id,
            column: previewCorrectionColumn,
            classOptions: serverAiRequest.classes.map((item) => item.name),
            visible:
              !previewCorrectionColumn ||
              !(annotationHiddenCorrectionColumns[serverAiRequest.node_id] ?? []).includes(
                previewCorrectionColumn,
              ),
            onVisibleChange: (visible) => {
              if (!previewCorrectionColumn) return;
              setAnnotationCorrectionVisible(
                serverAiRequest.node_id,
                previewCorrectionColumn,
                visible,
              );
            },
          }}
        />
      ) : null}
    </section>
  );
}

export default AnnotationFeature;
