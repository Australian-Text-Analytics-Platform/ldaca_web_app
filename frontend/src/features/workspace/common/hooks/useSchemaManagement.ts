import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { arrowTypeName, type ArrowColumn, type ArrowField } from '@/lib/arrow/arrowTable';
import { nodeSchemaQueryOptions } from '@/lib/nodeSchema';

/**
 * Indexes the authoritative Arrow schema for sequential analysis.
 * Used by the hook's schema query selector and SequentialAnalysisFeature
 * when it hydrates a saved task schema.
 * Flow: retain each decoded IPC field by column name without assigning a
 * second frontend dtype.
 */
export const arrowSchemaToFields = (schema: ArrowColumn[]): Record<string, ArrowField> =>
  Object.fromEntries(schema.map(({ name, field }) => [name, field]));

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
 * Flow: subscribe to the canonical node-schema query while unlocked, preserve locked schema during runs, then expose effective schema and column options.
 */
export function useSchemaManagement(config: SchemaManagementConfig) {
  const { nodeId, isLocked, workspaceId } = config;

  const [lockedSchema, setLockedSchema] = useState<Record<string, ArrowField> | null>(null);

  // Fetch through the shared node-schema query so every schema reader observes one resource.
  const schemaQuery = useQuery({
    ...nodeSchemaQueryOptions({
      workspaceId: workspaceId ?? '',
      nodeId: nodeId ?? '',
    }),
    select: arrowSchemaToFields,
    /** Fetches Arrow schema so cast/preprocessing invalidations refresh column types. */
    /** Called by: TanStack Query inside useSchemaManagement. */
    enabled: !!nodeId && !isLocked && !!workspaceId,
    staleTime: 0,
  });

  const currentSchema = nodeId && workspaceId ? (schemaQuery.data ?? {}) : {};

  /** Schema seen by task builders: locked while a task is running, live otherwise. */
  const effectiveSchema = isLocked ? (lockedSchema ?? currentSchema) : currentSchema;

  /** Column options for parameter panels, derived only from canonical Arrow schema. */
  const availableColumns = Object.entries(effectiveSchema).map(([name, field]) => ({
    name,
    typeName: arrowTypeName(field),
    field,
  }));

  /**
   * Freezes the schema used by an in-flight task so late refetches do not change params.
   * Called by SequentialAnalysisFeature immediately before starting a run.
   */
  const lockCurrentSchema = (schemaToLock?: Record<string, ArrowField>) => {
    setLockedSchema(schemaToLock ?? currentSchema);
  };

  return {
    setLockedSchema,
    availableColumns,
    lockCurrentSchema,
  };
}
