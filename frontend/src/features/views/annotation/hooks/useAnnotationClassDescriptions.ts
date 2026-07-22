import type { AnnotationClassDescriptionRow } from '@/api';
import { queryWorkspaceSqlTable, sqlIdentifier, sqlTable } from '@/api';
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
  const sql =
    nodeId && classColumn && descriptionColumn
      ? `SELECT ${sqlIdentifier(classColumn)}, ${sqlIdentifier(
          descriptionColumn,
        )} FROM ${sqlTable(nodeId)}`
      : '';
  const queryKey =
    canLoad && workspaceId && nodeId
      ? queryKeys.workspaceSqlDrain(workspaceId, [nodeId], sql, 500)
      : DISABLED_CLASS_DESCRIPTIONS_QUERY_KEY;

  const query = useQuery({
    queryKey,
    enabled: canLoad,
    queryFn: async ({ signal }) => {
      if (!workspaceId || !nodeId || !classColumn || !descriptionColumn) {
        throw new Error('Missing class-description selection');
      }
      const rows: Record<string, unknown>[] = [];
      let page = 1;
      let initialEtag: string | null | undefined;
      let hasNext: boolean;
      do {
        const data = await queryWorkspaceSqlTable({
          path: { workspace_id: workspaceId },
          body: {
            mode: 'query',
            node_ids: [nodeId],
            sql,
            page,
            page_size: 500,
          },
          signal,
        });
        initialEtag ??= data.etag;
        if (initialEtag !== data.etag) {
          throw new Error('Workspace changed while loading class descriptions');
        }
        rows.push(...data.rows);
        hasNext = data.hasNext;
        page += 1;
      } while (hasNext);
      return {
        rows: rows.map((row) => ({
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
