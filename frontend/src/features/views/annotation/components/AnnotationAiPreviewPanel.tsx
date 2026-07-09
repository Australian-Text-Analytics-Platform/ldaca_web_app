import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  annotateAiAll,
  annotateAiPreview,
  annotateAiPreviewOverride,
  annotateAiPreviewState,
  detachAiPreviewedRows,
  getAnnotationClassDescriptions,
  getNodeDataByWorkspaceId,
} from '@/api';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
import { ServerPaginationFooter } from '@/features/views/common/components/ServerPaginationFooter';
import { useServerTable } from '@/features/views/common/hooks/useServerTable';
import { queryKeys } from '@/lib/queryKeys';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import type { AnnotationClassOption } from '../aiProviders';

// One LLM request per page; 20 keeps the per-request token cost and latency
// reasonable while still showing a meaningful chunk of predictions at once.
const AI_PREVIEW_PAGE_SIZE = 20;
// Radix `Select` rejects an empty-string item value, so the "clear" option uses
// a sentinel that onValueChange maps back to '' (an unset/null prediction).
const NO_CLASS_VALUE = '__no_class__';
type AnnotationPreviewRow = Record<string, unknown>;

/** Coerce an unknown cell value to display text without object stringification. */
const cellText = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

interface AnnotationAiPreviewPanelProps {
  workspaceId: string | null;
  /** Source node whose text column is classified page by page. */
  nodeId: string;
  textColumn: string;
  /**
   * Annotation column being previewed. When a row already carries a value here
   * (previewing over an existing/partly-filled column), it is shown struck
   * through beside the AI prediction so the change is obvious. For a freshly
   * created "Start new annotation" column every cell is empty, so nothing is
   * struck through.
   */
  annotationColumn: string;
  /** Class-description node supplying the prompt class list + dropdown options. */
  classNodeId: string | null;
  classColumn: string | null;
  descriptionColumn: string | null;
  /**
   * Provider id the backend dispatches through (built-in literal or
   * `custom:<uuid>`), plus the custom endpoint base URL (null for built-ins).
   * The browser no longer talks to providers directly, so these travel to
   * `/annotation/ai/*` which owns the provider SDK calls.
   */
  providerId: string;
  baseUrl: string | null;
  apiKey: string;
  model: string;
  /** Instruction prompt already resolved to the user's text or the grayed default. */
  systemPrompt: string;
  /**
   * Advanced inference knobs from the "Model Configuration" section. They travel
   * with every preview/annotate-all request so the backend applies the same
   * sampling/reasoning settings the user configured. Optional with backend-matching
   * defaults so the panel still works standalone (e.g. in tests).
   */
  temperature?: number;
  reasoningEnabled?: boolean;
  reasoningEffort?: string;
  getAuthHeaders: () => Record<string, string>;
}

/**
 * Server-driven AI preview of annotations: for the current page of the source
 * node, it asks the backend preview-session resource to classify that page's
 * texts and renders the structured per-row class predictions. Preview
 * predictions are transient — the backend does not persist them (unlike
 * AnnotationResultsPanel); only the "Annotate All" button writes the column.
 *
 * Used by: AnnotationFeature in AI mode when the user toggles Preview, so they can
 * eyeball how the configured provider/model/prompt/classes label their data
 * before committing to a full run.
 *
 * Flow: on mount it rehydrates from the server preview session
 * (`annotateAiPreviewState`, `refetchOnMount: 'always'`) so a tab switch restores
 * every previously previewed page's manual overrides (AnnotationFeature remounts
 * the panel per tab; the AI labels themselves come back through the cached per-page
 * annotate query). It fetches the source page text + the class list (for the
 * dropdown), then fires `annotateAiPreview` once per page via React Query (keyed by
 * node/page/provider/model/key/prompt/inference-knobs/classes with staleTime
 * Infinity). The backend caches predictions server-side, so revisiting a page is a
 * cheap cache hit that never re-spends, and it owns the provider SDK call, so no
 * key/text leaves via the browser to a provider. The temperature/reasoning knobs
 * from the "Model Configuration" section travel in every preview + annotate-all body
 * so the backend applies the same sampling/reasoning the user configured. The text
 * column is read-only; each prediction cell is a dropdown seeded from the model's
 * label that the user can override locally (a "None" option clears it) — each edit is
 * persisted to the server session via `annotateAiPreviewOverride` so it survives a
 * tab switch. When the previewed row already has a value in annotationColumn, that
 * existing label is shown struck through beside the AI prediction. Loading/error
 * states render on the prediction column, with Retry re-issuing just the failed
 * page's request. The footer's "Annotate All" button runs `annotateAiAll` to
 * classify + persist every row in one go (reusing cached preview labels for rows
 * already previewed). "Detach Previewed Rows" (beside it) opens a confirmation
 * dialog — its enablement and the row count it shows come from a dry-run
 * `detachAiPreviewedRows` probe (`detachCountQuery`) that asks the server how many
 * rows the session holds, so it stays correct across tab switches (the local page
 * map is wiped on remount). Confirming posts the node + column (no `dry_run`), and
 * the backend reads the authoritative previewed-row set from the server session —
 * every viewed page, not just the current one — and materializes them as a new
 * annotated child node without re-running the LLM.
 */
export function AnnotationAiPreviewPanel({
  workspaceId,
  nodeId,
  textColumn,
  annotationColumn,
  classNodeId,
  classColumn,
  descriptionColumn,
  providerId,
  baseUrl,
  apiKey,
  model,
  systemPrompt,
  temperature = 0,
  reasoningEnabled = false,
  reasoningEffort = 'medium',
  getAuthHeaders,
}: AnnotationAiPreviewPanelProps) {
  const queryClient = useQueryClient();
  // Per-row prediction overrides keyed by absolute row position; falls back to
  // the AI label so manual tweaks survive while the page stays mounted. Seeded on
  // mount from the server preview session (via `stateQuery`) so a manual edit made
  // before a tab switch is restored, and every edit is persisted back through
  // `overrideMutation` so the server store stays the source of truth.
  const [selections, setSelections] = useState<Record<number, string>>({});
  // Whether the detach-confirmation dialog is open. Clicking "Detach Previewed
  // Rows" opens it (showing the server's row count) instead of detaching straight
  // away, so an accidental click can't spawn a child table.
  const [detachDialogOpen, setDetachDialogOpen] = useState(false);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: AI_PREVIEW_PAGE_SIZE,
  });

  const nodeDataQuery = useQuery({
    queryKey: queryKeys.nodeData(
      workspaceId ?? '',
      nodeId,
      pagination.pageIndex + 1,
      pagination.pageSize,
    ),
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      if (!workspaceId) throw new Error('Missing workspace ID');
      const { data } = await getNodeDataByWorkspaceId({
        headers: getAuthHeaders(),
        path: { workspace_id: workspaceId, node_id: nodeId },
        query: { page: pagination.pageIndex + 1, page_size: pagination.pageSize },
        throwOnError: true,
      });
      return data;
    },
  });

  const canLoadClasses = Boolean(workspaceId && classNodeId && classColumn && descriptionColumn);
  const classesQuery = useQuery({
    queryKey:
      canLoadClasses && workspaceId && classNodeId && classColumn && descriptionColumn
        ? queryKeys.annotationClassDescriptions(
            workspaceId,
            classNodeId,
            classColumn,
            descriptionColumn,
          )
        : ['annotation', 'ai-preview-classes', 'disabled'],
    enabled: canLoadClasses,
    queryFn: async () => {
      if (!workspaceId || !classNodeId) throw new Error('Missing class node');
      const { data } = await getAnnotationClassDescriptions({
        headers: getAuthHeaders(),
        path: { workspace_id: workspaceId, node_id: classNodeId },
        query: { class_column: classColumn ?? '', description_column: descriptionColumn ?? '' },
        throwOnError: true,
      });
      return data;
    },
  });

  // The prediction-affecting config the backend hashes into its preview-session
  // signature — text/class columns, provider, model, prompt, and the inference
  // knobs, but NOT the annotation column or page. Both the hydration query and the
  // detach-count probe key on this, so creating the annotation column (which
  // remounts the panel) still targets the same server session.
  const signatureKey = [
    nodeId,
    textColumn,
    providerId,
    baseUrl ?? '',
    model,
    systemPrompt,
    temperature,
    reasoningEnabled,
    reasoningEffort,
    classNodeId ?? '',
    classColumn ?? '',
    descriptionColumn ?? '',
  ];
  // Key for the dry-run detach probe (see `detachCountQuery`). The per-page annotate
  // query invalidates it as new pages are previewed so the count stays current.
  const detachCountKey = ['annotation', 'ai-detach-count', ...signatureKey];

  // Rehydrate the panel from the server's preview session on mount so manual
  // overrides survive a tab switch (AnnotationFeature remounts per tab). The key
  // carries the same prediction-affecting config the backend hashes into its
  // signature — but NOT the annotation column or page — so creating the annotation
  // column (which flips "start new" to resume mode and remounts the panel) still
  // hydrates the same rows. `refetchOnMount: 'always'` re-runs the fold on every
  // remount (not just the first) because the AI labels themselves come back through
  // the cached per-page annotate query, but the local `selections` map is reset on
  // unmount and must be re-seeded from the server each time. Folding the rows into
  // `selections` inside the queryFn (an async data callback, like the per-page
  // annotate query) is intentional and safe here — it is not a render/effect.
  useQuery({
    queryKey: ['annotation', 'ai-preview-state', ...signatureKey],
    enabled: Boolean(workspaceId),
    staleTime: Infinity,
    refetchOnMount: 'always',
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!workspaceId) throw new Error('Missing workspace ID');
      const { data } = await annotateAiPreviewState({
        headers: getAuthHeaders(),
        path: { workspace_id: workspaceId, node_id: nodeId },
        query: {
          text_column: textColumn,
          class_node_id: classNodeId ?? '',
          class_column: classColumn ?? 'class',
          description_column: descriptionColumn ?? 'description',
          provider_id: providerId,
          base_url: baseUrl,
          model,
          instruction: systemPrompt,
          temperature,
          reasoning_enabled: reasoningEnabled,
          reasoning_effort: reasoningEffort,
        },
        throwOnError: true,
      });
      const serverRows = data.rows ?? [];
      // Restore only genuine overrides; an explicit "None" edit is a null override
      // (has_override true) and must show as cleared, distinct from an un-edited row.
      setSelections((current) => {
        const next = { ...current };
        serverRows.forEach((serverRow) => {
          if (serverRow.has_override) next[serverRow.row_index] = serverRow.override ?? '';
        });
        return next;
      });
      return serverRows;
    },
  });

  const rows = (nodeDataQuery.data?.data ?? []) as AnnotationPreviewRow[];
  const rowCount = nodeDataQuery.data?.pagination.total_rows ?? rows.length;
  // Build the prompt class list (name + description), dropping blank/duplicate names.
  const classes: AnnotationClassOption[] = (classesQuery.data?.rows ?? [])
    .map((row) => ({ name: cellText(row.class).trim(), description: cellText(row.description) }))
    .filter(
      (option, index, all) =>
        option.name.length > 0 && all.findIndex((other) => other.name === option.name) === index,
    );
  const classOptions = classes.map((option) => option.name);

  // Run the AI request for this page only once the texts + classes are loaded.
  // The key carries every input that changes the prediction so editing a setting
  // (or paging) issues a fresh request while prior pages stay cached. The request
  // itself is a thin call to the preview-session collection — the backend
  // re-slices the same page, loads the authoritative class list, and dispatches
  // the provider SDK, so the browser sends no texts/classes and holds no provider
  // key logic.
  const annotateEnabled = rows.length > 0 && classes.length > 0 && Boolean(workspaceId);
  const annotateQuery = useQuery({
    queryKey: [
      'annotation',
      'ai-preview',
      nodeId,
      pagination.pageIndex,
      pagination.pageSize,
      providerId,
      baseUrl ?? '',
      model,
      apiKey,
      systemPrompt,
      // Inference knobs change the predictions, so a change re-issues the request
      // for the current page while prior pages stay cached under their own key.
      temperature,
      reasoningEnabled,
      reasoningEffort,
      classNodeId ?? '',
      classColumn ?? '',
      descriptionColumn ?? '',
      classOptions.join('|'),
    ],
    enabled: annotateEnabled,
    // Predictions are deterministic for a given page+config and are costly LLM
    // calls, so never auto-refetch; only a key change (new page/config) reruns.
    // staleTime Infinity keeps already-fetched pages cached while the panel is
    // mounted, so paging back and forth never re-spends on a page.
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!workspaceId) throw new Error('Missing workspace ID');
      const { data } = await annotateAiPreview({
        // AI batches can outlast the client's default 30s cap; give a page a
        // generous window (the backend bounds each provider request itself).
        headers: { ...getAuthHeaders(), 'x-client-timeout-ms': '120000' },
        path: { workspace_id: workspaceId },
        body: {
          node_id: nodeId,
          text_column: textColumn,
          // Stored on the server session as metadata (not part of the cache
          // signature) so detach/annotate-all know which column the reused labels
          // belong to.
          annotation_column: annotationColumn,
          class_node_id: classNodeId ?? '',
          class_column: classColumn ?? 'class',
          description_column: descriptionColumn ?? 'description',
          provider_id: providerId,
          base_url: baseUrl,
          api_key: apiKey,
          model,
          instruction: systemPrompt,
          temperature,
          reasoning_enabled: reasoningEnabled,
          reasoning_effort: reasoningEffort,
          page: pagination.pageIndex + 1,
          page_size: pagination.pageSize,
        },
        throwOnError: true,
      });
      const pageLabels = data.labels ?? [];
      // A freshly previewed page grows the server preview session, so refresh the
      // dry-run detach-count probe (its own key) — the Detach button and its
      // confirmation dialog then reflect every page viewed this mount, not just the
      // hydrated set. Cache hits when paging back skip the queryFn (and this
      // invalidation), which is fine: those rows are already counted. Safe here
      // (not render/effect): a queryFn is an async data callback, like an event
      // handler resolving.
      void queryClient.invalidateQueries({ queryKey: detachCountKey });
      return pageLabels;
    },
  });
  const labels = annotateQuery.data ?? [];

  // Probe the server for how many rows the current preview session would detach.
  // This is the authoritative gate for the Detach button and the count shown in
  // its confirmation dialog: the browser's per-page map is wiped when the panel
  // remounts on a tab switch, so instead of reconstructing the previewed-row set
  // locally we ask the server (the source of truth via the preview store). It sends
  // `dry_run: true`, so the endpoint only counts — it creates nothing.
  // `refetchOnMount: 'always'` re-probes on every remount so returning to the tab
  // re-enables the button, and the per-page annotate query invalidates this key as
  // new pages are previewed so the count climbs live.
  const detachCountQuery = useQuery({
    queryKey: detachCountKey,
    enabled: Boolean(workspaceId),
    staleTime: Infinity,
    refetchOnMount: 'always',
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!workspaceId) throw new Error('Missing workspace ID');
      const { data } = await detachAiPreviewedRows({
        headers: getAuthHeaders(),
        path: { workspace_id: workspaceId, node_id: nodeId },
        body: { annotation_column: annotationColumn, dry_run: true },
        throwOnError: true,
      });
      return data.detached_rows;
    },
  });
  const detachCount = detachCountQuery.data ?? 0;

  // Persist a manual cell edit onto the server preview session so it survives a tab
  // switch (returned by `stateQuery` on remount) and is honoured by detach and
  // annotate-all. Fire-and-forget from the dropdown; the local `selections` update
  // gives instant feedback and a failed write just toasts without blocking the UI.
  const overrideMutation = useMutation({
    mutationFn: async (variables: { rowIndex: number; label: string }) => {
      if (!workspaceId) throw new Error('Missing workspace ID');
      await annotateAiPreviewOverride({
        headers: getAuthHeaders(),
        path: { workspace_id: workspaceId, node_id: nodeId, row_index: variables.rowIndex },
        body: {
          // '' is the "None" pick — send null so the server records an explicit
          // null override (which still wins over the model label).
          label: variables.label === '' ? null : variables.label,
        },
        throwOnError: true,
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not save edit');
    },
  });

  // "Annotate All" fans every row out on the backend (concurrent batches) and
  // writes the whole annotation column in one persisted go, unlike the transient
  // per-page preview. On success we refresh the node data + graph so the filled
  // column shows up everywhere, and toast the labelled/total counts.
  const annotateAllMutation = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error('Missing workspace ID');
      const { data } = await annotateAiAll({
        // A whole-table run fans many batches out on the backend and can take
        // minutes; extend the client timeout well past the 30s default (still
        // finite so a truly hung request eventually surfaces an error).
        headers: { ...getAuthHeaders(), 'x-client-timeout-ms': '600000' },
        path: { workspace_id: workspaceId, node_id: nodeId },
        body: {
          text_column: textColumn,
          annotation_column: annotationColumn,
          class_node_id: classNodeId ?? '',
          class_column: classColumn ?? 'class',
          description_column: descriptionColumn ?? 'description',
          provider_id: providerId,
          base_url: baseUrl,
          api_key: apiKey,
          model,
          instruction: systemPrompt,
          temperature,
          reasoning_enabled: reasoningEnabled,
          reasoning_effort: reasoningEffort,
        },
        throwOnError: true,
      });
      return data;
    },
    onSuccess: async (data) => {
      toast.success(
        `Annotated ${String(data.labeled_rows)} of ${String(data.total_rows)} rows`,
      );
      // Annotate All clears the node's preview session on the backend, so re-probe
      // the detach count (it drops to 0 and the Detach button disables).
      queryClient.setQueryData(detachCountKey, 0);
      if (workspaceId) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(workspaceId, nodeId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(workspaceId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.workspaceNodes(workspaceId) }),
        ]);
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Annotate all failed');
    },
  });
  const canAnnotateAll = Boolean(workspaceId) && classes.length > 0;

  // "Detach Previewed Rows" copies every row the user has previewed — across all
  // pages, not just the one on screen — into a new child of the source node, with
  // their (possibly overridden) labels written into the annotation column. The
  // server reads the authoritative previewed-row set from its preview session, so
  // the request carries no `rows`; the node lives in the path and the body names
  // only the target column. Unlike "Annotate All" it neither calls the LLM nor
  // touches the source. On success we refresh the graph + node list so the new
  // child appears immediately.
  const detachMutation = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error('Missing workspace ID');
      const { data } = await detachAiPreviewedRows({
        headers: getAuthHeaders(),
        path: { workspace_id: workspaceId, node_id: nodeId },
        body: {
          annotation_column: annotationColumn,
        },
        throwOnError: true,
      });
      return data;
    },
    onSuccess: async (data) => {
      const count = data.detached_rows;
      toast.success(`Detached ${String(count)} previewed row${count === 1 ? '' : 's'}`);
      if (workspaceId) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(workspaceId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.workspaceNodes(workspaceId) }),
        ]);
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Detach failed');
    },
  });
  // Needs a workspace and at least one previewed row in the server session (from the
  // dry-run probe); also blocked while a full Annotate All run is in flight so the
  // two workspace writes never overlap.
  const canDetach =
    Boolean(workspaceId) && detachCount > 0 && !annotateAllMutation.isPending;

  const tableColumns: ColumnDef<AnnotationPreviewRow>[] = [
    { id: textColumn, accessorFn: (row) => row[textColumn] },
    { id: 'ai_prediction', accessorFn: (row) => row[textColumn] },
  ];
  const table = useServerTable({
    data: rows,
    columns: tableColumns,
    rowCount,
    pageIndex: pagination.pageIndex,
    pageSize: pagination.pageSize,
    onPaginationChange: setPagination,
  });

  return (
    <section
      aria-label="AI Annotation Preview"
      className="mt-5 rounded-lg border bg-background/60 p-4"
    >
      <h3 className="mb-3 text-base font-semibold">AI Preview</h3>
      {nodeDataQuery.isLoading ? (
        <div className="rounded-md border border-border px-4 py-3 text-sm text-muted-foreground">
          Loading texts...
        </div>
      ) : nodeDataQuery.isError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Could not load texts.
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          No rows to annotate.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="max-h-96 overflow-y-auto overflow-x-hidden">
            <Table className="w-full table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-1/2">{textColumn}</TableHead>
                  <TableHead className="w-1/2">
                    <span className="flex items-center gap-2">
                      AI prediction
                      {annotateQuery.isFetching ? (
                        <span className="text-xs font-normal text-muted-foreground">
                          Annotating...
                        </span>
                      ) : null}
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => {
                  const rowPosition = pagination.pageIndex * pagination.pageSize + index;
                  const seeded = labels[index] ?? '';
                  const value = selections[rowPosition] ?? seeded;
                  // Existing label already stored in the previewed column, if any.
                  // Shown struck through next to the AI prediction so overwriting
                  // a pre-filled cell is obvious; blank for a new column.
                  const existing = cellText(row[annotationColumn]).trim();
                  return (
                    <TableRow key={rowPosition} className="align-top hover:bg-transparent">
                      <TableCell className="break-words whitespace-pre-wrap">
                        {cellText(row[textColumn])}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {existing ? (
                            <span
                              className="shrink-0 text-sm text-muted-foreground line-through"
                              title="Existing annotation"
                            >
                              {existing}
                            </span>
                          ) : null}
                          <Select
                            value={value}
                            disabled={annotateQuery.isFetching || classOptions.length === 0}
                            onValueChange={(next) => {
                              // The sentinel clears the cell back to an unset value.
                              const resolved = next === NO_CLASS_VALUE ? '' : next;
                              setSelections((current) => ({ ...current, [rowPosition]: resolved }));
                              // Persist the edit so it survives a tab switch and is
                              // honoured by detach/annotate-all (server is the source
                              // of truth for overrides).
                              overrideMutation.mutate({ rowIndex: rowPosition, label: resolved });
                            }}
                          >
                            <SelectTrigger
                              aria-label={`AI class for row ${String(rowPosition + 1)}`}
                              className="w-full text-sm"
                            >
                              <SelectValue placeholder="—" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_CLASS_VALUE} className="text-muted-foreground">
                                None
                              </SelectItem>
                              {classOptions.map((name) => (
                                <SelectItem key={name} value={name}>
                                  {name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {annotateQuery.isError ? (
            <div className="flex items-center justify-between gap-3 border-t border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
              <span>
                {annotateQuery.error instanceof Error
                  ? annotateQuery.error.message
                  : 'AI annotation failed.'}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void annotateQuery.refetch();
                }}
              >
                Retry
              </Button>
            </div>
          ) : null}
          <ServerPaginationFooter
            table={table}
            pageIndex={pagination.pageIndex}
            pageSize={pagination.pageSize}
            rowCount={rowCount}
            loading={nodeDataQuery.isFetching}
          />
          <div className="flex items-center justify-end gap-3 border-t border-border px-4 py-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={detachMutation.isPending || !canDetach}
              onClick={() => {
                setDetachDialogOpen(true);
              }}
            >
              {detachMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                  Detaching…
                </>
              ) : (
                'Detach Previewed Rows'
              )}
            </Button>
            <ConfirmDialog
              open={detachDialogOpen}
              onOpenChange={setDetachDialogOpen}
              title="Detach previewed rows"
              description={`Copy the ${String(detachCount)} previewed row${
                detachCount === 1 ? '' : 's'
              } into a new child table with their AI labels? The source table is left unchanged.`}
              confirmText="Detach"
              onConfirm={() => {
                detachMutation.mutate();
              }}
            />
            {annotateAllMutation.isPending ? (
              <span className="text-xs text-muted-foreground">
                Annotating every row…
              </span>
            ) : null}
            <Button
              type="button"
              size="sm"
              disabled={
                annotateAllMutation.isPending || detachMutation.isPending || !canAnnotateAll
              }
              onClick={() => {
                annotateAllMutation.mutate();
              }}
            >
              {annotateAllMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                  Annotating…
                </>
              ) : (
                'Annotate All'
              )}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
