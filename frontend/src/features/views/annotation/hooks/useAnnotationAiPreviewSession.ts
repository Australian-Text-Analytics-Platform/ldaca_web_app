import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { previewAnnotation } from '@/api';
import type { AnnotationPreviewLabel } from '@/api';
import type { AnnotationClassOption, AnnotationAiProviderId } from '../aiProviders';
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
  providerId: AnnotationAiProviderId;
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

function normalizePromptClasses(classes: AnnotationClassOption[]): AnnotationClassOption[] {
  const seen = new Set<string>();
  return classes.flatMap((option) => {
    const name = option.name.trim();
    if (!name || seen.has(name)) return [];
    seen.add(name);
    return [{ name, description: option.description }];
  });
}

/**
 * Owns one stateless annotation preview. The backend does not create preview
 * sessions or accept credentials from the browser, so a preview is simply a
 * query for the current node page and a typed classification request.
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
      name: row.class,
      description: row.description,
    })),
  );
  const signature = JSON.stringify([
    workspaceId,
    nodeId,
    textColumn,
    annotationColumn,
    providerId,
    model,
    systemPrompt,
    temperature,
    reasoningEnabled,
    reasoningEffort,
    classes,
    nodePage.pagination,
  ]);
  const previewQuery = useQuery({
    queryKey: ['annotation', 'preview', signature],
    enabled:
      isOpen &&
      targetValid &&
      Boolean(workspaceId && nodeId && model && providerId) &&
      classes.length > 0 &&
      nodePage.rows.length > 0,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!workspaceId || !nodeId) throw new Error('Missing annotation preview identity');
      const { data } = await previewAnnotation({
        headers: { 'x-client-timeout-ms': '120000' },
        path: { workspace_id: workspaceId, node_id: nodeId },
        body: {
          text_column: textColumn,
          annotation_column: annotationColumn,
          classes,
          provider: providerId,
          model,
          instruction: systemPrompt,
          temperature,
          reasoning_enabled: reasoningEnabled,
          reasoning_effort: reasoningEffort as 'low' | 'medium' | 'high',
          page: nodePage.pagination.pageIndex + 1,
          page_size: nodePage.pagination.pageSize,
        },
        signal,
        throwOnError: true,
      });
      return data;
    },
  });

  const labels = useMemo(() => {
    const byIndex = new Map<number, string | null>();
    (previewQuery.data?.labels ?? []).forEach((label: AnnotationPreviewLabel) => {
      byIndex.set(label.row_index, label.label);
    });
    const start = nodePage.pagination.pageIndex * nodePage.pagination.pageSize;
    return nodePage.rows.map((_, index) => byIndex.get(start + index) ?? null);
  }, [nodePage.pagination, nodePage.rows, previewQuery.data?.labels]);

  const open = async () => {
    if (await prepareOpen()) onOpenChange(true);
  };
  const close = () => {
    onOpenChange(false);
    onExplicitClose();
  };

  return {
    isOpen,
    columns: { text: textColumn, annotation: annotationColumn },
    identity: { id: null, signature, origin: 'new' as const },
    page: {
      ...nodePage,
      setPagination: (pagination: typeof nodePage.pagination) => {
        nodePage.setPagination(pagination);
      },
    },
    classes: {
      values: classes,
      options: classes.map((item) => item.name),
      query: classDescriptions.query,
    },
    predictions: {
      labels,
      query: previewQuery,
      getSelection: (rowIndex: number, predicted: string | null | undefined) =>
        labels[rowIndex - nodePage.pagination.pageIndex * nodePage.pagination.pageSize] ??
        predicted ??
        '',
      setSelection: (_rowIndex: number, _value: string) => undefined,
      canEdit: false,
    },
    isBusy: previewQuery.isFetching,
    commands: { open, close, canToggle: true },
  };
}

export type AnnotationAiPreviewSession = ReturnType<typeof useAnnotationAiPreviewSession>;
