import { useState } from 'react';
import type { AnalysisTabInput } from '@/api';
import {
  createAnnotationClassDescriptions,
  createAnnotationColumn,
  setAnnotationClassParent,
} from '@/api';
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
import type { AnnotationProviderConfigSave } from './components/AnnotationProviderConfigDialog';
import type { AnnotationAiProviderId } from './aiProviders';
import {
  canAnnotate,
  parseConfiguredBuiltinProviderId,
  resolveAnnotationAiProvider,
} from './aiProviders';
import { useAnnotationTabSettings } from './hooks/useAnnotationTabSettings';
import { useTabNodeInputs } from '@/features/views/common/nodeInputs';
import type { NodeInputConstraints } from '@/features/views/common/nodeInputs';
import {
  DEFAULT_TAB_INPUT_SET_ID,
  type AnalysisTabInputSets,
} from '@/features/views/common/tabs/tabStateOps';
import { queryKeys } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useAnnotationClassDescriptions } from './hooks/useAnnotationClassDescriptions';
import { useAnnotationAiPreviewSession } from './hooks/useAnnotationAiPreviewSession';

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
interface AnnotationFeatureProps {
  tabId?: string;
  tabTaskId?: string | null;
  onTabTaskChange?: (taskId: string | null) => void;
  tabInputSets?: AnalysisTabInputSets;
  onTabInputSetChange: (selectorId: string, inputs: AnalysisTabInput[]) => void;
  /** This tab's persisted free-form settings (Manual/AI mode, provider, ...). */
  tabSettings?: Record<string, string>;
  /** Commit one persisted free-form setting for this tab (writes tabs.json). */
  onTabSettingChange?: (key: string, value: string) => void;
}

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
function AnnotationFeature({
  tabInputSets,
  onTabInputSetChange,
  tabSettings,
  onTabSettingChange,
}: AnnotationFeatureProps) {
  const [descriptionColumns, setDescriptionColumns] = useState<Record<string, string>>({});
  const [newColumnNames, setNewColumnNames] = useState<Record<string, string>>({});
  const [isCreatingClassNode, setIsCreatingClassNode] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  // Tab-persisted AI settings live in their own hook so this feature body can
  // focus on selector, run, and results orchestration. API keys stay in
  // preferences, never in tab settings.
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
    isPreviewing,
    setIsPreviewing,
    annotationTargets,
    setAnnotationTarget,
  } = useAnnotationTabSettings({ tabSettings, onTabSettingChange });
  const annotationAiApiKeys = usePreferencesStore((s) => s.annotationAiApiKeys);
  const annotationAiCustomProviders = usePreferencesStore((s) => s.annotationAiCustomProviders);
  const setAnnotationAiApiKey = usePreferencesStore((s) => s.setAnnotationAiApiKey);
  const addAnnotationAiCustomProvider = usePreferencesStore((s) => s.addAnnotationAiCustomProvider);
  const removeAnnotationAiCustomProvider = usePreferencesStore(
    (s) => s.removeAnnotationAiCustomProvider,
  );
  // Annotation-column choice per example node (plain columns only — no "Start
  // new annotation" option, since examples reference existing labels).
  const [exampleAnnotationColumns, setExampleAnnotationColumns] = useState<Record<string, string>>(
    {},
  );
  const { currentWorkspaceId } = useWorkspaceData();
  const queryClient = useQueryClient();

  const handleSaveAiProvider = (config: AnnotationProviderConfigSave) => {
    if (config.customProvider) addAnnotationAiCustomProvider(config.customProvider);
    setAnnotationAiApiKey(config.id, config.apiKey);
    const nextModels = { ...aiProviderModels, [config.id]: config.model };
    persistAiProviderModels(nextModels);
    selectAiProvider(config.id, config.model);
    const label =
      config.customProvider?.name ?? resolveAnnotationAiProvider(config.id, [])?.label ?? config.id;
    toast.success(`Saved provider "${label}"`);
  };

  const handleDeleteAiProvider = (providerId: AnnotationAiProviderId) => {
    const customProvider = annotationAiCustomProviders.find(
      (candidate) => candidate.id === providerId,
    );
    if (customProvider) {
      removeAnnotationAiCustomProvider(providerId);
    } else if (parseConfiguredBuiltinProviderId(providerId)) {
      setAnnotationAiApiKey(providerId, null);
    } else {
      console.warn(`[annotation] Ignoring delete for unknown AI provider card: ${providerId}`);
      return;
    }
    const nextModels: Record<string, string> = {};
    for (const [id, savedModel] of Object.entries(aiProviderModels)) {
      if (id !== providerId) nextModels[id] = savedModel;
    }
    persistAiProviderModels(nextModels);
    if (aiProvider === providerId) selectAiProvider('', '');
    toast.success(`Removed provider "${customProvider?.name ?? providerId}"`);
  };

  // Once annotation has started, the run/results are pinned and every selector
  // and column picker locks until Reset; `isStarting` also locks during the
  // brief column-creation request so controls cannot change mid-flight. In AI
  // mode an open preview also locks the panel (and stays locked after a tab
  // switch, since `isPreviewing` is persisted while `hasRun` is not) so the
  // config that produced the on-screen predictions cannot change underneath them;
  // closing the preview clears the lock.
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
        disabled={isLocked}
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
        disabled={isLocked}
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
          disabled={isLocked}
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
        disabled={isLocked}
        options={columns.map((column) => ({ value: column, label: column }))}
        onValueChange={(next) => {
          setExampleAnnotationColumns((current) => ({ ...current, [nodeId]: next }));
        }}
      />
    );
  };

  const handleCreateClassDescriptionNode = async () => {
    if (!currentWorkspaceId || isCreatingClassNode) return;
    setIsCreatingClassNode(true);
    try {
      const { data } = await createAnnotationClassDescriptions({
        path: { workspace_id: currentWorkspaceId },
        throwOnError: true,
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.workspaceGraph(currentWorkspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.workspaceNodes(currentWorkspaceId),
        }),
      ]);
      onTabInputSetChange(CLASS_DESCRIPTION_SELECTOR_ID, [{ node_id: data.id, column: 'class' }]);
    } catch (error) {
      console.warn('[annotation] Failed to create class-description node:', error);
      toast.error('Could not create class descriptions');
    } finally {
      setIsCreatingClassNode(false);
    }
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
  const aiClassCount = classDescriptions.rows.filter(
    (row) => (row.class ?? '').trim().length > 0,
  ).length;
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
  const resolvedAiProvider = resolveAnnotationAiProvider(aiProvider, annotationAiCustomProviders);
  const aiApiKey = aiProvider ? (annotationAiApiKeys[aiProvider] ?? '') : '';
  const resolvedSystemPrompt = aiPrompt.trim() || DEFAULT_ANNOTATION_PROMPT;
  const hasClassNodeForAi = Boolean(
    classDescriptionNode && classDescriptionClassColumn && classDescriptionDescriptionColumn,
  );
  const canPreviewAi =
    resolvedAiProvider != null &&
    Boolean(sourceNode) &&
    hasClassNodeForAi &&
    aiClassCount > 0 &&
    canAnnotate(resolvedAiProvider, aiApiKey, aiModel);

  // Start/Resume: lock the setup and reveal the text + annotation results.
  // Start (new-annotation): create the annotation column on the source node,
  // reparent the class node under it, then switch the column picker from
  // "Start new annotation" into resume mode on the freshly created column.
  // Returns whether the run was started (locked) so callers that chain further
  // UI on success — the AI Preview button opens its panel only once the column
  // exists — can await the outcome and skip opening on a failed column create.
  const handleRunAnnotation = async (): Promise<boolean> => {
    if (!sourceNode || !currentWorkspaceId) return false;
    if (!isStartNewAnnotation) {
      // Resuming an existing column needs no backend mutation; just lock + reveal.
      setHasRun(true);
      return true;
    }
    const columnName = resolvedAnnotationColumn;
    setIsStarting(true);
    try {
      await createAnnotationColumn({
        path: { workspace_id: currentWorkspaceId, node_id: sourceNode.id },
        body: { column_name: columnName },
        throwOnError: true,
      });
      if (classDescriptionNode) {
        await setAnnotationClassParent({
          path: { workspace_id: currentWorkspaceId, node_id: classDescriptionNode.id },
          body: { parent_node_id: sourceNode.id },
          throwOnError: true,
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceNodes(currentWorkspaceId) }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.nodeData(currentWorkspaceId, sourceNode.id),
        }),
      ]);
      // Switch from "Start new annotation" to resuming the new column, then lock.
      setAnnotationTarget(sourceNode.id, columnName);
      setHasRun(true);
      return true;
    } catch (error) {
      console.warn('[annotation] Failed to start annotation:', error);
      toast.error('Could not start annotation');
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

  // Keep the session owner mounted even while its renderer is closed. Explicit
  // Close clears server/client preview state, whereas a tab unmount only cancels
  // in-flight browser requests so the backend session can hydrate on return.
  const persistedPreviewTarget = sourceNode ? annotationTargets[sourceNode.id] : undefined;
  const hasInvalidPersistedPreviewTarget = Boolean(
    isPreviewing &&
      sourceNode &&
      !hasRun &&
      (!persistedPreviewTarget ||
        persistedPreviewTarget === START_NEW_ANNOTATION_VALUE ||
        !sourceColumns.includes(persistedPreviewTarget)),
  );
  const aiPreviewSession = useAnnotationAiPreviewSession({
    workspaceId: currentWorkspaceId ?? null,
    nodeId: sourceNode?.id ?? null,
    textColumn: sourceNode?.column ?? '',
    annotationColumn: resolvedAnnotationColumn,
    classNodeId: classDescriptionNode?.id ?? null,
    classColumn: classDescriptionClassColumn,
    descriptionColumn: classDescriptionDescriptionColumn,
    providerId: resolvedAiProvider?.requestProviderId ?? '',
    baseUrl: resolvedAiProvider?.baseUrl ?? null,
    apiKey: aiApiKey,
    model: aiModel,
    systemPrompt: resolvedSystemPrompt,
    temperature: aiTemperature,
    reasoningEnabled: aiReasoningEnabled,
    reasoningEffort: aiReasoningEffort,
    isOpen: isPreviewing,
    targetValid: !hasInvalidPersistedPreviewTarget,
    onOpenChange: setIsPreviewing,
    prepareOpen: async () => hasRun || handleRunAnnotation(),
    onExplicitClose: handleReset,
  });

  /** Opens a prepared session or performs the explicit clear-and-unlock close. */
  /** Passed to: the AI-mode footer button. */
  const handleToggleAiPreview = async () => {
    if (isPreviewing) {
      await aiPreviewSession.commands.close();
    } else {
      await aiPreviewSession.commands.open();
    }
  };

  return (
    <section aria-label="Annotation Setup" className="space-y-5">
      <div className="relative">
        <section aria-label="Annotation Parameter Panel">
          <AnalysisCardLayout
            title="Annotation"
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
              ) : (
                <Button
                  type="button"
                  disabled={
                    isPreviewing
                      ? !aiPreviewSession.commands.canToggle
                      : !canPreviewAi || isStarting
                  }
                  onClick={() => {
                    void handleToggleAiPreview();
                  }}
                >
                  {isPreviewing ? 'Close preview' : 'Preview'}
                </Button>
              )
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
                disabled={isLocked}
              />
            </div>

            <section
              aria-label="Class Description Setup"
              className="mt-5 rounded-lg border bg-background/60 p-4"
            >
              <h3 className="mb-4 text-base font-semibold">Class Descriptions</h3>
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
                  disabled={isLocked}
                  headerAddon={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={!currentWorkspaceId || isCreatingClassNode || isLocked}
                      onClick={() => {
                        void handleCreateClassDescriptionNode();
                      }}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                      Add new
                    </Button>
                  }
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
                  disabled={isLocked}
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
                    apiKeys={annotationAiApiKeys}
                    providerModels={aiProviderModels}
                    customProviders={annotationAiCustomProviders}
                    onSaveProvider={handleSaveAiProvider}
                    onDeleteProvider={handleDeleteAiProvider}
                    model={aiModel}
                    disabled={isLocked}
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
                        disabled={isLocked}
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
                        disabled={isLocked}
                      />
                    </div>
                    <AnnotationInferenceSettings
                      temperature={aiTemperature}
                      onTemperatureCommit={commitAiTemperature}
                      reasoningEnabled={aiReasoningEnabled}
                      onReasoningEnabledChange={setAiReasoningEnabled}
                      reasoningEffort={aiReasoningEffort}
                      onReasoningEffortChange={setAiReasoningEffort}
                      disabled={isLocked}
                    />
                  </AnnotationAiSettings>
                </div>
              ) : null}
            </section>
          </AnalysisCardLayout>
        </section>
      </div>
      {annotationMode === 'manual' && hasRun && sourceNode ? (
        <AnnotationResultsPanel
          key={`${sourceNode.id}:${resolvedAnnotationColumn}:${String(isStartNewAnnotation)}`}
          workspaceId={currentWorkspaceId ?? null}
          nodeId={sourceNode.id}
          textColumn={sourceNode.column}
          annotationColumn={resolvedAnnotationColumn}
          isNew={isStartNewAnnotation}
          classNodeId={classDescriptionNode?.id ?? null}
          classColumn={classDescriptionClassColumn}
          descriptionColumn={classDescriptionDescriptionColumn}
        />
      ) : null}
      {annotationMode === 'ai' && isPreviewing && hasInvalidPersistedPreviewTarget ? (
        <section
          role="alert"
          aria-label="Invalid AI preview target"
          className="mt-5 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          The annotation column saved for this preview is missing. Close the preview and choose an
          existing annotation column before opening it again.
        </section>
      ) : annotationMode === 'ai' && isPreviewing && sourceNode && resolvedAiProvider ? (
        <AnnotationAiPreviewPanel session={aiPreviewSession} />
      ) : null}
    </section>
  );
}

export default AnnotationFeature;
