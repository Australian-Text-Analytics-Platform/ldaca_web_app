import type { AnnotationClassDescriptionRow } from '@/api';
import { getNodeRowsTable } from '@/api';
import { queryKeys } from '@/lib/queryKeys';
import { useQuery } from '@tanstack/react-query';

const DISABLED_CLASS_DESCRIPTIONS_QUERY_KEY = [
  'workspaces',
  'annotation',
  'class-descriptions',
  'disabled',
] as const;

interface UseAnnotationClassDescriptionsArgs {
  workspaceId: string | null;
  nodeId: string | null;
  classColumn: string | null;
  descriptionColumn: string | null;
}

export const normalizeClassDescriptionRows = (
  rows: AnnotationClassDescriptionRow[] | undefined,
): AnnotationClassDescriptionRow[] =>
  (rows ?? []).map((row) => ({
    class: row.class,
    description: row.description,
  }));

const jsonValueToText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
};

/**
 * Shared class-description query for Annotation setup, editing, and AI gating.
 *
 * Used by: AnnotationFeature to count valid AI classes and
 * AnnotationClassDescriptionsEditor to render/edit the same class-description
 * node. Flow: build one stable enabled/disabled query key, fetch the selected
 * two-column class-description node when all selectors are present, and expose
 * normalized rows so callers never branch on missing class/description fields.
 */
export function useAnnotationClassDescriptions({
  workspaceId,
  nodeId,
  classColumn,
  descriptionColumn,
}: UseAnnotationClassDescriptionsArgs) {
  const canLoad = Boolean(workspaceId && nodeId && classColumn && descriptionColumn);
  const queryKey =
    canLoad && workspaceId && nodeId && classColumn && descriptionColumn
      ? queryKeys.annotationClassDescriptions(workspaceId, nodeId, classColumn, descriptionColumn)
      : DISABLED_CLASS_DESCRIPTIONS_QUERY_KEY;

  const query = useQuery({
    queryKey,
    enabled: canLoad,
    queryFn: async ({ signal }) => {
      if (!workspaceId || !nodeId || !classColumn || !descriptionColumn) {
        throw new Error('Missing class-description selection');
      }
      const data = await getNodeRowsTable({
        path: { workspace_id: workspaceId, node_id: nodeId },
        query: { page: 1, page_size: 1000 },
        signal,
      });
      return {
        rows: data.rows.map((row) => ({
          class: jsonValueToText(row[classColumn]),
          description: jsonValueToText(row[descriptionColumn]),
        })),
      };
    },
  });

  return {
    canLoad,
    queryKey,
    query,
    rows: normalizeClassDescriptionRows(query.data?.rows),
  };
}
