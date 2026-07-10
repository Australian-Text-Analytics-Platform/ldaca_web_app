import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  annotateAiAll,
  annotateAiPreview,
  annotateAiPreviewClear,
  annotateAiPreviewOverride,
  annotateAiPreviewState,
  detachAiPreviewedRows,
} from '@/api';
import { ApiError } from '@/lib/apiError';
import { queryKeys } from '@/lib/queryKeys';
import type { AnnotationClassOption } from '../aiProviders';
import { useAnnotationClassDescriptions } from './useAnnotationClassDescriptions';
import { useAnnotationNodePage } from './useAnnotationNodePage';

const AI_PREVIEW_PAGE_SIZE = 20;

interface AnnotationAiPreviewSessionConfig {
  workspaceId: string | null;
  nodeId: string | null;
  textColumn: string;
  annotationColumn: string;
  classNodeId: string | null;
  classColumn: string | null;
  descriptionColumn: string | null;
  providerId: string;
  baseUrl: string | null;
  apiKey: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  reasoningEnabled: boolean;
  reasoningEffort: string;
}

interface UseAnnotationAiPreviewSessionArgs extends AnnotationAiPreviewSessionConfig {
  isOpen: boolean;
  targetValid: boolean;
  onOpenChange: (open: boolean) => void;
  prepareOpen: () => Promise<boolean>;
  onExplicitClose: () => void;
}

type SessionOrigin = 'pending' | 'new' | 'hydrated';

interface ScopedSelections {
  signature: string;
  values: Record<number, string>;
}

/** Mirrors the backend's first-distinct, non-blank prompt-class projection. */
function normalizePromptClasses(classes: AnnotationClassOption[]): AnnotationClassOption[] {
  const seen = new Set<string>();
  const normalized: AnnotationClassOption[] = [];
  for (const option of classes) {
    const name = option.name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    normalized.push({ name, description: option.description });
  }
  return normalized;
}

/**
 * Owns one Annotation AI preview session from explicit open through cleanup.
 *
 * Used by: `AnnotationFeature`, which keeps this hook mounted even while the
 * preview renderer is hidden. That placement distinguishes a tab unmount
 * (cancel browser work but preserve the backend session for hydration) from an
 * explicit Close (cancel/remove client cache and clear the backend session).
 *
 * Flow: load the shared node page and class rows, hydrate signature-scoped
 * overrides, classify the current page, probe detach count, and expose the
 * override/annotate-all/detach commands. Every query passes TanStack Query's
 * abort signal into the generated SDK. Signature changes cancel exact prior
 * state/page/count queries, local selections are signature-scoped, and async
 * callbacks compare their launch signature before changing current-session UI.
 * A rapid reopen waits for an in-flight explicit clear so the old clear cannot
 * erase the newly opened session.
 */
export function useAnnotationAiPreviewSession({
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
  temperature,
  reasoningEnabled,
  reasoningEffort,
  isOpen,
  targetValid,
  onOpenChange,
  prepareOpen,
  onExplicitClose,
}: UseAnnotationAiPreviewSessionArgs) {
  const queryClient = useQueryClient();
  const [selections, setSelections] = useState<ScopedSelections>({
    signature: '',
    values: {},
  });
  const closePromiseRef = useRef<Promise<void> | null>(null);
  const unclearedSessionRef = useRef<{
    workspaceId: string;
    nodeId: string;
    sessionId: string;
  } | null>(null);
  const commandGenerationRef = useRef(0);
  const overrideQueuesRef = useRef(new Map<number, Promise<void>>());
  const overrideVersionsRef = useRef(new Map<number, number>());
  const confirmedSelectionsRef = useRef<ScopedSelections>({ signature: '', values: {} });

  const nodePage = useAnnotationNodePage({
    workspaceId,
    nodeId: nodeId ?? '',
    pageSize: AI_PREVIEW_PAGE_SIZE,
    enabled: isOpen && targetValid && Boolean(nodeId),
  });
  const classDescriptions = useAnnotationClassDescriptions({
    workspaceId,
    nodeId: classNodeId,
    classColumn,
    descriptionColumn,
  });
  const classes = normalizePromptClasses(
    classDescriptions.rows.map((row) => ({
      name: row.class ?? '',
      description: row.description ?? '',
    })),
  );
  const classOptions = classes.map((option) => option.name);
  const classDescriptionsSignature = JSON.stringify(classes);
  const signatureParts = [
    workspaceId ?? '',
    nodeId ?? '',
    textColumn,
    annotationColumn,
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
    classDescriptionsSignature,
    targetValid ? nodePage.revision : 'invalid-target',
  ] as const;
  const signature = JSON.stringify(signatureParts);
  const currentSignatureRef = useRef(signature);
  // Async query/mutation completions can settle before a passive effect. Keep
  // the guard synchronous with render so no completion can target a signature
  // that is no longer being rendered.
  // eslint-disable-next-line react-hooks/refs -- this ref is an async freshness guard, never rendered state
  currentSignatureRef.current = signature;

  const stateKey = [
    'annotation',
    'ai-preview-state',
    workspaceId ?? '',
    nodeId ?? '',
    signature,
  ] as const;
  const detachCountPrefix = [
    'annotation',
    'ai-detach-count',
    workspaceId ?? '',
    nodeId ?? '',
    signature,
  ] as const;
  const cachePrefixes = [
    ['annotation', 'ai-preview-state', workspaceId ?? '', nodeId ?? ''],
    ['annotation', 'ai-preview', workspaceId ?? '', nodeId ?? ''],
    ['annotation', 'ai-detach-count', workspaceId ?? '', nodeId ?? ''],
  ] as const;
  const clearClientSession = async () => {
    await Promise.all(cachePrefixes.map((queryKey) => queryClient.cancelQueries({ queryKey })));
    cachePrefixes.forEach((queryKey) => {
      queryClient.removeQueries({ queryKey });
    });
  };
  const stateQuery = useQuery({
    queryKey: stateKey,
    enabled:
      isOpen &&
      classDescriptions.canLoad &&
      classDescriptions.query.isSuccess &&
      (!targetValid || nodePage.query.isSuccess) &&
      Boolean(workspaceId && nodeId),
    staleTime: Infinity,
    refetchOnMount: 'always',
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      if (!workspaceId || !nodeId) throw new Error('Missing preview session identity');
      const { data } = await annotateAiPreviewState({
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
          annotation_column: annotationColumn,
          temperature,
          reasoning_enabled: reasoningEnabled,
          reasoning_effort: reasoningEffort,
        },
        signal,
        throwOnError: true,
      });
      return data;
    },
  });
  const stateSessionMarker = stateQuery.data?.session_id ?? 'new-session';
  const previewKey = [
    'annotation',
    'ai-preview',
    workspaceId ?? '',
    nodeId ?? '',
    signature,
    stateSessionMarker,
    nodePage.pagination.pageIndex,
    nodePage.pagination.pageSize,
  ] as const;

  const annotateEnabled =
    isOpen &&
    targetValid &&
    stateQuery.isSuccess &&
    nodePage.rows.length > 0 &&
    classes.length > 0 &&
    Boolean(workspaceId && nodeId);
  const annotateQuery = useQuery({
    queryKey: previewKey,
    enabled: annotateEnabled,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      if (!workspaceId || !nodeId) throw new Error('Missing preview session identity');
      const launchedSignature = signature;
      const { data } = await annotateAiPreview({
        headers: { 'x-client-timeout-ms': '120000' },
        path: { workspace_id: workspaceId },
        body: {
          node_id: nodeId,
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
          page: nodePage.pagination.pageIndex + 1,
          page_size: nodePage.pagination.pageSize,
        },
        signal,
        throwOnError: true,
      });
      if (!signal.aborted && currentSignatureRef.current === launchedSignature) {
        void queryClient.invalidateQueries({
          queryKey: [...detachCountPrefix, data.session_id],
        });
      }
      return { sessionId: data.session_id, labels: data.labels ?? [] };
    },
  });

  const sessionId = annotateQuery.data?.sessionId ?? stateQuery.data?.session_id ?? null;
  const detachCountKey = [...detachCountPrefix, sessionId ?? 'pending-session'] as const;

  const detachCountQuery = useQuery({
    queryKey: detachCountKey,
    enabled: isOpen && targetValid && Boolean(workspaceId && nodeId && sessionId),
    staleTime: Infinity,
    refetchOnMount: 'always',
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      if (!workspaceId || !nodeId || !sessionId) {
        throw new Error('Missing preview session identity');
      }
      const { data } = await detachAiPreviewedRows({
        path: { workspace_id: workspaceId, node_id: nodeId },
        body: { session_id: sessionId, annotation_column: annotationColumn, dry_run: true },
        signal,
        throwOnError: true,
      });
      return data.detached_rows;
    },
  });

  const overrideMutation = useMutation({
    mutationFn: async (variables: {
      rowIndex: number;
      label: string;
      signature: string;
      sessionId: string;
      version: number;
    }) => {
      if (!workspaceId || !nodeId) throw new Error('Missing preview session identity');
      const previous = overrideQueuesRef.current.get(variables.rowIndex) ?? Promise.resolve();
      const request = previous
        .catch(() => undefined)
        .then(async () => {
          await annotateAiPreviewOverride({
            path: { workspace_id: workspaceId, node_id: nodeId, row_index: variables.rowIndex },
            body: {
              session_id: variables.sessionId,
              label: variables.label === '' ? null : variables.label,
            },
            throwOnError: true,
          });
        });
      overrideQueuesRef.current.set(variables.rowIndex, request);
      try {
        await request;
      } finally {
        if (overrideQueuesRef.current.get(variables.rowIndex) === request) {
          overrideQueuesRef.current.delete(variables.rowIndex);
        }
      }
    },
    onSuccess: (_data, variables) => {
      const current = confirmedSelectionsRef.current;
      confirmedSelectionsRef.current = {
        signature: variables.signature,
        values: {
          ...(current.signature === variables.signature ? current.values : {}),
          [variables.rowIndex]: variables.label,
        },
      };
    },
    onError: (error, variables) => {
      if (
        variables.signature !== currentSignatureRef.current ||
        overrideVersionsRef.current.get(variables.rowIndex) !== variables.version
      ) {
        return;
      }
      const confirmed = confirmedSelectionsRef.current;
      const rollback =
        confirmed.signature === variables.signature
          ? confirmed.values[variables.rowIndex]
          : undefined;
      setSelections((current) => {
        if (current.signature !== variables.signature) return current;
        const values = { ...current.values };
        if (rollback === undefined) Reflect.deleteProperty(values, variables.rowIndex);
        else values[variables.rowIndex] = rollback;
        return { signature: current.signature, values };
      });
      toast.error(error instanceof Error ? error.message : 'Could not save edit');
    },
  });

  const annotateAllMutation = useMutation({
    mutationFn: async (variables: { signature: string; sessionId: string }) => {
      if (!workspaceId || !nodeId) throw new Error('Missing preview session identity');
      const { data } = await annotateAiAll({
        headers: { 'x-client-timeout-ms': '600000' },
        path: { workspace_id: workspaceId, node_id: nodeId },
        body: {
          session_id: variables.sessionId,
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
      return {
        data,
        launchedSignature: variables.signature,
        launchedSessionId: variables.sessionId,
      };
    },
    onSuccess: async ({ data, launchedSignature, launchedSessionId }) => {
      if (launchedSignature === currentSignatureRef.current) {
        toast.success(`Annotated ${String(data.labeled_rows)} of ${String(data.total_rows)} rows`);
        queryClient.setQueryData(detachCountKey, 0);
      }
      if (workspaceId && nodeId) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(workspaceId, nodeId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(workspaceId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.workspaceNodes(workspaceId) }),
        ]);
      }
      if (launchedSignature === currentSignatureRef.current && launchedSessionId === sessionId) {
        await clearClientSession();
        setSelections({ signature: '', values: {} });
        overrideVersionsRef.current.clear();
        confirmedSelectionsRef.current = { signature: '', values: {} };
        onOpenChange(false);
        onExplicitClose();
      }
    },
    onError: (error, variables) => {
      if (variables.signature !== currentSignatureRef.current) return;
      toast.error(error instanceof Error ? error.message : 'Annotate all failed');
    },
  });

  const detachMutation = useMutation({
    mutationFn: async (variables: { signature: string; sessionId: string }) => {
      if (!workspaceId || !nodeId) throw new Error('Missing preview session identity');
      const { data } = await detachAiPreviewedRows({
        path: { workspace_id: workspaceId, node_id: nodeId },
        body: { session_id: variables.sessionId, annotation_column: annotationColumn },
        throwOnError: true,
      });
      return { data, launchedSignature: variables.signature };
    },
    onSuccess: async ({ data, launchedSignature }) => {
      if (launchedSignature === currentSignatureRef.current) {
        const count = data.detached_rows;
        toast.success(`Detached ${String(count)} previewed row${count === 1 ? '' : 's'}`);
      }
      if (workspaceId) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(workspaceId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.workspaceNodes(workspaceId) }),
        ]);
      }
    },
    onError: (error, variables) => {
      if (variables.signature !== currentSignatureRef.current) return;
      toast.error(error instanceof Error ? error.message : 'Detach failed');
    },
  });

  useEffect(
    () => () => {
      void queryClient.cancelQueries({
        queryKey: ['annotation', 'ai-preview-state', workspaceId ?? '', nodeId ?? '', signature],
        exact: true,
      });
      void queryClient.cancelQueries({
        queryKey: [
          'annotation',
          'ai-preview',
          workspaceId ?? '',
          nodeId ?? '',
          signature,
          stateSessionMarker,
          nodePage.pagination.pageIndex,
          nodePage.pagination.pageSize,
        ],
        exact: true,
      });
      void queryClient.cancelQueries({
        queryKey: ['annotation', 'ai-detach-count', workspaceId ?? '', nodeId ?? '', signature],
      });
    },
    [
      queryClient,
      workspaceId,
      nodeId,
      signature,
      stateSessionMarker,
      nodePage.pagination.pageIndex,
      nodePage.pagination.pageSize,
    ],
  );

  const hydratedOverrides: Record<number, string> = {};
  (stateQuery.data?.rows ?? []).forEach((row) => {
    if (row.has_override) hydratedOverrides[row.row_index] = row.override ?? '';
  });
  const localSelections = selections.signature === signature ? selections.values : {};
  const getSelection = (rowIndex: number, predicted: string | null | undefined): string => {
    if (Object.hasOwn(localSelections, rowIndex)) return localSelections[rowIndex] ?? '';
    if (Object.hasOwn(hydratedOverrides, rowIndex)) return hydratedOverrides[rowIndex] ?? '';
    return predicted ?? '';
  };

  const setSelection = (rowIndex: number, label: string) => {
    if (!sessionId || annotateAllMutation.isPending || detachMutation.isPending) return;
    const pageStart = nodePage.pagination.pageIndex * nodePage.pagination.pageSize;
    const predicted = annotateQuery.data?.labels[rowIndex - pageStart];
    const previous = getSelection(rowIndex, predicted);
    if (
      confirmedSelectionsRef.current.signature !== signature ||
      !Object.hasOwn(confirmedSelectionsRef.current.values, rowIndex)
    ) {
      const confirmed = confirmedSelectionsRef.current;
      confirmedSelectionsRef.current = {
        signature,
        values: {
          ...(confirmed.signature === signature ? confirmed.values : {}),
          [rowIndex]: previous,
        },
      };
    }
    setSelections((current) => ({
      signature,
      values: {
        ...(current.signature === signature ? current.values : {}),
        [rowIndex]: label,
      },
    }));
    const version = (overrideVersionsRef.current.get(rowIndex) ?? 0) + 1;
    overrideVersionsRef.current.set(rowIndex, version);
    overrideMutation.mutate({
      rowIndex,
      label,
      signature,
      sessionId,
      version,
    });
  };

  const close = async () => {
    if (annotateAllMutation.isPending || detachMutation.isPending) return;
    const generation = commandGenerationRef.current + 1;
    commandGenerationRef.current = generation;
    const pendingPreview =
      !sessionId && annotateQuery.isFetching
        ? annotateQuery.refetch({ cancelRefetch: false })
        : null;
    onOpenChange(false);
    onExplicitClose();
    setSelections({ signature: '', values: {} });
    overrideVersionsRef.current.clear();
    confirmedSelectionsRef.current = { signature: '', values: {} };

    const previousClear = closePromiseRef.current;
    const clear = (async () => {
      await previousClear;
      await Promise.allSettled(Array.from(overrideQueuesRef.current.values()));
      let closingSessionId = sessionId;
      if (!closingSessionId && workspaceId && nodeId) {
        try {
          const refreshedState = await stateQuery.refetch();
          closingSessionId = refreshedState.data?.session_id ?? null;
        } catch {
          // A failed lookup is followed by the in-flight preview below when one
          // exists; local cache cleanup must still complete either way.
        }
      }
      if (!closingSessionId && pendingPreview) {
        try {
          closingSessionId = (await pendingPreview).data?.sessionId ?? null;
        } catch {
          // The generated request may be aborted as the observer closes. The
          // backend may still have created the session, so probe once more.
          try {
            closingSessionId = (await stateQuery.refetch()).data?.session_id ?? null;
          } catch {
            closingSessionId = null;
          }
        }
      }
      await clearClientSession();
      if (!workspaceId || !nodeId || !closingSessionId) return;
      try {
        await annotateAiPreviewClear({
          path: { workspace_id: workspaceId, node_id: nodeId },
          query: { session_id: closingSessionId },
          throwOnError: true,
        });
        unclearedSessionRef.current = null;
      } catch (error) {
        unclearedSessionRef.current =
          error instanceof ApiError && error.code === 'annotation_preview_session_conflict'
            ? null
            : { workspaceId, nodeId, sessionId: closingSessionId };
        console.warn('[annotation] Failed to clear AI preview cache:', error);
      }
    })();
    closePromiseRef.current = clear;
    await clear;
    if (commandGenerationRef.current === generation) closePromiseRef.current = null;
  };

  const open = async () => {
    if (annotateAllMutation.isPending || detachMutation.isPending) return;
    const generation = commandGenerationRef.current + 1;
    commandGenerationRef.current = generation;
    await closePromiseRef.current;
    if (commandGenerationRef.current !== generation) return;
    const uncleared = unclearedSessionRef.current;
    if (uncleared) {
      try {
        await annotateAiPreviewClear({
          path: {
            workspace_id: uncleared.workspaceId,
            node_id: uncleared.nodeId,
          },
          query: { session_id: uncleared.sessionId },
          throwOnError: true,
        });
        unclearedSessionRef.current = null;
      } catch (error) {
        if (error instanceof ApiError && error.code === 'annotation_preview_session_conflict') {
          // Missing or superseded means this old id cannot delete or mutate the
          // generation the new open will observe. A busy id is deliberately not
          // discarded because a failed materialization can release it again.
          unclearedSessionRef.current = null;
        } else {
          toast.error(
            error instanceof Error ? error.message : 'Could not clear the previous preview session',
          );
          return;
        }
      }
    }
    const started = await prepareOpen();
    if (started && commandGenerationRef.current === generation) onOpenChange(true);
  };

  const detachCount = detachCountQuery.data ?? 0;
  const origin: SessionOrigin = stateQuery.data?.session_id
    ? 'hydrated'
    : annotateQuery.isSuccess
      ? 'new'
      : 'pending';
  const isMaterializing = annotateAllMutation.isPending || detachMutation.isPending;
  const isBusy = isMaterializing || annotateQuery.isFetching || overrideMutation.isPending;

  return {
    isOpen,
    columns: { text: textColumn, annotation: annotationColumn },
    identity: {
      id: sessionId,
      signature,
      origin,
    },
    page: {
      ...nodePage,
      setPagination: (pagination: typeof nodePage.pagination) => {
        if (!isMaterializing) nodePage.setPagination(pagination);
      },
    },
    classes: {
      values: classes,
      options: classOptions,
      query: classDescriptions.query,
    },
    predictions: {
      labels: annotateQuery.data?.labels ?? [],
      query: annotateQuery,
      getSelection,
      setSelection,
      canEdit: Boolean(sessionId) && !isMaterializing && !annotateQuery.isFetching,
    },
    detach: {
      count: detachCount,
      query: detachCountQuery,
      isPending: detachMutation.isPending,
      canRun:
        targetValid &&
        Boolean(workspaceId && sessionId) &&
        detachCount > 0 &&
        !annotateQuery.isFetching &&
        !overrideMutation.isPending &&
        !annotateAllMutation.isPending,
      run: () => {
        if (sessionId) detachMutation.mutate({ signature, sessionId });
      },
    },
    annotateAll: {
      isPending: annotateAllMutation.isPending,
      canRun:
        targetValid &&
        Boolean(workspaceId && sessionId) &&
        classes.length > 0 &&
        !annotateQuery.isFetching &&
        !overrideMutation.isPending &&
        !detachMutation.isPending,
      run: () => {
        if (sessionId) annotateAllMutation.mutate({ signature, sessionId });
      },
    },
    isMaterializing,
    isBusy,
    commands: { open, close, canToggle: !isMaterializing },
  };
}

export type AnnotationAiPreviewSession = ReturnType<typeof useAnnotationAiPreviewSession>;
