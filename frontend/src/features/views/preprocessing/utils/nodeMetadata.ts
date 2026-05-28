import type { WorkspaceNodeLike } from '@/features/views/common/components/NodeSelectionPanel';

/**
 * Safely treats loose workspace-node metadata as an object.
 * Used by: local callers in preprocessing/nodeMetadata module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/**
 * Derives the human label used by preprocessing panels and auto names.
 * Used by: useConcatSubTab hook, useJoinSubTab hook, useSliceSubTab hook (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 */
export const deriveNodeLabel = (node: WorkspaceNodeLike | null | undefined): string => {
  const base = toRecord(node);
  return (base.name as string | undefined) ?? (base.id as string | undefined) ?? '';
};

/**
 * Resolves a stable key for node maps and selection panel lookups.
 * Used by: useJoinSubTab hook, useConcatSubTab hook (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 */
export const getNodeKey = (node: WorkspaceNodeLike, fallback?: string): string => {
  const base = toRecord(node);
  return (base.id as string | undefined) ?? fallback ?? '';
};

/**
 * Builds the node lookup map shared by join, filter, slice, and concat hooks.
 * Used by: useSliceSubTab hook, useJoinSubTab hook, useConcatSubTab hook (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 */
export const buildWorkspaceNodeMap = (
  workspaceNodes: WorkspaceNodeLike[],
): Map<string, WorkspaceNodeLike> => {
  const map = new Map<string, WorkspaceNodeLike>();
  workspaceNodes.forEach((node, index) => {
    const key = getNodeKey(node, `node-${index}`);
    if (key && !map.has(key)) {
      map.set(key, node);
    }
  });
  return map;
};

/**
 * Extracts selectable column names from either explicit columns or schema.
 * Used by: useConcatSubTab hook, useJoinSubTab hook (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 */
export const extractNodeColumns = (node: WorkspaceNodeLike | null | undefined): string[] => {
  const base = toRecord(node);
  if (Array.isArray(base.columns)) {
    return (base.columns as unknown[]).map((entry) => String(entry));
  }
  if (base.schema && typeof base.schema === 'object') {
    return Object.keys(base.schema as Record<string, unknown>);
  }
  return [];
};

/**
 * Extracts schema dtypes for condition/operator logic in preprocessing tabs.
 * Used by: useConcatSubTab hook (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 * Flow: coerce the node to a record, inspect object-shaped schema metadata, stringify dtype values per column, and return an empty map otherwise.
 */
export const extractNodeDtypes = (
  node: WorkspaceNodeLike | null | undefined,
): Record<string, string> => {
  const base = toRecord(node);
  if (base.schema && typeof base.schema === 'object') {
    return Object.entries(base.schema as Record<string, unknown>).reduce<Record<string, string>>(
      (acc, [column, dtype]) => {
        acc[column] = String(dtype);
        return acc;
      },
      {},
    );
  }
  return {};
};

/**
 * Finds the document-text column preview dialogs should promote from metadata.
 * Used by: useWorkspaceDataTable hook, documentColumn tests, documentColumn utilities (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 * Steps: inspect legacy and nested metadata keys, prefer the first non-empty string, and
 * leave callers undefined when no document column is declared.
 */
export const getNodeDocumentColumn = (
  node: WorkspaceNodeLike | null | undefined,
): string | undefined => {
  const base = toRecord(node);
  const data = toRecord(base.data);
  const dataNode = toRecord(data.node);

  const candidates = [
    base.documentColumn,
    base.document_column,
    base.document,
    data.documentColumn,
    data.document_column,
    data.document,
    dataNode.documentColumn,
    dataNode.document_column,
    dataNode.document,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return undefined;
};
