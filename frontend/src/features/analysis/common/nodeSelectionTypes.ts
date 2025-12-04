import type { ColumnInfo } from '@/utils/columnTypes';

export interface WorkspaceNodeLike extends Record<string, unknown> {
  id?: string;
  node_id?: string;
  data?: Record<string, unknown> & {
    id?: string;
    node_id?: string;
    nodeName?: string;
    name?: string;
    label?: string;
    shape?: [number, number];
    columns?: string[];
    schema?: unknown;
    dtypes?: Record<string, unknown>;
  };
  name?: string;
  label?: string;
  unique_id?: string;
}

export interface NodeColumnSelection {
  nodeId: string;
  column: string;
}

export type NodeColumnSource = string[] | ColumnInfo[];

export const getNodeIdentifier = (node: WorkspaceNodeLike, fallbackIndex: number): string =>
  node.id ||
  node.node_id ||
  (node.data?.id as string | undefined) ||
  (node.data?.node_id as string | undefined) ||
  (node.unique_id as string | undefined) ||
  `node-${fallbackIndex}`;

export const getNodeDisplayName = (node: WorkspaceNodeLike, fallbackId: string): string =>
  (node.name as string | undefined) ||
  (node.data?.name as string | undefined) ||
  (node.data?.nodeName as string | undefined) ||
  (node.label as string | undefined) ||
  (node.data?.label as string | undefined) ||
  fallbackId;
