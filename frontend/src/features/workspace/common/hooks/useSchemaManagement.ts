import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ArrowColumn, ColumnKind } from '@/lib/arrow/arrowTable';
import { nodeSchemaQueryOptions } from '@/lib/nodeSchema';

/**
 * Normalizes the generated node-info schema for sequential analysis.
 * Used by the hook's node-info query selector and SequentialAnalysisFeature
 * when it hydrates a saved task schema.
 * Flow: read the generated `{ column: dtype }` map and normalize each dtype for
 * the handwritten column controls.
 */
export const arrowSchemaToKinds = (schema: ArrowColumn[]): Record<string, ColumnKind> =>
  Object.fromEntries(schema.map(({ name, kind }) => [name, kind]));

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
 * Used by SequentialAnalysisFeature to lock the run schema and by focused hook
 * tests that verify query, lock, and workspace-switch behavior.
 * Flow: subscribe to the canonical node-info query while unlocked, preserve locked schema during runs, then expose effective schema and column options.
 */
export function useSchemaManagement(config: SchemaManagementConfig) {
  const { nodeId, isLocked, workspaceId } = config;

  const [currentSchema, setCurrentSchema] = useState<Record<string, ColumnKind>>({});
  const [lockedSchema, setLockedSchema] = useState<Record<string, ColumnKind> | null>(null);

  // Fetch schema via the node-info query so schema readers share the same metadata cache.
  const schemaQuery = useQuery({
    ...nodeSchemaQueryOptions({
      workspaceId: workspaceId ?? '',
      nodeId: nodeId ?? '',
    }),
    select: arrowSchemaToKinds,
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
   * Called by SequentialAnalysisFeature immediately before starting a run.
   */
  const lockCurrentSchema = (schemaToLock?: Record<string, ColumnKind>) => {
    setLockedSchema(schemaToLock ?? currentSchema);
  };

  return {
    setLockedSchema,
    availableColumns,
    lockCurrentSchema,
  };
}
