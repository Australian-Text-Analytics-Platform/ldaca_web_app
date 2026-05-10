import type { WorkspaceNodeLike } from '@/features/analysis/common/components/NodeSelectionPanel';

const toRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? value as Record<string, unknown> : {});

export const deriveNodeLabel = (node: WorkspaceNodeLike | null | undefined): string => {
  const base = toRecord(node);
  return (
    (base.name as string | undefined) ??
    (base.id as string | undefined) ??
    ''
  );
};

export const getNodeKey = (node: WorkspaceNodeLike, fallback?: string): string => {
  const base = toRecord(node);
  return (
    (base.id as string | undefined) ??
    fallback ??
    ''
  );
};

export const buildWorkspaceNodeMap = (workspaceNodes: WorkspaceNodeLike[]): Map<string, WorkspaceNodeLike> => {
  const map = new Map<string, WorkspaceNodeLike>();
  workspaceNodes.forEach((node, index) => {
    const key = getNodeKey(node, `node-${index}`);
    if (key && !map.has(key)) {
      map.set(key, node);
    }
  });
  return map;
};

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

export const extractNodeDtypes = (node: WorkspaceNodeLike | null | undefined): Record<string, string> => {
  const base = toRecord(node);
  if (base.schema && typeof base.schema === 'object') {
    return Object.entries(base.schema as Record<string, unknown>).reduce<Record<string, string>>((acc, [column, dtype]) => {
      acc[column] = String(dtype);
      return acc;
    }, {});
  }
  return {};
};

export const getNodeDocumentColumn = (node: WorkspaceNodeLike | null | undefined): string | undefined => {
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
