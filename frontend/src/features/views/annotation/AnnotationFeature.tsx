import { useState } from 'react';
import type { AnalysisTabInput, AnnotationClassDescriptionRow } from '@/api';
import {
  annotateAiPreviewClear,
  createAnnotationClassDescriptions,
  createAnnotationColumn,
  getAnnotationClassDescriptions,
  setAnnotationClassParent,
  updateAnnotationClassDescriptions,
} from '@/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { AnalysisCardLayout } from '@/features/views/common/components/AnalysisCardLayout';
import { NodeInputsPanel } from '@/features/views/common/components/NodeInputsPanel';
import type { NodeInputColumnAddonArgs } from '@/features/views/common/components/NodeInputsPanel';
import { AnnotationResultsPanel } from './components/AnnotationResultsPanel';
import { AnnotationAiPreviewPanel } from './components/AnnotationAiPreviewPanel';
import { AnnotationAiSettings } from './components/AnnotationAiSettings';
import { AnnotationInferenceSettings } from './components/AnnotationInferenceSettings';
import {
  AnnotationPromptInput,
  DEFAULT_ANNOTATION_PROMPT,
} from './components/AnnotationPromptInput';
import type { AnnotationAiProviderId } from './aiProviders';
import { canAnnotate, resolveAnnotationAiProvider } from './aiProviders';
import { useTabNodeInputs } from '@/features/views/common/nodeInputs';
import type { NodeAddRejection, NodeInputConstraints } from '@/features/views/common/nodeInputs';
import {
  DEFAULT_TAB_INPUT_SET_ID,
  type AnalysisTabInputSets,
} from '@/features/views/common/tabs/tabStateOps';
import { queryKeys } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { useNodeInputRequestsStore } from '@/stores/nodeInputRequestsStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import type { AnnotationAiCustomProvider } from '@/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

const SOURCE_NODE_CONSTRAINTS: NodeInputConstraints = {
  allowedDataTypes: ['string'],
  maxNodes: 1,
};
const CLASS_DESCRIPTION_NODE_CONSTRAINTS: NodeInputConstraints = {
  allowedDataTypes: ['string'],
  maxNodes: 1,
  exactStringColumns: 2,
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
const DISABLED_CLASS_DESCRIPTIONS_QUERY_KEY = [
  'workspaces',
  'annotation',
  'class-descriptions',
  'disabled',
] as const;
// Compact card shows class-name badges; extras collapse into a "+N more" badge
// so the card stays tight while the full list lives in the Edit dialog.
const CLASS_NAME_PREVIEW_LIMIT = 20;

interface AnnotationFeatureProps {
  tabId?: string;
  tabTaskId?: string | null;
  onTabTaskChange?: (taskId: string | null) => void;
  tabInputs?: AnalysisTabInput[];
  onTabInputsChange?: (inputs: AnalysisTabInput[]) => void;
  tabInputSets?: AnalysisTabInputSets;
  onTabInputSetChange?: (selectorId: string, inputs: AnalysisTabInput[]) => void;
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

interface AnnotationNodeRequestTargetProps {
  label: string;
  disabled: boolean;
  onAdd: () => void;
}

interface AnnotationClassDescriptionsEditorProps {
  workspaceId: string | null;
  nodeId: string | null;
  classColumn: string | null;
  descriptionColumn: string | null;
  getAuthHeaders: () => Record<string, string>;
}

const normalizeClassDescriptionRows = (
  rows: AnnotationClassDescriptionRow[] | undefined,
): AnnotationClassDescriptionRow[] =>
  (rows ?? []).map((row) => ({
    class: row.class ?? '',
    description: row.description ?? '',
  }));

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
 * Large target laid over one selector while Annotation is choosing where a
 * graph/sidebar "+" request should land.
 *
 * Used by: AnnotationFeature's two selector wrappers after the card-level mask
 * dims everything except the node-selection regions.
 */
function AnnotationNodeRequestTarget({ label, disabled, onAdd }: AnnotationNodeRequestTargetProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={`Add to ${label}`}
      disabled={disabled}
      className="absolute inset-0 z-10 h-full w-full justify-start gap-6 rounded-lg border-2 border-dashed border-muted-foreground/35 bg-card/95 px-8 text-left text-base shadow-none hover:border-primary/70 hover:bg-card focus-visible:ring-2"
      onClick={onAdd}
    >
      <Plus className="h-11 w-11 stroke-[1.7]" aria-hidden="true" />
      <span className="text-lg font-semibold">{label}</span>
    </Button>
  );
}

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
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Compact class summary plus an Edit dialog for the selected Annotation class node.
 *
 * Used by: AnnotationFeature's class-description card because users need to see
 * the configured classes at a glance and edit them (add/rename/delete) before
 * running annotation, without the descriptions cluttering the card.
 *
 * Flow: fetch the selected two-column payload, render the class names as compact
 * badges, and expose an "Edit" button that opens a dialog. The dialog keeps an
 * editable local draft of class/description rows, persists each change on blur
 * (and on add/delete), and invalidates the workspace node data cache so other
 * table views observe the rewritten node. The Edit trigger stays enabled even
 * after annotation starts so reviewers can amend classes on the go.
 */
function AnnotationClassDescriptionsEditor({
  workspaceId,
  nodeId,
  classColumn,
  descriptionColumn,
  getAuthHeaders,
}: AnnotationClassDescriptionsEditorProps) {
  const queryClient = useQueryClient();
  const [draftRows, setDraftRows] = useState<AnnotationClassDescriptionRow[] | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const canLoad = Boolean(workspaceId && nodeId && classColumn && descriptionColumn);
  const queryKey =
    canLoad && workspaceId && nodeId && classColumn && descriptionColumn
      ? queryKeys.annotationClassDescriptions(workspaceId, nodeId, classColumn, descriptionColumn)
      : DISABLED_CLASS_DESCRIPTIONS_QUERY_KEY;

  const classDescriptionsQuery = useQuery({
    queryKey,
    enabled: canLoad,
    queryFn: async () => {
      if (!nodeId || !classColumn || !descriptionColumn) {
        throw new Error('Missing class-description selection');
      }
      const { data } = await getAnnotationClassDescriptions({
        headers: getAuthHeaders(),
        path: { node_id: nodeId },
        query: { class_column: classColumn, description_column: descriptionColumn },
        throwOnError: true,
      });
      return data;
    },
  });

  const savedRows = normalizeClassDescriptionRows(classDescriptionsQuery.data?.rows);
  const editorRows = draftRows ?? savedRows;
  // Compact card display: non-empty class names paired with their (trimmed)
  // descriptions so each chip can show its description in a hover tooltip; capped
  // with a "+N more" badge. Chips without a description render as plain badges.
  const classChips = editorRows
    .map((row) => ({
      name: (row.class ?? '').trim(),
      description: (row.description ?? '').trim(),
    }))
    .filter((chip) => chip.name.length > 0);
  const visibleClassChips = classChips.slice(0, CLASS_NAME_PREVIEW_LIMIT);
  const hiddenClassCount = classChips.length - visibleClassChips.length;

  const updateClassDescriptionsMutation = useMutation({
    mutationFn: async (rows: AnnotationClassDescriptionRow[]) => {
      if (!nodeId || !classColumn || !descriptionColumn) {
        throw new Error('Missing class-description selection');
      }
      const body = {
        class_column: classColumn,
        description_column: descriptionColumn,
        rows,
      };
      const { data } = await updateAnnotationClassDescriptions({
        headers: getAuthHeaders(),
        path: { node_id: nodeId },
        body,
        throwOnError: true,
      });
      return data;
    },
    onSuccess: (payload) => {
      const rows = normalizeClassDescriptionRows(payload.rows);
      setDraftRows(rows);
      if (workspaceId && nodeId && classColumn && descriptionColumn) {
        queryClient.setQueryData(
          queryKeys.annotationClassDescriptions(workspaceId, nodeId, classColumn, descriptionColumn),
          { ...payload, rows },
        );
        void queryClient.invalidateQueries({
          queryKey: queryKeys.nodeData(workspaceId, nodeId),
        });
      }
    },
    onError: (error) => {
      console.warn('[annotation] Failed to update class descriptions:', error);
      toast.error('Could not update class descriptions');
    },
  });

  const persistRows = (rows: AnnotationClassDescriptionRow[]) => {
    if (!canLoad) return;
    updateClassDescriptionsMutation.mutate(normalizeClassDescriptionRows(rows));
  };

  const updateDraftCell = (
    rowIndex: number,
    field: 'class' | 'description',
    value: string,
  ) => {
    setDraftRows((current) =>
      (current ?? editorRows).map((row, index) =>
        index === rowIndex ? { ...row, [field]: value } : row,
      ),
    );
  };

  const persistDraftCell = (
    rowIndex: number,
    field: 'class' | 'description',
    value: string,
  ) => {
    const nextRows = editorRows.map((row, index) =>
      index === rowIndex ? { ...row, [field]: value } : row,
    );
    setDraftRows(nextRows);
    persistRows(nextRows);
  };

  const handleAddClass = () => {
    const nextRows = [...editorRows, { class: '', description: '' }];
    setDraftRows(nextRows);
    persistRows(nextRows);
  };

  // Delete the row at rowIndex and persist the remaining classes (the missing
  // delete affordance this card previously lacked).
  const handleDeleteClass = (rowIndex: number) => {
    const nextRows = editorRows.filter((_, index) => index !== rowIndex);
    setDraftRows(nextRows);
    persistRows(nextRows);
  };

  if (!nodeId) {
    return (
      <div className="mt-4 rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
        Select a class-description node to edit classes.
      </div>
    );
  }

  if (classDescriptionsQuery.isError) {
    return (
      <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Could not load class descriptions.
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-semibold">Classes</h3>
        <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canLoad || classDescriptionsQuery.isLoading}
            >
              <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Edit
            </Button>
          </DialogTrigger>
          <DialogContent
            className="max-w-2xl"
            onOpenAutoFocus={(event) => {
              // Don't drop a cursor into the first class input on open: that
              // would persist a redundant no-op save the moment the user clicks
              // Add/Delete (the blur fires before the click).
              event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>Edit classes</DialogTitle>
              <DialogDescription>
                Add, rename, or remove annotation classes and their descriptions.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
              {editorRows.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  No classes yet. Use “Add class” to create one.
                </p>
              ) : (
                editorRows.map((row, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <Input
                      aria-label={`Class ${String(index + 1)}`}
                      value={row.class ?? ''}
                      placeholder="Class"
                      className="w-1/3"
                      disabled={updateClassDescriptionsMutation.isPending}
                      onChange={(event) => {
                        updateDraftCell(index, 'class', event.target.value);
                      }}
                      onBlur={(event) => {
                        persistDraftCell(index, 'class', event.target.value);
                      }}
                    />
                    <Textarea
                      aria-label={`Description ${String(index + 1)}`}
                      value={row.description ?? ''}
                      rows={2}
                      placeholder="Description"
                      disabled={updateClassDescriptionsMutation.isPending}
                      className="min-h-9 flex-1 resize-y"
                      onChange={(event) => {
                        updateDraftCell(index, 'description', event.target.value);
                      }}
                      onBlur={(event) => {
                        persistDraftCell(index, 'description', event.target.value);
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete class ${String(index + 1)}`}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        handleDeleteClass(index);
                      }}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))
              )}
            </div>
            <DialogFooter className="sm:justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canLoad}
                onClick={handleAddClass}
              >
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Add class
              </Button>
              <DialogClose asChild>
                <Button type="button" size="sm">
                  Done
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {classDescriptionsQuery.isLoading ? (
        <div className="rounded-md border border-border px-4 py-3 text-sm text-muted-foreground">
          Loading class descriptions...
        </div>
      ) : classChips.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          No classes yet.
        </div>
      ) : (
        <TooltipProvider delayDuration={120} skipDelayDuration={0}>
          <div className="flex flex-wrap gap-1.5">
            {visibleClassChips.map((chip, index) =>
              // Only classes with a description get a hover tooltip; the trigger is
              // a native span (asChild) so the ref/hover wiring is guaranteed even
              // though Badge is not a forwardRef component.
              chip.description ? (
                <Tooltip key={`${chip.name}-${String(index)}`}>
                  <TooltipTrigger asChild>
                    <span className="inline-flex cursor-default">
                      <Badge variant="secondary">{chip.name}</Badge>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs whitespace-normal break-words">
                    {chip.description}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Badge key={`${chip.name}-${String(index)}`} variant="secondary">
                  {chip.name}
                </Badge>
              ),
            )}
            {hiddenClassCount > 0 ? (
              <Badge variant="outline">+{String(hiddenClassCount)} more</Badge>
            ) : null}
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}

/**
 * Annotation setup panel. This redesign slice exposes source node/column
 * selection plus a class-description setup card with an inline editable table.
 *
 * Rendered by: AnnotationTabbedFeature through AnalysisTabsHost because the
 * Annotation view should share the same tabbed workflow shell as other
 * analysis-style views.
 *
 * Flow: bind both selectors to named input sets on the active tab, render
 * Annotation-specific companion column pickers, create/select a backend
 * class-description node when requested, and load/save editable class rows.
 */
function AnnotationFeature({
  tabInputs,
  onTabInputsChange,
  tabInputSets,
  onTabInputSetChange,
  tabSettings,
  onTabSettingChange,
}: AnnotationFeatureProps) {
  const [annotationColumns, setAnnotationColumns] = useState<Record<string, string>>({});
  const [descriptionColumns, setDescriptionColumns] = useState<Record<string, string>>({});
  const [newColumnNames, setNewColumnNames] = useState<Record<string, string>>({});
  const [isCreatingClassNode, setIsCreatingClassNode] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  // AI-mode settings persist on the active tab (tabs.json) via
  // onTabSettingChange, so they survive reloads and tab switches like the node
  // selectors do. Each is mirrored into local state seeded from the persisted
  // value — the `useState` lazy initializer reads tabSettings once per mount,
  // and AnalysisTabsHost remounts this feature per tab (key=tab_id), so the
  // seed re-reads when the active tab changes. Keeping a local mirror also lets
  // the component work standalone in tests without the tab host. Mode/provider
  // commit on change (discrete actions); model/prompt commit on blur (they
  // double as typed input, so per-keystroke persistence would be wasteful),
  // mirroring the API-key save-on-blur pattern. The API key itself lives in
  // preferences, never in tab settings.
  const [annotationMode, setAnnotationModeState] = useState<'manual' | 'ai'>(() =>
    tabSettings?.annotationMode === 'ai' ? 'ai' : 'manual',
  );
  const setAnnotationMode = (mode: 'manual' | 'ai') => {
    setAnnotationModeState(mode);
    onTabSettingChange?.('annotationMode', mode);
  };
  const [aiProvider, setAiProviderState] = useState<AnnotationAiProviderId>(
    () => tabSettings?.aiProvider ?? 'openrouter',
  );
  const setAiProvider = (id: AnnotationAiProviderId) => {
    setAiProviderState(id);
    onTabSettingChange?.('aiProvider', id);
  };
  const [aiModel, setAiModel] = useState(() => tabSettings?.aiModel ?? '');
  // Persist the model id (blur / model pick) — see ModelNameCombobox onCommit.
  const commitAiModel = (model: string) => {
    onTabSettingChange?.('aiModel', model);
  };
  // Instruction prompt for AI annotation. Empty means "use the grayed default",
  // which the prompt editor offers via Tab. Persisted on blur.
  const [aiPrompt, setAiPrompt] = useState(() => tabSettings?.aiPrompt ?? '');
  const commitAiPrompt = (prompt: string) => {
    onTabSettingChange?.('aiPrompt', prompt);
  };
  // Advanced "Model Configuration" knobs (collapsed by default). Persisted like
  // the other AI settings, but stored as strings in tabSettings (the sink is
  // Record<string,string>) and parsed back on hydration. Defaults reproduce the
  // backend defaults: deterministic sampling (temperature 0) and reasoning off.
  const [aiTemperature, setAiTemperatureState] = useState<number>(() => {
    const parsed = Number(tabSettings?.aiTemperature);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const commitAiTemperature = (value: number) => {
    setAiTemperatureState(value);
    onTabSettingChange?.('aiTemperature', String(value));
  };
  const [aiReasoningEnabled, setAiReasoningEnabledState] = useState<boolean>(
    () => tabSettings?.aiReasoningEnabled === 'true',
  );
  const setAiReasoningEnabled = (enabled: boolean) => {
    setAiReasoningEnabledState(enabled);
    onTabSettingChange?.('aiReasoningEnabled', String(enabled));
  };
  const [aiReasoningEffort, setAiReasoningEffortState] = useState<string>(
    () => tabSettings?.aiReasoningEffort ?? 'medium',
  );
  const setAiReasoningEffort = (effort: string) => {
    setAiReasoningEffortState(effort);
    onTabSettingChange?.('aiReasoningEffort', effort);
  };
  // Whether the AI Preview panel is open. Persisted on the active tab (like the
  // other AI settings) so leaving and returning to the tab reopens the panel; the
  // panel then rehydrates its labels/overrides from the backend preview session.
  // Toggled by the AI-mode footer button and hidden again on Close or when leaving
  // AI mode. Seeded from tabSettings on mount (AnalysisTabsHost remounts per tab).
  const [isPreviewing, setIsPreviewingState] = useState(
    () => tabSettings?.aiPreviewOpen === 'true',
  );
  const setIsPreviewing = (open: boolean) => {
    setIsPreviewingState(open);
    onTabSettingChange?.('aiPreviewOpen', String(open));
  };
  const annotationAiApiKeys = usePreferencesStore((s) => s.annotationAiApiKeys);
  const annotationAiCustomProviders = usePreferencesStore(
    (s) => s.annotationAiCustomProviders,
  );
  const setAnnotationAiApiKey = usePreferencesStore((s) => s.setAnnotationAiApiKey);
  const addAnnotationAiCustomProvider = usePreferencesStore(
    (s) => s.addAnnotationAiCustomProvider,
  );
  // Annotation-column choice per example node (plain columns only — no "Start
  // new annotation" option, since examples reference existing labels).
  const [exampleAnnotationColumns, setExampleAnnotationColumns] = useState<Record<string, string>>(
    {},
  );
  const { getAuthHeaders } = useAuth();
  const { currentWorkspaceId } = useWorkspaceData();
  const queryClient = useQueryClient();
  const nodeInputRequests = useNodeInputRequestsStore((state) => state.requests);
  const consumeNodeInputRequest = useNodeInputRequestsStore((state) => state.consume);

  // Once annotation has started, the run/results are pinned and every selector
  // and column picker locks until Reset; `isStarting` also locks during the
  // brief column-creation request so controls cannot change mid-flight. In AI
  // mode an open preview also locks the panel (and stays locked after a tab
  // switch, since `isPreviewing` is persisted while `hasRun` is not) so the
  // config that produced the on-screen predictions cannot change underneath them;
  // closing the preview clears the lock.
  const isLocked = hasRun || isStarting || (annotationMode === 'ai' && isPreviewing);

  const sourceNodeInputs = useTabNodeInputs({
    selectorId: DEFAULT_TAB_INPUT_SET_ID,
    tabInputs,
    onTabInputsChange,
    tabInputSets,
    onTabInputSetChange,
    constraints: SOURCE_NODE_CONSTRAINTS,
    consumeNodeInputRequests: false,
  });
  const classNodeInputs = useTabNodeInputs({
    selectorId: CLASS_DESCRIPTION_SELECTOR_ID,
    tabInputs,
    tabInputSets,
    onTabInputSetChange,
    constraints: CLASS_DESCRIPTION_NODE_CONSTRAINTS,
    consumeNodeInputRequests: false,
  });
  // Optional few-shot example node, surfaced only in AI mode. Persists in its own
  // input set so it round-trips with the rest of the tab state.
  const exampleNodeInputs = useTabNodeInputs({
    selectorId: EXAMPLE_NODE_SELECTOR_ID,
    tabInputs,
    tabInputSets,
    onTabInputSetChange,
    constraints: EXAMPLE_NODE_CONSTRAINTS,
    consumeNodeInputRequests: false,
  });
  const pendingNodeInputRequest = nodeInputRequests.find(
    (request) => request.workspaceId === currentWorkspaceId && request.view === 'annotation',
  );

  const renderAnnotationColumnPicker = ({ nodeId, columns }: NodeInputColumnAddonArgs) => {
    const value = annotationColumns[nodeId] ?? START_NEW_ANNOTATION_VALUE;
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
          setAnnotationColumns((current) => ({ ...current, [nodeId]: next }));
        }}
      />
    );
  };

  const renderDescriptionColumnPicker = ({
    nodeId,
    columns,
    column,
  }: NodeInputColumnAddonArgs) => {
    const fallback = resolveDescriptionColumn(columns, column);
    const value = descriptionColumns[nodeId] ?? fallback;
    return (
      <AnnotationColumnPicker
        label="Description"
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
        headers: getAuthHeaders(),
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
      onTabInputSetChange?.(CLASS_DESCRIPTION_SELECTOR_ID, [
        { node_id: data.id, column: 'class' },
      ]);
    } catch (error) {
      console.warn('[annotation] Failed to create class-description node:', error);
      toast.error('Could not create class descriptions');
    } finally {
      setIsCreatingClassNode(false);
    }
  };

  const reportNodeAddRejections = (rejections: NodeAddRejection[]) => {
    if (rejections.length === 1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length===1 guarantees index 0 exists
      toast.warning(`Couldn't add node: ${rejections[0]!.reason}`);
    } else if (rejections.length > 1) {
      toast.warning(
        `Couldn't add ${String(rejections.length)} nodes (incompatible or already added).`,
      );
    }
  };

  const handleRequestedNodeAdd = (target: 'source' | 'classDescriptions') => {
    if (!pendingNodeInputRequest) return;
    const rejections =
      target === 'source'
        ? sourceNodeInputs.addNodes(pendingNodeInputRequest.nodeIds)
        : classNodeInputs.addNodes(pendingNodeInputRequest.nodeIds);
    reportNodeAddRejections(rejections);
    consumeNodeInputRequest(pendingNodeInputRequest.id);
  };

  const handleRequestedNodeCancel = () => {
    if (!pendingNodeInputRequest) return;
    consumeNodeInputRequest(pendingNodeInputRequest.id);
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
  // Load the class node's class/description rows so the AI Preview button can be
  // gated on there actually being at least one class to predict into. Keyed the
  // same way as the class-descriptions editor and the preview panel, so react-query
  // dedupes and this adds no extra request; when a class node/columns aren't chosen
  // the key is a stable sentinel and the (disabled) query never fetches.
  const canLoadClassCount = Boolean(
    currentWorkspaceId &&
      classDescriptionNode?.id &&
      classDescriptionClassColumn &&
      classDescriptionDescriptionColumn,
  );
  const classCountQuery = useQuery({
    queryKey:
      canLoadClassCount &&
      currentWorkspaceId &&
      classDescriptionNode?.id &&
      classDescriptionClassColumn &&
      classDescriptionDescriptionColumn
        ? queryKeys.annotationClassDescriptions(
            currentWorkspaceId,
            classDescriptionNode.id,
            classDescriptionClassColumn,
            classDescriptionDescriptionColumn,
          )
        : DISABLED_CLASS_DESCRIPTIONS_QUERY_KEY,
    enabled: canLoadClassCount,
    queryFn: async () => {
      if (
        !classDescriptionNode?.id ||
        !classDescriptionClassColumn ||
        !classDescriptionDescriptionColumn
      ) {
        throw new Error('Missing class-description selection');
      }
      const { data } = await getAnnotationClassDescriptions({
        headers: getAuthHeaders(),
        path: { node_id: classDescriptionNode.id },
        query: {
          class_column: classDescriptionClassColumn,
          description_column: classDescriptionDescriptionColumn,
        },
        throwOnError: true,
      });
      return data;
    },
  });
  // Count only non-empty class names: an empty class node (or one whose rows are all
  // blank) offers nothing to classify into, so Preview must stay disabled until at
  // least one real class exists.
  const aiClassCount = normalizeClassDescriptionRows(classCountQuery.data?.rows).filter(
    (row) => (row.class ?? '').trim().length > 0,
  ).length;
  const isChoosingNodeTarget = Boolean(pendingNodeInputRequest);
  const highlightedSelectorClassName = 'z-30 rounded-lg bg-card';

  // Source node drives the run action: "Start new annotation" begins a fresh
  // pass, while picking an existing column resumes annotating that column.
  const sourceNode = sourceNodeInputs.resolvedNodes[0] ?? null;
  const sourceAnnotationColumn = sourceNode
    ? (annotationColumns[sourceNode.id] ?? START_NEW_ANNOTATION_VALUE)
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
  const aiApiKey = annotationAiApiKeys[aiProvider] ?? '';
  const resolvedSystemPrompt = aiPrompt.trim() || DEFAULT_ANNOTATION_PROMPT;
  const hasClassNodeForAi = Boolean(
    classDescriptionNode && classDescriptionClassColumn && classDescriptionDescriptionColumn,
  );
  const canPreviewAi =
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
        headers: getAuthHeaders(),
        path: { node_id: sourceNode.id },
        body: { column_name: columnName },
        throwOnError: true,
      });
      if (classDescriptionNode) {
        await setAnnotationClassParent({
          headers: getAuthHeaders(),
          path: { node_id: classDescriptionNode.id },
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
      setAnnotationColumns((current) => ({ ...current, [sourceNode.id]: columnName }));
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

  // AI Preview button: open/close the preview panel. AI mode has no Resume — a
  // single batch fills every cell — so the button is always Preview. Opening it
  // reuses the manual Start lifecycle (handleRunAnnotation) so the first Preview
  // for a "Start new annotation" column creates that column, reparents the class
  // node, switches the picker into resume mode, and locks the selectors (the
  // class Edit button stays enabled, exactly as in manual mode). The panel only
  // opens once the run is locked so its first page fetch already sees the freshly
  // created column. Closing the preview unlocks the parameter panel (like manual
  // Reset): handleReset keeps the source pointed at the created column, so
  // reopening resumes it and never recreates the column. Closing also drops the
  // server-side preview cache for this node — unlike a tab switch (which only
  // unmounts the panel and must keep the cache so it can rehydrate), an explicit
  // close means the predictions are no longer wanted, so reopening re-classifies
  // from scratch and no stale detach/annotate-all count lingers. The clear is
  // fire-and-forget: a failed cleanup must never block closing the panel.
  const handleToggleAiPreview = async () => {
    if (isPreviewing) {
      setIsPreviewing(false);
      handleReset();
      if (currentWorkspaceId && sourceNode) {
        void annotateAiPreviewClear({
          headers: getAuthHeaders(),
          body: { node_id: sourceNode.id },
          throwOnError: true,
        }).catch((error: unknown) => {
          console.warn('[annotation] Failed to clear AI preview cache:', error);
        });
      }
      return;
    }
    const started = hasRun || (await handleRunAnnotation());
    if (started) setIsPreviewing(true);
  };

  // Reset: clear the results and unlock the setup, but keep the source node
  // pointed at the column Start created — the card returns to resume mode on
  // that same column, not to "Start new annotation". Clicking the button again
  // (now "Resume") simply re-reveals the results for that column.
  const handleReset = () => {
    setHasRun(false);
  };

  return (
    <section aria-label="Annotation Setup" className="space-y-5">
      <div
        className="relative"
        role={isChoosingNodeTarget ? 'dialog' : undefined}
        aria-label={isChoosingNodeTarget ? 'Choose annotation node selector' : undefined}
      >
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
                  disabled={!isPreviewing && (!canPreviewAi || isStarting)}
                  onClick={() => {
                    void handleToggleAiPreview();
                  }}
                >
                  {isPreviewing ? 'Close preview' : 'Preview'}
                </Button>
              )
            }
          >
            <div className={cn('relative', isChoosingNodeTarget && highlightedSelectorClassName)}>
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
                disabled={isLocked}
              />
              {sourceNode && isStartNewAnnotation ? (
                <div className="mt-3 space-y-1">
                  <Label
                    htmlFor="annotation-new-column-name"
                    className="block text-xs font-medium text-muted-foreground"
                  >
                    New Column Name
                  </Label>
                  <Input
                    id="annotation-new-column-name"
                    aria-label="New Column Name"
                    value={newColumnName}
                    placeholder={defaultNewColumnName}
                    disabled={isLocked}
                    onChange={(event) => {
                      const { value } = event.target;
                      setNewColumnNames((current) => ({ ...current, [sourceNode.id]: value }));
                    }}
                  />
                </div>
              ) : null}
              {isChoosingNodeTarget ? (
                <AnnotationNodeRequestTarget
                  label="Selected Data Blocks"
                  disabled={!sourceNodeInputs.canAddMore}
                  onAdd={() => {
                    handleRequestedNodeAdd('source');
                  }}
                />
              ) : null}
            </div>

            <section
              aria-label="Class Description Setup"
              className="mt-5 rounded-lg border bg-background/60 p-4"
            >
              <h3 className="mb-4 text-base font-semibold">Class Descriptions</h3>
              <div className={cn('relative', isChoosingNodeTarget && highlightedSelectorClassName)}>
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
                  columnLabel="Class"
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
                {isChoosingNodeTarget ? (
                  <AnnotationNodeRequestTarget
                    label="Class Description"
                    disabled={!classNodeInputs.canAddMore}
                    onAdd={() => {
                      handleRequestedNodeAdd('classDescriptions');
                    }}
                  />
                ) : null}
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
                getAuthHeaders={getAuthHeaders}
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
                    provider={aiProvider}
                    onProviderChange={setAiProvider}
                    customProviders={annotationAiCustomProviders}
                    onAddCustomProvider={(definition: AnnotationAiCustomProvider) => {
                      // Persist (debounced backend sync) then select the new
                      // provider so the dropdown immediately reflects the choice.
                      addAnnotationAiCustomProvider(definition);
                      setAiProvider(definition.id);
                      toast.success(`Saved provider “${definition.name}”`);
                    }}
                    apiKey={annotationAiApiKeys[aiProvider] ?? ''}
                    onApiKeyCommit={(key) => {
                      setAnnotationAiApiKey(aiProvider, key);
                    }}
                    model={aiModel}
                    onModelChange={setAiModel}
                    onModelCommit={commitAiModel}
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
        {isChoosingNodeTarget ? (
          <div className="absolute inset-0 z-20 rounded-xl bg-background/80 p-5 backdrop-blur-[2px]">
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 bg-background/80 px-2 text-xs"
                onClick={handleRequestedNodeCancel}
              >
                <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
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
          getAuthHeaders={getAuthHeaders}
        />
      ) : null}
      {annotationMode === 'ai' && isPreviewing && sourceNode ? (
        <AnnotationAiPreviewPanel
          key={`${sourceNode.id}:${resolvedAnnotationColumn}:${resolvedAiProvider.id}:${aiModel}`}
          workspaceId={currentWorkspaceId ?? null}
          nodeId={sourceNode.id}
          textColumn={sourceNode.column}
          annotationColumn={resolvedAnnotationColumn}
          classNodeId={classDescriptionNode?.id ?? null}
          classColumn={classDescriptionClassColumn}
          descriptionColumn={classDescriptionDescriptionColumn}
          providerId={resolvedAiProvider.id}
          baseUrl={resolvedAiProvider.baseUrl ?? null}
          apiKey={aiApiKey}
          model={aiModel}
          systemPrompt={resolvedSystemPrompt}
          temperature={aiTemperature}
          reasoningEnabled={aiReasoningEnabled}
          reasoningEffort={aiReasoningEffort}
          getAuthHeaders={getAuthHeaders}
        />
      ) : null}
    </section>
  );
}

export default AnnotationFeature;
