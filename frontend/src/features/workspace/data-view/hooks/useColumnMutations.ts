import { useCallback, useEffect, useReducer, useRef } from 'react';
import { toast } from 'sonner';

import {
  arrowTypeName,
  isArrowStringField,
  type ArrowColumn,
  type ArrowField,
} from '@/lib/arrow/arrowTable';

import { extractColumnFields } from '../services/schemaMutations';
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
  /** Current visible column names, used for duplicate-name validation. */
  columns: string[];
  columnFields: Record<string, ArrowField>;
  onCast?: (column: string, targetType: string, format?: string) => Promise<void>;
  onRenameColumn?: (column: string, nextName: string) => Promise<void>;
  onDeleteColumn?: (column: string) => Promise<void>;
  /** Returns the latest node schema; called once on mount and after every mutation. */
  onRefreshSchema?: () => Promise<unknown>;
}

export interface ColumnMutationsApi {
  // Read state
  columnFields: Record<string, ArrowField>;
  loadingCast: Record<string, boolean>;
  columnActionLoading: Record<string, boolean>;
  renamingColumn: string | null;

  // Datetime confirmation modal (string→datetime needs a format)
  datetimeModal: DatetimeModalState;
  closeDatetimeModal: () => void;
  handleDatetimeFormatConfirm: (format?: string) => void;

  // Delete-column confirmation dialog
  deleteColumnDialogOpen: boolean;
  setDeleteColumnDialogOpen: (open: boolean) => void;
  columnToDelete: string | null;
  requestDeleteColumn: (column: string) => void;
  confirmDeleteColumn: () => Promise<void>;

  handleTypeChange: (column: string, newType: string) => void;
  startRename: (column: string) => void;
  cancelRename: () => void;
  submitRename: (column: string, value: string) => Promise<void>;
}

/**
 * Owns data-type cast state for the WorkspaceTable column headers and the
 * schema bootstrap effect. Column names are part of the immutable node
 * representation, so the table does not expose client-only rename/delete
 * controls that have no backend operation.
 * Used by: WorkspaceTable component because table rendering needs mutation state separated from column UI structure.
 * Flow: column UI calls workspace actions, the shared mutation facade persists schema changes, and toast feedback reports results.
 */
export const useColumnMutations = ({
  workspaceId,
  nodeId,
  columns,
  columnFields,
  onCast,
  onRenameColumn,
  onDeleteColumn,
  onRefreshSchema,
}: UseColumnMutationsArgs): ColumnMutationsApi => {
  const [state, dispatch] = useReducer(columnMutationReducer, undefined, createColumnMutationState);
  const {
    columnFields: mutationColumnFields,
    loadingCast,
    columnActionLoading,
    renamingColumn,
    datetimeModal,
    columnToDelete,
  } = state;
  const deleteColumnDialogOpen = columnToDelete !== null;
  const sourceSchemaSignature = JSON.stringify(
    Object.entries(columnFields)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([column, field]) => [
        column,
        arrowTypeName(field),
        field.nullable,
        [...field.metadata.entries()].toSorted(([left], [right]) => left.localeCompare(right)),
      ]),
  );
  const appliedSourceSchemaRef = useRef<string | null>(null);

  /** Applies a fetched schema to local header dtype state. */
  const applySchema = useCallback((schema: unknown) => {
    const mapping = extractColumnFields(schema as ArrowColumn[] | null);
    dispatch({ type: 'schemaApplied', columnFields: mapping });
    return mapping;
  }, []);

  // Keep the mutation UI aligned with the schema carried by the current Arrow page.
  useEffect(() => {
    if (appliedSourceSchemaRef.current === sourceSchemaSignature) return;
    appliedSourceSchemaRef.current = sourceSchemaSignature;
    dispatch({ type: 'schemaApplied', columnFields });
  }, [workspaceId, nodeId, columnFields, sourceSchemaSignature]);

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
      const currentField = mutationColumnFields[column];
      if (currentField && newType === arrowTypeName(currentField)) return;
      const isStringToDatetime =
        newType.toLowerCase() === 'datetime' &&
        currentField !== undefined &&
        isArrowStringField(currentField);
      if (isStringToDatetime) {
        dispatch({ type: 'datetimeRequested', column, targetType: newType });
        return;
      }
      void performCast(column, newType);
    },
    [onCast, mutationColumnFields, performCast],
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

  /** Tracks the spinner for rename and delete operations on one column. */
  const setColumnBusy = useCallback((column: string, active: boolean) => {
    dispatch({ type: 'columnActionLoadingChanged', column, active });
  }, []);

  /** Opens inline rename mode for one column. */
  const startRename = useCallback((column: string) => {
    dispatch({ type: 'renameStarted', column });
  }, []);

  /** Leaves inline rename mode without changing data. */
  const cancelRename = useCallback(() => {
    dispatch({ type: 'renameClosed' });
  }, []);

  /** Validates and applies a column rename through the selected Data Block edit. */
  const submitRename = useCallback(
    async (column: string, value: string) => {
      const nextName = value.trim();
      if (!onRenameColumn) {
        dispatch({ type: 'renameClosed' });
        return;
      }
      if (!nextName) {
        toast.error('Column name cannot be empty.');
        return;
      }
      if (nextName === column) {
        dispatch({ type: 'renameClosed' });
        return;
      }
      if (columns.some((candidate) => candidate !== column && candidate === nextName)) {
        toast.error(`A column named "${nextName}" already exists.`);
        return;
      }

      setColumnBusy(column, true);
      try {
        await onRenameColumn(column, nextName);
        if (onRefreshSchema) {
          applySchema(await onRefreshSchema());
        }
        dispatch({ type: 'renameClosed' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Failed to rename column "${column}": ${message}`);
      } finally {
        setColumnBusy(column, false);
      }
    },
    [applySchema, columns, onRefreshSchema, onRenameColumn, setColumnBusy],
  );

  /** Opens the destructive confirmation for one column. */
  const requestDeleteColumn = useCallback((column: string) => {
    dispatch({ type: 'deleteRequested', column });
  }, []);

  /** Mirrors the shared dialog open state into the reducer. */
  const setDeleteColumnDialogOpen = useCallback((open: boolean) => {
    dispatch({ type: 'deleteDialogChanged', open });
  }, []);

  /** Deletes the confirmed column through an identity-preserving edit. */
  const confirmDeleteColumn = useCallback(async () => {
    if (!columnToDelete || !onDeleteColumn) return;
    const column = columnToDelete;
    dispatch({ type: 'deleteDialogChanged', open: false });
    setColumnBusy(column, true);
    try {
      await onDeleteColumn(column);
      if (onRefreshSchema) {
        applySchema(await onRefreshSchema());
      } else {
        dispatch({ type: 'columnFieldRemoved', column });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to delete column "${column}": ${message}`);
    } finally {
      setColumnBusy(column, false);
    }
  }, [applySchema, columnToDelete, onDeleteColumn, onRefreshSchema, setColumnBusy]);

  return {
    columnFields: mutationColumnFields,
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
