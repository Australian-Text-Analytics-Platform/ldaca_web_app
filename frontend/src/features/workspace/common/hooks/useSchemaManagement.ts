import { useState, useEffect } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { normalizeTypeName } from '@/features/workspace/data-view/utils/columnTypes';
import { fetchNodeInfo, fetchNodeInfos, nodeInfoQueryOptions, type NodeInfo } from '@/lib/nodeInfo';

export interface NodeSnapshot {
  id: string;
  name: string;
  columns: string[];
  schema: Record<string, string>;
  shape?: [number | null, number | null] | number[];
}

/**
 * Normalizes node-info schema payloads for analysis tabs that need one
 * `{ column: canonicalType }` map regardless of backend wire format.
 */
/**
 * Used by: src/features/views/sequential-analysis/SequentialAnalysisFeature.tsx, src/features/workspace/common/hooks/useWorkspaceNodeMutations.ts, src/hooks/__tests__/useSchemaManagement.test.tsx.
 * Flow: accept array or object schema payloads, normalize type names, and default malformed values to string columns.
 */
export function normalizeSchemaFromInfo(info: unknown): Record<string, string> {
  const rawSchema =
    info && typeof info === 'object' ? (info as Record<string, unknown>).schema : undefined;

  if (Array.isArray(rawSchema)) {
    return Object.fromEntries(
      (rawSchema as { name?: unknown; js_type?: unknown }[]).map((c) => [
        // Runtime values are column descriptors from the backend; name is always a string.
        c.name as string,
        typeof c.js_type === 'string' && c.js_type.length > 0 ? c.js_type : 'string',
      ]),
    );
  } else if (rawSchema && typeof rawSchema === 'object') {
    return Object.fromEntries(
      Object.entries(rawSchema).map(([k, v]) => [
        k,
        typeof v === 'string' ? normalizeTypeName(v) : 'string',
      ]),
    );
  }

  return {};
}

/** Builds the backend node snapshot submitted by multi-node analyses. */
/** Called by: createNodeSnapshot and createNodeSnapshots because task builders need one projection from node-info metadata to analysis payload shape. */
function nodeSnapshotFromInfo(nodeId: string, info: NodeInfo): NodeSnapshot {
  const name = info.name || nodeId;
  const columns = Array.isArray(info.columns) ? info.columns : [];
  const schema = normalizeSchemaFromInfo(info);
  const shape = info.shape;

  return {
    id: nodeId,
    name,
    columns,
    schema,
    shape: shape ?? undefined,
  };
}

/**
 * Creates the snapshot shape multi-node analyses submit to the backend.
 * Uses the shared TanStack node-info cache so schema consumers and mutation
 * invalidations all agree on the same node metadata.
 * Why: hook consumers need one stable boundary for state, effects, and cache coordination.
 * Flow: fetch node info through the query cache, derive name/columns/schema/shape, then return the backend snapshot payload.
 */
export async function createNodeSnapshot(
  workspaceId: string,
  nodeId: string,
  getAuthHeaders: () => Record<string, string>,
  queryClient: QueryClient,
): Promise<NodeSnapshot> {
  const info = await fetchNodeInfo({ queryClient, workspaceId, nodeId, getAuthHeaders });
  return nodeSnapshotFromInfo(nodeId, info);
}

/**
 * Used by: schema hydration helpers and schema-management tests because callers need reusable fixtures or mocks before exercising the behavior under assertion.
 * Flow: fetch snapshots concurrently and let node-info failures surface to the caller instead of submitting empty schema placeholders.
 */
export async function createNodeSnapshots(
  workspaceId: string,
  nodeIds: string[],
  getAuthHeaders: () => Record<string, string>,
  queryClient: QueryClient,
): Promise<NodeSnapshot[]> {
  const infos = await fetchNodeInfos({ queryClient, workspaceId, nodeIds, getAuthHeaders });
  const infoById = new Map(infos.map((info) => [info.id, info]));
  return nodeIds.map((nodeId) => {
    const info = infoById.get(nodeId);
    if (!info) {
      throw new Error(`Node info response did not include ${nodeId}`);
    }
    return nodeSnapshotFromInfo(nodeId, info);
  });
}

/** Narrows each snapshot to the selected analysis column while keeping a first-column fallback. */
/**
 * Used by: schema hydration helpers and schema-management tests because callers need reusable fixtures or mocks before exercising the behavior under assertion.
 * Flow: choose each snapshot's selected column when present, fall back to its first valid column, then return narrowed snapshot copies for task submission.
 */
export function applySelectedColumnsToSnapshots<T extends { id: string; columns?: string[] }>(
  snapshots: T[],
  selectedColumns: Record<string, string | undefined>,
): T[] {
  return snapshots.map((snapshot) => {
    const chosen = selectedColumns[snapshot.id];
    const fallback = Array.isArray(snapshot.columns)
      ? snapshot.columns.filter(
          (col): col is string => typeof col === 'string' && col.trim().length > 0,
        )
      : [];
    const columns =
      typeof chosen === 'string' && chosen.trim().length > 0
        ? [chosen]
        : fallback.length > 0
          ? [fallback[0]]
          : [];
    return {
      ...snapshot,
      columns,
    };
  });
}

interface SchemaManagementConfig {
  /**
   * The currently selected/active node ID
   */
  nodeId: string | null | undefined;

  /**
   * Whether the analysis is currently locked
   */
  isLocked: boolean;

  /**
   * Current workspace ID
   */
  workspaceId: string | undefined;

  /**
   * Function to get auth headers
   */
  getAuthHeaders: () => Record<string, string>;
}

/**
 * Hook for managing schema state in analysis tabs.
 *
 * Handles:
 * - Fetching schema when node changes (if not locked)
 * - Maintaining current and locked schema states
 * - Providing effective schema (locked or current)
 * - Deriving available columns with type information
 *
 * @param config - Configuration object
 * @returns Schema state and utilities
 */
/**
 * Used by: src/features/views/sequential-analysis/SequentialAnalysisFeature.tsx, src/hooks/__tests__/useSchemaManagement.test.tsx.
 * Flow: subscribe to the canonical node-info query while unlocked, preserve locked schema during runs, then expose effective schema and column options.
 */
export function useSchemaManagement(config: SchemaManagementConfig) {
  const { nodeId, isLocked, workspaceId, getAuthHeaders } = config;

  const [currentSchema, setCurrentSchema] = useState<Record<string, string>>({});
  const [lockedSchema, setLockedSchema] = useState<Record<string, string> | null>(null);

  // Fetch schema via the node-info query so schema readers share the same metadata cache.
  const schemaQuery = useQuery({
    ...nodeInfoQueryOptions({
      workspaceId: workspaceId ?? '',
      nodeId: nodeId ?? '',
      getAuthHeaders,
    }),
    select: normalizeSchemaFromInfo,
    /** Fetches schema through node info so cast/preprocessing invalidations refresh column types. */
    /** Called by: TanStack Query inside useSchemaManagement. */
    enabled: !!nodeId && !isLocked && !!workspaceId,
    staleTime: 0,
  });

  /* eslint-disable react-hooks/set-state-in-effect -- Syncing query data to local state; no cascading renders */
  useEffect(() => {
    if (!nodeId || !workspaceId) {
      setCurrentSchema({});
      return;
    }
    if (!isLocked) {
      setCurrentSchema(schemaQuery.data ?? {});
    }
  }, [schemaQuery.data, isLocked, nodeId, workspaceId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /** Schema seen by task builders: locked while a task is running, live otherwise. */
  const effectiveSchema = isLocked ? (lockedSchema ?? currentSchema) : currentSchema;

  /** Column options for parameter panels, derived only from canonical node info. */
  const availableColumns = Object.entries(effectiveSchema).map(([name, jsType]) => ({
    name,
    dataType: jsType,
  }));

  /** Lets feature panels request type-specific column subsets without duplicating filter logic. */
  /** Called by: useSchemaManagement in this hook module because the hook needs local steps to normalize inputs before exposing stable state to consumers. */
  const getColumnsByType = (dataType: string | string[]) => {
    const types = Array.isArray(dataType) ? dataType : [dataType];
    return availableColumns.filter((col) => types.includes(col.dataType));
  };

  /**
   * Freezes the schema used by an in-flight task so late refetches do not change params.
   * Why: hook consumers need one stable boundary for state, effects, and cache coordination.
   */
  const lockCurrentSchema = (schemaToLock?: Record<string, string>) => {
    setLockedSchema(schemaToLock ?? currentSchema);
  };

  /** Re-enables live schema updates after a task completes or is cleared. */
  /** Called by: useSchemaManagement in this hook module because the hook needs local steps to normalize inputs before exposing stable state to consumers. */
  const clearLockedSchema = () => {
    setLockedSchema(null);
  };

  return {
    // Schema state
    currentSchema,
    lockedSchema,
    setLockedSchema,
    effectiveSchema,

    // Available columns
    availableColumns,
    getColumnsByType,

    // Actions
    lockCurrentSchema,
    clearLockedSchema,
  };
}
