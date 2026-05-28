import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { normalizeTypeName } from '../utils/columnTypes';
import { fetchNodeInfo } from '../lib/nodeInfo';
import { queryKeys } from '../lib/queryKeys';

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
 * Used by: src/features/analysis/sequential-analysis/SequentialAnalysisFeature.tsx, src/features/workspace/common/hooks/useWorkspaceNodeMutations.ts, src/hooks/__tests__/useSchemaManagement.test.tsx because the tests need reusable fixtures or mocks before exercising the behavior under assertion.
 * Flow: accept array or object schema payloads, normalize type names, and default malformed values to string columns.
 */
export function normalizeSchemaFromInfo(info: unknown): Record<string, string> {
  const rawSchema = (info as Record<string, unknown>)?.schema;
  
  if (Array.isArray(rawSchema)) {
    return Object.fromEntries(
      rawSchema.map((c: Record<string, unknown>) => [c.name, c.js_type || 'string'])
    );
  } else if (rawSchema && typeof rawSchema === 'object') {
    return Object.fromEntries(
      Object.entries(rawSchema).map(([k, v]) => [
        k,
        typeof v === 'string' ? normalizeTypeName(v) : 'string',
      ])
    );
  }
  
  return {};
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

  const name = info.name || nodeId;
  const columns = Array.isArray(info.columns) ? info.columns : [];
  const schema = normalizeSchemaFromInfo(info);

  const shape = info.shape;

  return {
    id: nodeId,
    name: String(name),
    columns,
    schema,
    shape: shape ?? undefined,
  };
}

/** Builds resilient node snapshots for multi-node analysis requests, falling back per-node on fetch failure. */
/**
 * Used by: src/features/analysis/common/useAnalysisLockMachine.ts, src/features/analysis/common/utils.ts, src/hooks/__tests__/useSchemaManagement.test.tsx because the tests need reusable fixtures or mocks before exercising the behavior under assertion.
 * Flow: fetch snapshots concurrently, catch per-node failures, and substitute empty fallback snapshots so one bad node does not abort the batch.
 */
export async function createNodeSnapshots(
  workspaceId: string,
  nodeIds: string[],
  getAuthHeaders: () => Record<string, string>,
  queryClient: QueryClient,
): Promise<NodeSnapshot[]> {
  const snapshots = await Promise.all(
    nodeIds.map(async (nodeId) => {
      try {
        return await createNodeSnapshot(workspaceId, nodeId, getAuthHeaders, queryClient);
      } catch {
        return {
          id: nodeId,
          name: nodeId,
          columns: [],
          schema: {} as Record<string, string>,
        };
      }
    })
  );

  return snapshots;
}

/** Narrows each snapshot to the selected analysis column while keeping a first-column fallback. */
/**
 * Used by: src/features/analysis/common/useAnalysisLockMachine.ts, src/features/analysis/common/utils.ts, src/hooks/__tests__/useSchemaManagement.test.tsx because the tests need reusable fixtures or mocks before exercising the behavior under assertion.
 * Flow: choose each snapshot's selected column when present, fall back to its first valid column, then return narrowed snapshot copies for task submission.
 */
export function applySelectedColumnsToSnapshots<T extends { id: string; columns?: string[] }>(
  snapshots: T[],
  selectedColumns: Record<string, string | undefined>
): T[] {
  return snapshots.map((snapshot) => {
    const chosen = selectedColumns[snapshot.id];
    const fallback = Array.isArray(snapshot.columns)
      ? snapshot.columns.filter((col): col is string => typeof col === 'string' && col.trim().length > 0)
      : [];
    const columns = typeof chosen === 'string' && chosen.trim().length > 0
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
  
  /**
   * Optional fallback node data (from workspace selection)
   */
  nodeData?: Record<string, unknown>;
  
  /**
   * Optional fallback selected node (from workspace selection)
   */
  selectedNode?: Record<string, unknown>;
}

/**
 * Hook for managing schema state in analysis tabs.
 * 
 * Handles:
 * - Fetching schema when node changes (if not locked)
 * - Maintaining current and locked schema states
 * - Providing effective schema (locked or current)
 * - Deriving available columns with type information
 * - Ref for accessing schema in async contexts
 * 
 * @param config - Configuration object
 * @returns Schema state and utilities
 */
/**
 * Used by: src/features/analysis/sequential-analysis/SequentialAnalysisFeature.tsx, src/hooks/__tests__/useSchemaManagement.test.tsx because the tests need reusable fixtures or mocks before exercising the behavior under assertion.
 * Flow: fetch live schema while unlocked, preserve locked schema during runs, merge node payload fallbacks, then expose effective schema and column options.
 */
export function useSchemaManagement(config: SchemaManagementConfig) {
  const { nodeId, isLocked, workspaceId, getAuthHeaders, nodeData, selectedNode } = config;

  const [currentSchema, setCurrentSchema] = useState<Record<string, string>>({});
  const [lockedSchema, setLockedSchema] = useState<Record<string, string> | null>(null);

  // Ref for accessing latest schema in async effects (hydration)
  const currentSchemaRef = useRef(currentSchema);
  useEffect(() => {
    currentSchemaRef.current = currentSchema;
  }, [currentSchema]);

  const queryClient = useQueryClient();

  // Fetch schema via React Query so invalidation (e.g. after cast) triggers re-fetch
  const schemaQuery = useQuery({
    queryKey: (nodeId && workspaceId) ? queryKeys.nodeSchema(workspaceId, nodeId) : ['_no_schema_'],
    /** Fetches schema through node-info cache so cast/preprocessing invalidations refresh column types. */
    /** Called by: TanStack Query inside useSchemaManagement because query callers need stable cache keys, fetchers, and invalidation targets for the request lifecycle. */
    queryFn: async () => {
      if (!workspaceId || !nodeId) return {};
      const info = await fetchNodeInfo({ queryClient, workspaceId, nodeId, getAuthHeaders });
      return normalizeSchemaFromInfo(info);
    },
    enabled: !!nodeId && !isLocked && !!workspaceId,
    staleTime: 0,
  });

  /* eslint-disable react-hooks/set-state-in-effect -- Syncing query data to local state; no cascading renders */
  useEffect(() => {
    if (schemaQuery.data && Object.keys(schemaQuery.data).length > 0) {
      setCurrentSchema(schemaQuery.data);
    }
  }, [schemaQuery.data]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /** Schema seen by task builders: locked while a task is running, live otherwise. */
  const effectiveSchema = isLocked ? (lockedSchema || currentSchema) : currentSchema;

  /** Column options for parameter panels, with node payload fallbacks while schema fetches. */
  const availableColumns = (() => {
    // Primary: use schema if available
    if (effectiveSchema && Object.keys(effectiveSchema).length > 0) {
      return Object.entries(effectiveSchema).map(([name, jsType]) => ({
        name,
        dataType: jsType,
      }));
    }

    // Fallback: parse from nodeData or selectedNode
    const columns: Array<{ name: string; dataType: string }> = [];
    const nodeDataAny = nodeData as Record<string, unknown> | undefined;
    const selectedNodeAny = selectedNode as Record<string, unknown> | undefined;

    if (nodeDataAny?.columns && Array.isArray(nodeDataAny.columns) && nodeDataAny?.dtypes) {
      const dtypes = nodeDataAny.dtypes as Record<string, unknown>;
      (nodeDataAny.columns as string[]).forEach((colName: string) => {
        const rawDataType = dtypes[colName] || 'unknown';
        const normalizedDataType = normalizeTypeName(String(rawDataType));
        columns.push({ name: colName, dataType: normalizedDataType });
      });
    } else if (nodeDataAny?.dtypes && typeof nodeDataAny.dtypes === 'object') {
      const dtypes = nodeDataAny.dtypes as Record<string, unknown>;
      Object.keys(dtypes).forEach((colName) => {
        const rawDataType = dtypes[colName] || 'unknown';
        const normalizedDataType = normalizeTypeName(String(rawDataType));
        columns.push({ name: colName, dataType: normalizedDataType });
      });
    } else if (selectedNodeAny?.data && typeof selectedNodeAny.data === 'object') {
      const dataObj = selectedNodeAny.data as Record<string, unknown>;
      if (dataObj.schema) {
        // selectedNode.data.schema may be array or mapping
        const schemaObj = Array.isArray(dataObj.schema)
          ? Object.fromEntries(
              (dataObj.schema as Array<Record<string, unknown>>).map((c: Record<string, unknown>) => [c.name, c.js_type || 'string'])
            )
          : dataObj.schema;
        Object.entries(schemaObj as Record<string, unknown>).forEach(([colName, jsType]) => {
          columns.push({
            name: colName,
            dataType: typeof jsType === 'string' ? normalizeTypeName(jsType) : 'string',
          });
        });
      }
    }

    return columns;
  })();

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
    setLockedSchema(schemaToLock || currentSchema);
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
    currentSchemaRef,

    // Available columns
    availableColumns,
    getColumnsByType,

    // Actions
    lockCurrentSchema,
    clearLockedSchema,
  };
}
