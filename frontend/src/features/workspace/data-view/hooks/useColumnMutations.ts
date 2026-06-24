import { useCallback, useEffect, useReducer } from 'react';
import { toast } from 'sonner';

import type { NodeSchemaResponse } from '@/features/workspace/data-view/types';

import { extractColumnTypes, normalizeTypeName } from '../services/schemaMutations';
import {
  columnMutationReducer,
  createColumnMutationState,
  type DatetimeModalState,
} from './columnMutationState';

interface UseColumnMutationsArgs {
  /** Current workspace id; enables schema bootstrap when paired with a node id. */
  workspaceId: string | undefined;
  /** Current node id; enables schema bootstrap when paired with a workspace id. */
  nodeId: string | undefined;
  /** Current visible column names (used for duplicate-rename validation). */
  columns: string[];
  onCast?: (column: string, targetType: string, format?: string) => Promise<void>;
  onRenameColumn?: (column: string, nextName: string) => Promise<void>;
  onDeleteColumn?: (column: string) => Promise<void>;
  /** Returns the latest node schema; called once on mount and after every mutation. */
  onRefreshSchema?: () => Promise<unknown>;
}

export interface ColumnMutationsApi {
  // Read state
  columnTypes: Record<string, string>;
  loadingCast: Record<string, boolean>;
  columnActionLoading: Record<string, boolean>;
  renamingColumn: string | null;

  // Datetime confirmation modal (string→datetime needs a format)
  datetimeModal: DatetimeModalState;
  closeDatetimeModal: () => void;
  handleDatetimeFormatConfirm: (format?: string) => void;

  // Delete-column confirm dialog
  deleteColumnDialogOpen: boolean;
  setDeleteColumnDialogOpen: (open: boolean) => void;
  columnToDelete: string | null;
  requestDeleteColumn: (column: string) => void;
  confirmDeleteColumn: () => Promise<void>;

  // Per-column actions
  handleTypeChange: (column: string, newType: string) => void;
  startRename: (column: string) => void;
  cancelRename: () => void;
  submitRename: (column: string, value: string) => Promise<void>;
}

/**
 * Owns every piece of state that lives inside a WorkspaceTable column header
 * (data-type cast / rename / delete / per-column busy state) plus the schema
 * bootstrap effect. Keeps WorkspaceTable.tsx focused on rendering while a
 * reducer keeps related modal, rename, delete, and busy-state transitions
 * together.
 * Used by: WorkspaceTable component (rg call sites/imports) because table rendering needs mutation state separated from column UI structure.
 * Flow: column UI calls workspace actions, the shared mutation facade persists schema changes, and toast feedback reports results.
 */
export const useColumnMutations = ({
  workspaceId,
  nodeId,
  columns,
  onCast,
  onRenameColumn,
  onDeleteColumn,
  onRefreshSchema,
}: UseColumnMutationsArgs): ColumnMutationsApi => {
  const [state, dispatch] = useReducer(columnMutationReducer, undefined, createColumnMutationState);
  const {
    columnTypes,
    loadingCast,
    columnActionLoading,
    renamingColumn,
    datetimeModal,
    columnToDelete,
  } = state;
  const deleteColumnDialogOpen = columnToDelete !== null;

  /** Applies a fetched schema to local header dtype state. */
  const applySchema = useCallback((schema: unknown) => {
    const mapping = extractColumnTypes(schema as NodeSchemaResponse | null);
    dispatch({ type: 'schemaApplied', columnTypes: mapping });
    return mapping;
  }, []);

  // Bootstrap on workspace/node change.
  useEffect(() => {
    if (!workspaceId || !nodeId || !onRefreshSchema) return;
    let cancelled = false;
    onRefreshSchema()
      .then((schema) => {
        if (!cancelled) applySchema(schema);
      })
      .catch((error: unknown) => {
        if (!cancelled) console.error('useColumnMutations: failed to refresh schema', error);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, nodeId, onRefreshSchema, applySchema]);

  /** Tracks per-column mutation spinners for rename/delete actions. */
  const setColumnBusy = useCallback((column: string, active: boolean) => {
    dispatch({ type: 'columnActionLoadingChanged', column, active });
  }, []);

  /** Runs a dtype cast and refreshes schema so headers reflect the new type. */
  const performCast = useCallback(
    async (column: string, targetType: string, format?: string) => {
      if (!onCast) return;
      dispatch({ type: 'castLoadingChanged', column, active: true });
      try {
        await onCast(column, targetType, format);
        if (onRefreshSchema) {
          const schema = await onRefreshSchema();
          applySchema(schema);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Failed to convert column "${column}" to ${targetType}: ${message}`);
      } finally {
        dispatch({ type: 'castLoadingChanged', column, active: false });
      }
    },
    [onCast, onRefreshSchema, applySchema],
  );

  /** Handles dtype menu selection, including the datetime-format confirmation path. */
  const handleTypeChange = useCallback(
    (column: string, newType: string) => {
      if (!onCast) return;
      const currentType = normalizeTypeName(columnTypes[column] ?? 'string');
      if (newType.toLowerCase() === currentType.toLowerCase()) return;
      const isStringToDatetime =
        newType.toLowerCase() === 'datetime' &&
        (currentType === 'string' || currentType.includes('utf8'));
      if (isStringToDatetime) {
        dispatch({ type: 'datetimeRequested', column, targetType: newType });
        return;
      }
      void performCast(column, newType);
    },
    [onCast, columnTypes, performCast],
  );

  /** Applies the datetime format chosen in the confirmation panel. */
  const handleDatetimeFormatConfirm = useCallback(
    (format?: string) => {
      const { column, targetType } = datetimeModal;
      dispatch({ type: 'datetimeClosed' });
      if (column && targetType) void performCast(column, targetType, format);
    },
    [datetimeModal, performCast],
  );

  /** Closes the datetime confirmation panel without casting. */
  const closeDatetimeModal = useCallback(() => {
    dispatch({ type: 'datetimeClosed' });
  }, []);

  /** Starts inline rename mode for one column header. */
  const startRename = useCallback((column: string) => {
    dispatch({ type: 'renameStarted', column });
  }, []);

  /** Cancels inline rename mode without calling the backend. */
  const cancelRename = useCallback(() => {
    dispatch({ type: 'renameClosed' });
  }, []);

  /** Validates and submits a column rename, then refreshes schema state. */
  const submitRename = useCallback(
    async (column: string, value: string) => {
      if (!onRenameColumn) {
        dispatch({ type: 'renameClosed' });
        return;
      }
      const trimmed = value.trim();
      if (!trimmed) {
        toast.error('Column name cannot be empty.');
        return;
      }
      if (trimmed === column) {
        dispatch({ type: 'renameClosed' });
        return;
      }
      if (columns.some((c) => c !== column && c === trimmed)) {
        toast.error(`A column named "${trimmed}" already exists.`);
        return;
      }
      setColumnBusy(column, true);
      try {
        await onRenameColumn(column, trimmed);
        if (onRefreshSchema) {
          const schema = await onRefreshSchema();
          applySchema(schema);
        }
        dispatch({ type: 'renameClosed' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Failed to rename column "${column}": ${message}`);
      } finally {
        setColumnBusy(column, false);
      }
    },
    [onRenameColumn, columns, setColumnBusy, onRefreshSchema, applySchema],
  );

  /** Opens the delete confirmation dialog for one column. */
  const requestDeleteColumn = useCallback((column: string) => {
    dispatch({ type: 'deleteRequested', column });
  }, []);

  /** Closes the delete confirmation dialog when the shared dialog dismisses. */
  const setDeleteColumnDialogOpen = useCallback((open: boolean) => {
    dispatch({ type: 'deleteDialogChanged', open });
  }, []);

  /** Deletes the selected column and removes/refreshes its schema metadata. */
  const confirmDeleteColumn = useCallback(async () => {
    if (!columnToDelete || !onDeleteColumn) return;
    const column = columnToDelete;
    dispatch({ type: 'deleteDialogChanged', open: false });
    setColumnBusy(column, true);
    try {
      await onDeleteColumn(column);
      if (onRefreshSchema) {
        const schema = await onRefreshSchema();
        applySchema(schema);
      } else {
        dispatch({ type: 'columnTypeRemoved', column });
      }
      dispatch({ type: 'columnDeleteSucceeded', column });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to delete column "${column}": ${message}`);
    } finally {
      setColumnBusy(column, false);
    }
  }, [columnToDelete, onDeleteColumn, setColumnBusy, onRefreshSchema, applySchema]);

  return {
    columnTypes,
    loadingCast,
    columnActionLoading,
    renamingColumn,
    datetimeModal,
    closeDatetimeModal,
    handleDatetimeFormatConfirm,
    deleteColumnDialogOpen,
    setDeleteColumnDialogOpen,
    columnToDelete,
    requestDeleteColumn,
    confirmDeleteColumn,
    handleTypeChange,
    startRename,
    cancelRename,
    submitRename,
  };
};
