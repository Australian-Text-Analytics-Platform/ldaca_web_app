import { useState } from 'react';
import type { AnalysisTabInput, AnnotationClassDescriptionRow } from '@/api';
import {
  createAnnotationClassDescriptions,
  getAnnotationClassDescriptions,
  setAnnotationClassParent,
  updateAnnotationClassDescriptions,
} from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { AnalysisCardLayout } from '@/features/views/common/components/AnalysisCardLayout';
import { NodeInputsPanel } from '@/features/views/common/components/NodeInputsPanel';
import type { NodeInputColumnAddonArgs } from '@/features/views/common/components/NodeInputsPanel';
import { AnnotationResultsPanel } from './components/AnnotationResultsPanel';
import { useTabNodeInputs } from '@/features/views/common/nodeInputs';
import type { NodeAddRejection, NodeInputConstraints } from '@/features/views/common/nodeInputs';
import {
  DEFAULT_TAB_INPUT_SET_ID,
  type AnalysisTabInputSets,
} from '@/features/views/common/tabs/tabStateOps';
import { queryKeys } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { useNodeInputRequestsStore } from '@/stores/nodeInputRequestsStore';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
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
const START_NEW_ANNOTATION_VALUE = '__start_new_annotation__';
const DISABLED_CLASS_DESCRIPTIONS_QUERY_KEY = [
  'workspaces',
  'annotation',
  'class-descriptions',
  'disabled',
] as const;
const CLASS_DESCRIPTION_PREVIEW_LIMIT = 30;

interface AnnotationFeatureProps {
  tabId?: string;
  tabTaskId?: string | null;
  onTabTaskChange?: (taskId: string | null) => void;
  tabInputs?: AnalysisTabInput[];
  onTabInputsChange?: (inputs: AnalysisTabInput[]) => void;
  tabInputSets?: AnalysisTabInputSets;
  onTabInputSetChange?: (selectorId: string, inputs: AnalysisTabInput[]) => void;
}

interface ColumnPickerProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  placeholder: string;
  onValueChange: (value: string) => void;
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
}: ColumnPickerProps) {
  return (
    <div className="space-y-1">
      <Label className="block text-xs font-medium text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
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
 * Editable class-description row grid for the selected Annotation class node.
 *
 * Used by: AnnotationFeature's class-description card because users need to
 * edit the selected class/description node inline before running annotation.
 *
 * Flow: fetch the selected two-column payload, keep an editable local draft,
 * persist on blur or row creation, and invalidate the workspace node data cache
 * so other table views can observe the rewritten node.
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
  const [showAllClasses, setShowAllClasses] = useState(false);
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
  const hasHiddenRows = editorRows.length > CLASS_DESCRIPTION_PREVIEW_LIMIT && !showAllClasses;
  const visibleRows = showAllClasses
    ? editorRows
    : editorRows.slice(0, CLASS_DESCRIPTION_PREVIEW_LIMIT);

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
    setShowAllClasses(true);
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canLoad || classDescriptionsQuery.isLoading}
          onClick={handleAddClass}
        >
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Add class
        </Button>
      </div>

      {classDescriptionsQuery.isLoading ? (
        <div className="rounded-md border border-border px-4 py-3 text-sm text-muted-foreground">
          Loading class descriptions...
        </div>
      ) : editorRows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          No classes yet.
        </div>
      ) : (
        <div className="space-y-3">
          <Table containerClassName="rounded-md border border-border">
            <TableHeader>
              <TableRow>
                <TableHead className="w-1/3">Class</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row, index) => (
                <TableRow key={index} className="hover:bg-transparent">
                  <TableCell className="align-top">
                    <Input
                      aria-label={`Class ${String(index + 1)}`}
                      value={row.class ?? ''}
                      disabled={updateClassDescriptionsMutation.isPending}
                      onChange={(event) => {
                        updateDraftCell(index, 'class', event.target.value);
                      }}
                      onBlur={(event) => {
                        persistDraftCell(index, 'class', event.target.value);
                      }}
                    />
                  </TableCell>
                  <TableCell className="align-top">
                    <Textarea
                      aria-label={`Description ${String(index + 1)}`}
                      value={row.description ?? ''}
                      rows={2}
                      disabled={updateClassDescriptionsMutation.isPending}
                      className="min-h-9 resize-y"
                      onChange={(event) => {
                        updateDraftCell(index, 'description', event.target.value);
                      }}
                      onBlur={(event) => {
                        persistDraftCell(index, 'description', event.target.value);
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {hasHiddenRows ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setShowAllClasses(true);
              }}
            >
              Expand all
            </Button>
          ) : null}
        </div>
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
}: AnnotationFeatureProps) {
  const [annotationColumns, setAnnotationColumns] = useState<Record<string, string>>({});
  const [descriptionColumns, setDescriptionColumns] = useState<Record<string, string>>({});
  const [newColumnNames, setNewColumnNames] = useState<Record<string, string>>({});
  const [isCreatingClassNode, setIsCreatingClassNode] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const { getAuthHeaders } = useAuth();
  const { currentWorkspaceId } = useWorkspaceData();
  const queryClient = useQueryClient();
  const nodeInputRequests = useNodeInputRequestsStore((state) => state.requests);
  const consumeNodeInputRequest = useNodeInputRequestsStore((state) => state.consume);

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
        options={columns.map((column) => ({ value: column, label: column }))}
        onValueChange={(next) => {
          setDescriptionColumns((current) => ({ ...current, [nodeId]: next }));
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

  // Start/Resume: reveal the text + annotation results. On Start, also reparent
  // the class-description node under the source node so the lineage is visible.
  const handleRunAnnotation = async () => {
    setHasRun(true);
    if (isStartNewAnnotation && currentWorkspaceId && sourceNode && classDescriptionNode) {
      try {
        await setAnnotationClassParent({
          headers: getAuthHeaders(),
          path: { node_id: classDescriptionNode.id },
          body: { parent_node_id: sourceNode.id },
          throwOnError: true,
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.workspaceNodes(currentWorkspaceId) }),
        ]);
      } catch (error) {
        console.warn('[annotation] Failed to reparent class node:', error);
        toast.error('Could not link class descriptions to the source node');
      }
    }
    toast.info('Annotation coming soon');
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
              <Button
                type="button"
                disabled={!sourceNode}
                onClick={() => {
                  void handleRunAnnotation();
                }}
              >
                {isStartNewAnnotation ? 'Start' : 'Resume'}
              </Button>
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
                  headerAddon={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={!currentWorkspaceId || isCreatingClassNode}
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
      {hasRun && sourceNode ? (
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
    </section>
  );
}

export default AnnotationFeature;
