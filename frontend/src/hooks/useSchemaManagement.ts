import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { normalizeTypeName } from '../utils/columnTypes';
import { getNodeInfo } from '../lib/nodeInfoCache';
import { queryKeys } from '../lib/queryKeys';

export interface NodeSnapshot {
  id: string;
  name: string;
  columns: string[];
  schema: Record<string, string>;
}

/**
 * Utility function to normalize schema from node info API response.
 * Handles both array and object schema payload formats.
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
 * Utility function to create a node snapshot with info fetched from backend.
 */
export async function createNodeSnapshot(
  workspaceId: string,
  nodeId: string,
  getAuthHeaders: () => Record<string, string>
): Promise<NodeSnapshot> {
  const info = await getNodeInfo({ workspaceId, nodeId, getAuthHeaders });
  
  const name = info?.name || info?.data?.name || nodeId;
  const columns = Array.isArray(info?.columns)
    ? info.columns
    : (Array.isArray(info?.data?.columns) ? info.data.columns : []);
  const schema = normalizeSchemaFromInfo(info);
  
  return {
    id: nodeId,
    name: String(name),
    columns,
    schema,
  };
}

export async function createNodeSnapshots(
  workspaceId: string,
  nodeIds: string[],
  getAuthHeaders: () => Record<string, string>
): Promise<NodeSnapshot[]> {
  const snapshots = await Promise.all(
    nodeIds.map(async (nodeId) => {
      try {
        return await createNodeSnapshot(workspaceId, nodeId, getAuthHeaders);
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
export function useSchemaManagement(config: SchemaManagementConfig) {
  const { nodeId, isLocked, workspaceId, getAuthHeaders, nodeData, selectedNode } = config;

  const [currentSchema, setCurrentSchema] = useState<Record<string, string>>({});
  const [lockedSchema, setLockedSchema] = useState<Record<string, string> | null>(null);

  // Ref for accessing latest schema in async effects (hydration)
  const currentSchemaRef = useRef(currentSchema);
  useEffect(() => {
    currentSchemaRef.current = currentSchema;
  }, [currentSchema]);

  // Fetch schema via React Query so invalidation (e.g. after cast) triggers re-fetch
  const schemaQuery = useQuery({
    queryKey: (nodeId && workspaceId) ? queryKeys.nodeSchema(workspaceId, nodeId) : ['_no_schema_'],
    queryFn: async () => {
      if (!workspaceId || !nodeId) return {};
      const info = await getNodeInfo({ workspaceId, nodeId, getAuthHeaders, force: true });
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

  /**
   * Get the effective schema (locked if locked, otherwise current)
   */
  const effectiveSchema = isLocked ? (lockedSchema || currentSchema) : currentSchema;

  /**
   * Get available columns with type information from schema.
   * Falls back to nodeData/selectedNode if schema not yet available.
   */
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

  /**
   * Helper to filter columns by data type
   */
  const getColumnsByType = (dataType: string | string[]) => {
    const types = Array.isArray(dataType) ? dataType : [dataType];
    return availableColumns.filter((col) => types.includes(col.dataType));
  };

  /**
   * Lock the current schema (or provide a specific schema to lock)
   */
  const lockCurrentSchema = (schemaToLock?: Record<string, string>) => {
    setLockedSchema(schemaToLock || currentSchema);
  };

  /**
   * Clear the locked schema
   */
  const clearLockedSchema = () => {
    setLockedSchema(null);
  };

  return {
    // Schema state
    currentSchema,
    setCurrentSchema,
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

/**
 * Custom hook that provides a ref that always contains the latest value.
 * Useful for accessing state inside async callbacks without adding to deps.
 */
export function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
