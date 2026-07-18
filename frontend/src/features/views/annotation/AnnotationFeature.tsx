import { useState } from 'react';
import { getProviderCredentials } from '@/api';
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
import { canAnnotate, getBuiltinProvider, type BuiltinAnnotationAiProviderId } from './aiProviders';
import { useAnnotationTabSettings } from './hooks/useAnnotationTabSettings';
import { useTabNodeInputs } from '@/features/views/common/nodeInputs';
import type { NodeInputConstraints } from '@/features/views/common/nodeInputs';
import { DEFAULT_TAB_INPUT_SET_ID } from '@/features/views/common/tabs/tabStateOps';
import type { AnalysisTabFeatureProps } from '@/features/views/common/tabs/AnalysisTabsHost';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
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
function AnnotationFeature({ host }: AnalysisTabFeatureProps) {
  const {
    inputSets: tabInputSets,
    setInputSet: onTabInputSetChange,
    settings: tabSettings,
    setSetting: onTabSettingChange,
  } = host;
  const [descriptionColumns, setDescriptionColumns] = useState<Record<string, string>>({});
  const [newColumnNames, setNewColumnNames] = useState<Record<string, string>>({});
  const [hasRun, setHasRun] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  // Tab-persisted AI settings live in their own hook so this feature body can
  // focus on selector, run, and results orchestration. API keys stay in
  // preferences, never in tab settings.
  const {
    annotationMode,
    setAnnotationMode,
    aiProviderModels,
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
  const providerCredentialsQuery = useQuery({
    queryKey: ['provider-credentials'],
    queryFn: async () => (await getProviderCredentials({ throwOnError: true })).data,
  });
  // Annotation-column choice per example node (plain columns only — no "Start
  // new annotation" option, since examples reference existing labels).
  const [exampleAnnotationColumns, setExampleAnnotationColumns] = useState<Record<string, string>>(
    {},
  );
  const { currentWorkspaceId } = useWorkspaceData();

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
  const configuredProviders = (providerCredentialsQuery.data?.annotation ?? {}) as Partial<
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

  // Start/Resume: lock the setup and reveal the text + annotation results.
  // Column creation is owned by the canonical analysis submission. The setup
  // therefore only records the selected output name in the tab draft.
  // Returns whether the run was started (locked) so callers that chain further
  // UI on success — the AI Preview button opens its panel only once the column
  // exists — can await the outcome and skip opening on a failed column create.
  const handleRunAnnotation = (): boolean => {
    if (!sourceNode || !currentWorkspaceId) return false;
    if (!isStartNewAnnotation) {
      // Resuming an existing column needs no backend mutation; just lock + reveal.
      setHasRun(true);
      return true;
    }
    const columnName = resolvedAnnotationColumn;
    setIsStarting(true);
    try {
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
    providerId: resolvedAiProvider.requestProviderId,
    model: aiModel,
    systemPrompt: resolvedSystemPrompt,
    temperature: aiTemperature,
    reasoningEnabled: aiReasoningEnabled,
    reasoningEffort: aiReasoningEffort,
    isOpen: isPreviewing,
    targetValid: !hasInvalidPersistedPreviewTarget,
    onOpenChange: setIsPreviewing,
    prepareOpen: () => Promise.resolve(hasRun || handleRunAnnotation()),
    onExplicitClose: handleReset,
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
                    configuredProviders={configuredProviders}
                    providerModels={aiProviderModels}
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
      ) : annotationMode === 'ai' && isPreviewing && sourceNode ? (
        <AnnotationAiPreviewPanel session={aiPreviewSession} />
      ) : null}
    </section>
  );
}

export default AnnotationFeature;
