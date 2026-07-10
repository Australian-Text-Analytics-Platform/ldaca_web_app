import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { WorkspaceNodeInfo } from '@/api';
import { normalizeTypeName } from '@/features/workspace/data-view/utils/columnTypes';
import { nodeInfoQueryOptions } from '@/lib/nodeInfo';

/**
 * Normalizes the generated node-info schema for sequential analysis and
 * workspace schema refreshes.
 * Used by: SequentialAnalysisFeature and workspaceSchemaRefresh.
 * Flow: read the generated `{ column: dtype }` map and normalize each dtype for
 * the handwritten column controls.
 */
export function normalizeSchemaFromInfo(
  info: WorkspaceNodeInfo | null | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(info?.schema ?? {}).map(([name, dtype]) => [name, normalizeTypeName(dtype)]),
  );
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
  const { nodeId, isLocked, workspaceId } = config;

  const [currentSchema, setCurrentSchema] = useState<Record<string, string>>({});
  const [lockedSchema, setLockedSchema] = useState<Record<string, string> | null>(null);

  // Fetch schema via the node-info query so schema readers share the same metadata cache.
  const schemaQuery = useQuery({
    ...nodeInfoQueryOptions({
      workspaceId: workspaceId ?? '',
      nodeId: nodeId ?? '',
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

  /**
   * Freezes the schema used by an in-flight task so late refetches do not change params.
   * Why: hook consumers need one stable boundary for state, effects, and cache coordination.
   */
  const lockCurrentSchema = (schemaToLock?: Record<string, string>) => {
    setLockedSchema(schemaToLock ?? currentSchema);
  };

  return {
    setLockedSchema,
    availableColumns,
    lockCurrentSchema,
  };
}
