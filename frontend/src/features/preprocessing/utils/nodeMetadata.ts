import type { WorkspaceNodeLike } from '../../../components/NodeSelectionPanel';

const toRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? value as Record<string, unknown> : {});

const toNodeData = (node: WorkspaceNodeLike | null | undefined): Record<string, unknown> => {
  if (!node) return {};
  const base = toRecord(node);
  return toRecord(base.data);
};

export const deriveNodeLabel = (node: WorkspaceNodeLike | null | undefined): string => {
  const base = toRecord(node);
  const data = toNodeData(node);
  return (
    (base.name as string | undefined) ??
    (data.name as string | undefined) ??
    (data.nodeName as string | undefined) ??
    (data.label as string | undefined) ??
    (base.label as string | undefined) ??
    (base.id as string | undefined) ??
    (base.node_id as string | undefined) ??
    (data.id as string | undefined) ??
    (data.node_id as string | undefined) ??
    ''
  );
};

export const getNodeKey = (node: WorkspaceNodeLike, fallback?: string): string => {
  const base = toRecord(node);
  const data = toNodeData(node);
  return (
    (base.id as string | undefined) ??
    (base.node_id as string | undefined) ??
    (data.id as string | undefined) ??
    (data.node_id as string | undefined) ??
    (data.unique_id as string | undefined) ??
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
  const data = toNodeData(node);
  if (Array.isArray(data.columns)) {
    return (data.columns as unknown[]).map((entry) => String(entry));
  }
  if (data.schema && typeof data.schema === 'object') {
    return Object.keys(data.schema as Record<string, unknown>);
  }
  if (data.dtypes && typeof data.dtypes === 'object') {
    return Object.keys(data.dtypes as Record<string, unknown>);
  }
  return [];
};

export const extractNodeDtypes = (node: WorkspaceNodeLike | null | undefined): Record<string, string> => {
  const data = toNodeData(node);
  if (data.dtypes && typeof data.dtypes === 'object') {
    return Object.entries(data.dtypes as Record<string, unknown>).reduce<Record<string, string>>((acc, [column, dtype]) => {
      acc[column] = String(dtype);
      return acc;
    }, {});
  }
  if (data.schema && typeof data.schema === 'object') {
    return Object.entries(data.schema as Record<string, unknown>).reduce<Record<string, string>>((acc, [column, dtype]) => {
      acc[column] = String(dtype);
      return acc;
    }, {});
  }
  return {};
};
